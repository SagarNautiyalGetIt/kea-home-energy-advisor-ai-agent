"""Vapi Custom LLM adapter — contract tests.

Every test here verifies that the Vapi endpoint is *transport only*: it reformats the
same `answer()` output `/chat` produces into OpenAI-compatible SSE chunks, and converts
errors into spoken apologies instead of HTTP status codes (because a 404 on a phone call
is silence).

The agent is mocked throughout. These tests own the wire format and the error-handling
UX, not the analytics and not the model.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.agent.loop import ToolInvocation
from app.main import app
from app.pipeline import Answer, UnknownCustomerError

client = TestClient(app, raise_server_exceptions=False)

VAPI_URL = "/api/vapi/chat/completions"


def _vapi_payload(
    customer_id: str = "H-JUL",
    user_message: str = "why is my bill high",
    *,
    include_system: bool = True,
) -> dict:
    """A minimal Vapi-shaped request."""
    messages = []
    if include_system:
        messages.append(
            {"role": "system", "content": f"You are Sparky. customer_id: {customer_id}"}
        )
    messages.append({"role": "user", "content": user_message})
    return {"messages": messages, "model": "custom", "stream": True}


def _fake_answer(customer_id: str = "H-JUL", *, escalate: bool = False) -> Answer:
    return Answer(
        customer_id=customer_id,
        # Deliberately carries markdown. The endpoint must strip it before the sentences
        # reach a synthesiser — "asterisk asterisk steady load asterisk asterisk" is what
        # a caller would otherwise hear, and no amount of prompting reliably stops a
        # model from bolding a key figure.
        text="Your **steady load** is 2.4 kWh a day. That costs $290 a year.",
        tools_used=[
            ToolInvocation(
                name="get_daily_usage",
                arguments={},
                result={"available": True, "source": "meter data"},
            )
        ],
        escalate=escalate,
        escalation_reason="customer said they cannot pay" if escalate else None,
    )


def _parse_sse_chunks(raw: str) -> tuple[list[dict], bool]:
    """Parse SSE text into (list of chunk dicts, saw_done)."""
    chunks = []
    saw_done = False
    for line in raw.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        if line == "data: [DONE]":
            saw_done = True
            continue
        if line.startswith("data: "):
            chunks.append(json.loads(line[6:]))
    return chunks, saw_done


# ---------- happy path ----------


@patch("app.api.routes.answer", new_callable=AsyncMock)
@patch("app.api.routes.build_context", new_callable=AsyncMock)
def test_happy_path_returns_openai_sse_chunks(mock_context, mock_answer):
    """Valid customer → the answer's sentences as OpenAI chunks."""
    mock_answer.return_value = _fake_answer()

    resp = client.post(VAPI_URL, json=_vapi_payload())

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    chunks, saw_done = _parse_sse_chunks(resp.text)
    assert saw_done, "must end with data: [DONE]"
    assert len(chunks) >= 1

    for chunk in chunks:
        assert chunk["object"] == "chat.completion.chunk"
        assert chunk["choices"][0]["delta"]["content"]

    full_text = "".join(c["choices"][0]["delta"]["content"] for c in chunks)
    assert "2.4 kWh" in full_text
    assert "$290" in full_text
    # The markdown in the source text must not survive to something that speaks it.
    assert "**" not in full_text

    # channel="vapi" reaches the recorder. Call deflection is the business case, so a
    # phone turn has to be countable separately from a chat one.
    mock_answer.assert_awaited_once()
    _, kwargs = mock_answer.call_args
    assert kwargs["channel"] == "vapi"


# ---------- customer_id resolution ----------


@patch("app.api.routes.answer", new_callable=AsyncMock)
@patch("app.api.routes.build_context", new_callable=AsyncMock)
def test_customer_id_from_header(mock_context, mock_answer):
    """X-Vapi-Customer-Id takes precedence over the system message.

    A system message that disagrees with the header is a misconfiguration, and it should
    lose rather than win silently.
    """
    mock_answer.return_value = _fake_answer("H-COLD")

    resp = client.post(
        VAPI_URL,
        json=_vapi_payload(customer_id="H-JUL"),
        headers={"X-Vapi-Customer-Id": "H-COLD"},
    )

    assert resp.status_code == 200
    args, _ = mock_answer.call_args
    assert args[0] == "H-COLD"


@patch("app.api.routes.answer", new_callable=AsyncMock)
@patch("app.api.routes.build_context", new_callable=AsyncMock)
def test_customer_id_from_system_message(mock_context, mock_answer):
    """Falls back to parsing the system message when no header is set."""
    mock_answer.return_value = _fake_answer()

    resp = client.post(VAPI_URL, json=_vapi_payload(customer_id="H-JUL"))

    assert resp.status_code == 200
    args, _ = mock_answer.call_args
    assert args == ("H-JUL", "why is my bill high")


# ---------- unknown customer → spoken apology, not HTTP error ----------


@patch("app.api.routes.build_context", new_callable=AsyncMock)
def test_unknown_customer_yields_apology(mock_context):
    """A 404 on a phone call is silence. The customer hears an apology instead."""
    mock_context.side_effect = UnknownCustomerError("H-NOPE")

    resp = client.post(VAPI_URL, json=_vapi_payload(customer_id="H-NOPE"))

    # Still 200 — Vapi would drop the call on a 4xx/5xx.
    assert resp.status_code == 200

    chunks, saw_done = _parse_sse_chunks(resp.text)
    assert saw_done
    assert len(chunks) == 1
    assert "trouble pulling up your account" in chunks[0]["choices"][0]["delta"]["content"]


def test_missing_customer_id_yields_apology():
    """No customer_id anywhere — spoken apology, not a 422."""
    payload = {"messages": [{"role": "user", "content": "hello"}], "stream": True}
    resp = client.post(VAPI_URL, json=payload)

    assert resp.status_code == 200
    chunks, saw_done = _parse_sse_chunks(resp.text)
    assert saw_done
    assert "identify your account" in chunks[0]["choices"][0]["delta"]["content"]


# ---------- escalation ----------


@patch("app.api.routes.answer", new_callable=AsyncMock)
@patch("app.api.routes.build_context", new_callable=AsyncMock)
def test_escalation_still_delivers_the_answer(mock_context, mock_answer):
    """A handoff must no longer swallow the explanation.

    The old endpoint checked layer 0's escalation flag *before* the model ran and
    returned a bare transfer line, so somebody in payment difficulty who also asked why
    their bill went up was transferred without being told. Layer 0 decided that from
    keywords, before anything had read the account.

    The agent decides while holding the data, and escalating is something it does
    alongside answering. The endpoint must stream what it wrote.
    """
    mock_answer.return_value = _fake_answer(escalate=True)

    resp = client.post(VAPI_URL, json=_vapi_payload(user_message="I can't pay my bill"))

    assert resp.status_code == 200
    chunks, saw_done = _parse_sse_chunks(resp.text)
    assert saw_done
    full_text = "".join(c["choices"][0]["delta"]["content"] for c in chunks)
    assert "2.4 kWh" in full_text, (
        "an escalating turn must still deliver the answer the agent wrote"
    )
    mock_answer.assert_awaited_once()


# ---------- empty user message ----------


@patch("app.api.routes.answer", new_callable=AsyncMock)
def test_empty_message_yields_retry_prompt(mock_answer):
    """Transcription was blank — ask the customer to repeat, don't run the agent."""
    resp = client.post(VAPI_URL, json=_vapi_payload(user_message="   "))

    assert resp.status_code == 200
    chunks, _ = _parse_sse_chunks(resp.text)
    text = chunks[0]["choices"][0]["delta"]["content"]
    assert "catch that" in text.lower() or "say that again" in text.lower()

    mock_answer.assert_not_awaited()


# ---------- model failure ----------


@patch("app.api.routes.answer", new_callable=AsyncMock)
@patch("app.api.routes.build_context", new_callable=AsyncMock)
def test_answer_failure_yields_apology(mock_context, mock_answer):
    """If the agent raises, the customer hears a technical-issue apology."""
    mock_answer.side_effect = RuntimeError("model unreachable")

    resp = client.post(VAPI_URL, json=_vapi_payload())

    assert resp.status_code == 200
    chunks, saw_done = _parse_sse_chunks(resp.text)
    assert saw_done
    full_text = "".join(c["choices"][0]["delta"]["content"] for c in chunks)
    assert "technical issue" in full_text


# ---------- OpenAI chunk shape ----------


@patch("app.api.routes.answer", new_callable=AsyncMock)
@patch("app.api.routes.build_context", new_callable=AsyncMock)
def test_chunk_shape_matches_openai_spec(mock_context, mock_answer):
    """Vapi expects exactly this shape — missing keys break the integration."""
    mock_answer.return_value = _fake_answer()

    resp = client.post(VAPI_URL, json=_vapi_payload())
    chunks, _ = _parse_sse_chunks(resp.text)

    for chunk in chunks:
        assert "id" in chunk
        assert chunk["object"] == "chat.completion.chunk"
        assert isinstance(chunk["choices"], list)
        choice = chunk["choices"][0]
        assert choice["index"] == 0
        assert "content" in choice["delta"]
