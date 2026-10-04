"""AWS notification adapters. Accepted requests are queued, never labelled delivered."""

from __future__ import annotations

import asyncio
import hashlib
import re
from typing import Any

from app.alerts.channels import Notification, Outcome


def aws_client(service: str, region: str) -> Any:
    import boto3
    from botocore.config import Config

    return boto3.client(
        service,
        region_name=region,
        config=Config(
            connect_timeout=3,
            read_timeout=10,
            # SES/SNS have no send idempotency; a lost response must not resend.
            retries={
                "total_max_attempts": 1 if service in {"sesv2", "sns"} else 3,
                "mode": "standard",
            },
        ),
    )


class AwsGateway:
    def __init__(self, *, region: str, client: Any = None):
        self.region, self._client = region, client

    @property
    def client(self):
        if self._client is None:
            self._client = aws_client(self.service, self.region)
        return self._client

    async def send(self, note: Notification) -> Outcome:
        try:
            identifier = await asyncio.to_thread(self.submit, note)
        except Exception:
            # Do not expose provider bodies, phone numbers or credential-bearing errors.
            return Outcome(
                False,
                "AWS did not confirm acceptance; delivery may be unknown. No automatic retry.",
                provider=self.name,
            )
        return Outcome(
            False,
            "Accepted by AWS; delivery confirmation pending.",
            destination=identifier,
            provider=self.name,
            accepted=True,
        )


class SesGateway(AwsGateway):
    service, name, channel = "sesv2", "ses", "email"

    def __init__(self, *, sender: str, configuration_set: str = "", **kwargs):
        super().__init__(**kwargs)
        if not sender or "kea.example" in sender:
            raise RuntimeError("SES needs a verified sender identity.")
        self.sender, self.configuration_set = sender, configuration_set

    def submit(self, note: Notification) -> str:
        if not note.to or "\n" in note.to or "\r" in note.to:
            raise ValueError("Missing email recipient")
        arguments = {
            "FromEmailAddress": self.sender,
            "Destination": {"ToAddresses": [note.to]},
            "Content": {
                "Simple": {
                    "Subject": {"Data": note.subject, "Charset": "UTF-8"},
                    "Body": {"Text": {"Data": note.body, "Charset": "UTF-8"}},
                }
            },
            "EmailTags": [{"Name": "kea_delivery", "Value": note.delivery_key or "untracked"}],
        }
        if self.configuration_set:
            arguments["ConfigurationSetName"] = self.configuration_set
        return self.client.send_email(**arguments)["MessageId"]


class SnsGateway(AwsGateway):
    service, name, channel = "sns", "sns", "sms"

    def __init__(self, *, sender_id: str = "", **kwargs):
        super().__init__(**kwargs)
        self.sender_id = sender_id

    def submit(self, note: Notification) -> str:
        if not re.fullmatch(r"\+[1-9]\d{7,14}", note.to):
            raise ValueError("SMS requires an E.164 recipient")
        if self.client.check_if_phone_number_is_opted_out(phoneNumber=note.to)["isOptedOut"]:
            raise ValueError("SMS recipient is opted out")
        attributes = {"AWS.SNS.SMS.SMSType": {"DataType": "String", "StringValue": "Transactional"}}
        if self.sender_id:
            attributes["AWS.SNS.SMS.SenderID"] = {
                "DataType": "String",
                "StringValue": self.sender_id,
            }
        return self.client.publish(
            PhoneNumber=note.to, Message=note.body, MessageAttributes=attributes
        )["MessageId"]


class ConnectGateway(AwsGateway):
    service, name, channel = "connect", "connect", "voice"

    def __init__(
        self, *, instance_id: str, flow_id: str, source_number: str, prompt_builder, **kwargs
    ):
        super().__init__(**kwargs)
        if not all((instance_id, flow_id, source_number)):
            raise RuntimeError("Connect needs an instance, published flow and source number.")
        self.instance_id, self.flow_id, self.source_number = instance_id, flow_id, source_number
        self.prompt_builder = prompt_builder

    async def send(self, note: Notification) -> Outcome:
        if not note.delivery_key or not re.fullmatch(r"\+[1-9]\d{7,14}", note.to):
            return Outcome(
                False,
                "Call requires an idempotent delivery and E.164 recipient.",
                provider=self.name,
            )
        try:
            # Outbound voicemail never contains household balances, usage or identity.
            # An authenticated app conversation handles private questions.
            uri = await self.prompt_builder.prepare_notice(note.delivery_key)
            token = hashlib.sha256(note.delivery_key.encode()).hexdigest()
            response = await asyncio.to_thread(
                self.client.start_outbound_voice_contact,
                InstanceId=self.instance_id,
                ContactFlowId=self.flow_id,
                DestinationPhoneNumber=note.to,
                SourcePhoneNumber=self.source_number,
                ClientToken=token,
                Attributes={"kea_delivery": note.delivery_key, "kea_notice_audio": uri},
            )
            return Outcome(
                False,
                "Call accepted; answer and delivery are unconfirmed.",
                destination=response["ContactId"],
                provider=self.name,
                accepted=True,
            )
        except Exception:
            return Outcome(False, "Call could not be prepared or accepted.", provider=self.name)


class UnavailableGateway:
    """A configured real provider must never silently become a successful file send."""

    def __init__(self, channel: str, name: str):
        self.channel, self.name = channel, name

    async def send(self, note: Notification) -> Outcome:
        return Outcome(False, "Provider configuration is incomplete.", provider=self.name)
