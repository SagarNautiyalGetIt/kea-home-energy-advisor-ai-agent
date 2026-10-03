"""AWS-invoked receipts and Connect opt-out. No public webhook or model routing."""

import hashlib
import hmac
import json
import os
import time
import urllib.request

import boto3


def send_receipt(receipt):
    secret = boto3.client("ssm").get_parameter(
        Name=os.environ["KEA_RECEIPT_SECRET_PARAMETER"], WithDecryption=True
    )["Parameter"]["Value"]
    body = json.dumps(receipt, separators=(",", ":")).encode()
    timestamp = str(int(time.time()))
    signature = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256)
    request = urllib.request.Request(
        os.environ["KEA_API_URL"].rstrip("/") + "/api/internal/alerts/delivery",
        data=body,
        headers={"Content-Type": "application/json", "x-kea-timestamp": timestamp,
                 "x-kea-signature": signature.hexdigest()},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=4) as response:
        if response.status != 200:
            raise RuntimeError("Receipt was not recorded")


def receipts(event):
    """Provider acceptance and call answer/disconnect are never called delivered."""
    if "awslogs" in event:
        import base64
        import gzip

        logs = json.loads(gzip.decompress(base64.b64decode(event["awslogs"]["data"])))
        for record in logs.get("logEvents", []):
            message = json.loads(record["message"])
            if message.get("notification", {}).get("messageId"):
                yield {"provider": "sns", "provider_id": message["notification"]["messageId"],
                       "status": "delivered" if message.get("status") == "SUCCESS" else "failed"}
        return
    for record in event.get("Records", []):
        if record.get("EventSource") != "aws:sns":
            continue
        message = json.loads(record["Sns"]["Message"])
        kind = message.get("eventType", message.get("notificationType", "")).lower()
        status = {"delivery": "delivered", "bounce": "bounced", "complaint": "complaint"}
        if kind in status:
            yield {"provider": "ses", "provider_id": message["mail"]["messageId"],
                   "status": status[kind]}


def handler(event, context):
    if "Details" in event:
        detail = event["Details"]
        if detail.get("Parameters", {}).get("action") != "opt_out":
            raise ValueError("Unsupported call action")
        contact = detail["ContactData"]["ContactId"]
        send_receipt({"provider": "connect", "provider_id": contact, "status": "opted_out"})
        return {"saved": "true"}
    for receipt in receipts(event):
        send_receipt(receipt)
    return {"recorded": True}
