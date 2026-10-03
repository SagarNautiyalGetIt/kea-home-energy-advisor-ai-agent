"""AWS receipts remain truthful and the actual flow routes every failure safely."""

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def worker(monkeypatch):
    path = Path(__file__).parents[3] / "infra/aws-runtime/worker.py"
    monkeypatch.setitem(sys.modules, "boto3", SimpleNamespace())
    spec = importlib.util.spec_from_file_location("runtime_worker", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ses_receipts_ignore_acceptance_and_use_message_id(worker):
    def event(kind):
        return {
            "Records": [
                {
                    "EventSource": "aws:sns",
                    "Sns": {
                        "Message": json.dumps(
                            {
                                "eventType": kind,
                                "mail": {"messageId": "email-1"},
                            }
                        )
                    },
                }
            ]
        }

    assert list(worker.receipts(event("Send"))) == []
    assert list(worker.receipts(event("Delivery"))) == [
        {"provider": "ses", "provider_id": "email-1", "status": "delivered"}
    ]
    assert list(worker.receipts(event("Complaint")))[0]["status"] == "complaint"


def test_connect_opt_out_only_confirms_after_server_saved(worker, monkeypatch):
    calls = []
    monkeypatch.setattr(worker, "send_receipt", calls.append)
    event = {
        "Details": {"Parameters": {"action": "opt_out"}, "ContactData": {"ContactId": "contact-1"}}
    }
    assert worker.handler(event, None) == {"saved": "true"}
    assert calls == [{"provider": "connect", "provider_id": "contact-1", "status": "opted_out"}]

    def unavailable(receipt):
        raise ConnectionError("fixture")

    monkeypatch.setattr(worker, "send_receipt", unavailable)
    with pytest.raises(ConnectionError):
        worker.handler(event, None)


def test_deployed_flow_links_and_failure_routes():
    path = Path(__file__).parents[3] / "infra/aws-runtime/connect-flow.json.tftpl"
    flow = json.loads(path.read_text())
    actions = {action["Identifier"]: action for action in flow["Actions"]}
    assert flow["StartAction"] == "notice"
    assert actions["notice"]["Parameters"]["Media"]["Uri"] == "$.Attributes.kea_notice_audio"
    conditions = actions["notice"]["Transitions"]["Conditions"]
    assert {item["Condition"]["Operands"][0]: item["NextAction"] for item in conditions} == {
        "1": "care_queue",
        "9": "opt_out",
    }
    assert actions["opt_out"]["Transitions"]["Errors"][0]["NextAction"] == "manual_opt_out"
    for action in actions.values():
        transitions = action["Transitions"]
        destinations = [transitions["NextAction"]] if "NextAction" in transitions else []
        destinations += [item["NextAction"] for item in transitions.get("Errors", [])]
        destinations += [item["NextAction"] for item in transitions.get("Conditions", [])]
        assert set(destinations) <= actions.keys()
    assert actions["end"]["Type"] == "DisconnectParticipant"
