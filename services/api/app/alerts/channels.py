"""Delivery. One interface, three channels, several backends per channel.

This replaces `alerts/email.py`, which knew about exactly one channel and hard-wired the
tier ladder to it. Tiers 2 and 3 were computed, recorded and rendered but never sent,
which was honest but left two thirds of the product's headline feature as a diagram.

## Why third-party gateways rather than AWS

Earlier university-account constraints excluded SES, SNS and Connect — the services that would
otherwise be the obvious answer, and the ones a production Kea deployment would use. So
every gateway here is a free-tier third party behind the same `Gateway` protocol that an
`SesGateway` will slot into later. Swapping to AWS is a new class and one environment
variable; nothing above this module changes.

The free tiers, and their real limits — stated because a demo that quietly depends on a
trial account will fail on the one day it matters:

==== ============ ===================================================================
chan backend      what "free" actually means
==== ============ ===================================================================
mail file         default. Writes a valid .eml to disk. No account, no network.
mail smtp         Gmail app password. 500 recipients/day. Blocked on many networks.
mail resend       3,000/month, 100/day. Sender domain must be verified, EXCEPT
                  onboarding@resend.dev, which only delivers to your own address.
sms  file         default. Writes the exact 160-char payload to disk.
sms  textbelt     ONE free message per day per IP, no signup, key literal "textbelt".
                  Genuinely zero-cost and genuinely one message — fine for a rehearsal.
sms  twilio       trial credit. Only sends to numbers verified in the console.
voice file        default. Writes the spoken script to disk as a transcript.
voice twilio      trial credit, verified numbers only. TwiML is passed inline so no
                  public webhook is needed — see TwilioVoiceGateway.
==== ============ ===================================================================

## The rule this module inherits

It must not compose a figure. Bodies arrive fully rendered from `alerts/render.py`,
built from the same assessment the dashboard and the assistant use. Nothing here formats
a dollar amount, because a number that appears only in a text message is a number layer 3
never checked — and an alert is the one surface with no human between the system and the
customer.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Protocol
from xml.sax.saxutils import escape as xml_escape

import httpx

log = logging.getLogger(__name__)

#: One SMS segment. Longer messages still send — carriers concatenate — but each segment
#: is billed separately and a trial account has few of them. `render.sms_for` targets this.
SMS_SEGMENT_CHARS = 160

_HTTP_TIMEOUT = 10.0


@dataclass(frozen=True)
class Notification:
    """One message, on one channel, to one address."""

    channel: str
    to: str
    subject: str
    body: str
    #: What a voice call says. Separate from `body` because the written record and the
    #: spoken script are different artefacts — the email can carry a URL and a footer,
    #: a phone call cannot, and reading a footer aloud is how an automated call starts
    #: sounding like a scam.
    voice_script: str | None = None
    delivery_key: str | None = None


@dataclass(frozen=True)
class Outcome:
    """What happened, in the shape `app.alert` records."""

    delivered: bool
    detail: str | None = None
    #: Where it went — a file path, an SMTP host, a provider message id. Shown in the UI
    #: so the demo can point at the artefact rather than asserting it exists.
    destination: str | None = None
    provider: str | None = None
    accepted: bool = False


class Gateway(Protocol):
    name: str
    channel: str

    async def send(self, note: Notification) -> Outcome: ...


# ───────────────────────── file: the default everywhere ─────────────────────────


class FileGateway:
    """Writes the message to disk instead of a socket, on any channel.

    Not a mock. For email the bytes are a valid RFC 5322 message that opens in any mail
    client; for SMS the file contains the exact payload a carrier would carry, so the
    160-character budget is visible rather than theoretical; for voice it is the script
    that would be spoken.

    This is the default for all three channels for the same reason it was the default
    for email: the demo machine is on conference wifi, and a gateway that hangs for 30
    seconds because a port is blocked takes the bill-shock warning down with it. Nothing
    here can fail that way.
    """

    name = "file"

    def __init__(self, outbox: Path, channel: str, sender: str = "") -> None:
        self._outbox = outbox
        self._sender = sender
        self.channel = channel

    async def send(self, note: Notification) -> Outcome:
        try:
            directory = self._outbox / note.channel
            directory.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f")
            # `to` reaches a filename, so anything path-ish in it has to go. An address is
            # not attacker-controlled here, but this is one line and the failure it
            # prevents is writing outside the outbox.
            safe_to = "".join(c if c.isalnum() or c in "._-@+" else "_" for c in note.to)

            if note.channel == "email":
                path = directory / f"{stamp}-{safe_to}.eml"
                path.write_bytes(bytes(_email_message(note, self._sender)))
            else:
                path = directory / f"{stamp}-{safe_to}.txt"
                payload = note.voice_script if note.channel == "voice" else note.body
                path.write_text(
                    f"to: {note.to}\nchannel: {note.channel}\n"
                    f"length: {len(payload or '')} chars\n\n{payload}\n",
                    encoding="utf-8",
                )
        except OSError as exc:
            log.exception("could not write %s notification to the outbox", note.channel)
            return Outcome(False, f"outbox write failed: {exc}", provider=self.name)

        log.info("%s notification written to %s", note.channel, path)
        return Outcome(True, destination=str(path), provider=self.name)


def _email_message(note: Notification, sender: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = note.to
    message["Subject"] = note.subject
    message["Date"] = datetime.now(UTC).strftime("%a, %d %b %Y %H:%M:%S +0000")
    message.set_content(note.body)
    return message


# ───────────────────────── email ─────────────────────────


class SmtpGateway:
    """STARTTLS over `smtplib`. Standard library, so no dependency and no vendor."""

    name = "smtp"
    channel = "email"

    def __init__(
        self, *, host: str, port: int, username: str, password: str, sender: str, timeout: int
    ) -> None:
        if not password:
            # Loud, at construction, rather than a silent no-op at send time.
            raise RuntimeError(
                "KEA_EMAIL_BACKEND=smtp but KEA_SMTP_PASSWORD is empty. Set it in .env "
                "(gitignored), or use the default file backend."
            )
        self._host, self._port = host, port
        self._username, self._password = username, password
        self._sender, self._timeout = sender, timeout

    async def send(self, note: Notification) -> Outcome:
        # smtplib is blocking and there is no async SMTP in the standard library. Run it
        # on a worker thread rather than adding aiosmtplib: this is one call on an alert
        # path, and blocking the event loop for the length of an SMTP handshake would
        # stall every in-flight chat stream on the same process.
        return await asyncio.to_thread(self._send_blocking, note)

    def _send_blocking(self, note: Notification) -> Outcome:
        message = _email_message(note, self._sender)
        try:
            with smtplib.SMTP(self._host, self._port, timeout=self._timeout) as client:
                client.starttls(context=ssl.create_default_context())
                client.login(self._username, self._password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException) as exc:
            # Never include the password. SMTPAuthenticationError stringifies the
            # server's response, which is safe; the credential itself never appears.
            log.exception("SMTP send failed to %s", self._host)
            return Outcome(False, f"smtp send failed: {exc}", provider=self.name)

        log.info("alert email sent via %s", self._host)
        return Outcome(True, destination=self._host, provider=self.name)


class ResendGateway:
    """Resend's REST API. 3,000 emails a month on the free tier, no card.

    The trap worth knowing: without a verified sender domain, Resend only accepts
    `onboarding@resend.dev` as the from-address, and that sender may only deliver to the
    email the account was registered with. It will accept a send to anyone else and
    return 403. So a rehearsal that texts a teammate's address will look configured and
    deliver nothing — which is precisely the silent-degradation shape this repo has been
    bitten by before. The 403 body is passed through into `detail` so the alert row says
    what happened.
    """

    name = "resend"
    channel = "email"

    def __init__(self, *, api_key: str, sender: str) -> None:
        if not api_key:
            raise RuntimeError(
                "KEA_EMAIL_BACKEND=resend but KEA_RESEND_API_KEY is empty. Set it in "
                ".env (gitignored), or use the default file backend."
            )
        self._api_key = api_key
        self._sender = sender

    async def send(self, note: Notification) -> Outcome:
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                response = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json={
                        "from": self._sender,
                        "to": [note.to],
                        "subject": note.subject,
                        "text": note.body,
                    },
                )
        except httpx.HTTPError as exc:
            return Outcome(False, f"resend request failed: {exc}", provider=self.name)

        if response.status_code >= 400:
            return Outcome(
                False,
                f"resend returned {response.status_code}: {response.text[:200]}",
                provider=self.name,
            )
        message_id = response.json().get("id")
        log.info("alert email sent via resend id=%s", message_id)
        return Outcome(True, destination=message_id, provider=self.name)


# ───────────────────────── sms ─────────────────────────


class TextbeltGateway:
    """One free SMS per day, per IP, with no signup at all.

    The key is the literal string `textbelt`. That is not a placeholder — it is the
    documented free key, and it is the only SMS path in this file that needs no account,
    no card and no number verification. One message a day is exactly enough to prove the
    tier-2 rung works in a rehearsal, and being honest about that limit is better than a
    trial account that silently runs out mid-demo.

    Quota exhaustion comes back as HTTP 200 with `success: false`, so a status-code check
    alone would record a delivery that never happened.
    """

    name = "textbelt"
    channel = "sms"

    def __init__(self, *, api_key: str = "textbelt") -> None:
        self._api_key = api_key or "textbelt"

    async def send(self, note: Notification) -> Outcome:
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                response = await client.post(
                    "https://textbelt.com/text",
                    data={"phone": note.to, "message": note.body, "key": self._api_key},
                )
        except httpx.HTTPError as exc:
            return Outcome(False, f"textbelt request failed: {exc}", provider=self.name)

        payload = response.json() if response.content else {}
        if not payload.get("success"):
            # quotaRemaining is on the response and is the thing you actually want in the
            # failure_reason column at 9am on demo day.
            return Outcome(
                False,
                f"textbelt refused: {payload.get('error', 'unknown')} "
                f"(quota remaining {payload.get('quotaRemaining', '?')})",
                provider=self.name,
            )
        return Outcome(True, destination=str(payload.get("textId")), provider=self.name)


class TwilioSmsGateway:
    """Twilio Programmable Messaging. Trial credit; delivers only to verified numbers.

    A trial account silently accepts a send to an unverified number and then fails it
    asynchronously, so a 201 here does not mean the phone buzzed. The message SID is
    recorded on the alert row for exactly that reason — it is what you check the delivery
    status against afterwards.
    """

    name = "twilio"
    channel = "sms"

    def __init__(self, *, account_sid: str, auth_token: str, from_number: str) -> None:
        if not (account_sid and auth_token and from_number):
            raise RuntimeError(
                "KEA_SMS_BACKEND=twilio needs KEA_TWILIO_ACCOUNT_SID, "
                "KEA_TWILIO_AUTH_TOKEN and KEA_TWILIO_FROM_NUMBER."
            )
        self._sid, self._token, self._from = account_sid, auth_token, from_number

    async def send(self, note: Notification) -> Outcome:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self._sid}/Messages.json"
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                response = await client.post(
                    url,
                    auth=(self._sid, self._token),
                    data={"To": note.to, "From": self._from, "Body": note.body},
                )
        except httpx.HTTPError as exc:
            return Outcome(False, f"twilio request failed: {exc}", provider=self.name)

        if response.status_code >= 400:
            return Outcome(
                False,
                f"twilio returned {response.status_code}: {response.text[:200]}",
                provider=self.name,
            )
        return Outcome(True, destination=response.json().get("sid"), provider=self.name)


# ───────────────────────── voice ─────────────────────────


class TwilioVoiceGateway:
    """Tier 3 — the assistant rings them. Twilio Programmable Voice, trial credit.

    **TwiML is passed inline on the create-call request** rather than served from a
    webhook. Twilio's usual pattern is `Url=https://your-app/twiml`, which needs the API
    to be publicly reachable — an ngrok tunnel in development and a public endpoint in
    production, both of which are a deployment dependency for a feature that is otherwise
    self-contained. The `Twiml` parameter takes the document directly, so the call works
    from a laptop behind NAT.

    The script is escaped before it is embedded. It is composed from a fact bundle rather
    than from user input, so this is defence in depth rather than a live injection path —
    but an unescaped `&` in a rendered figure is enough to make Twilio reject the
    document, and debugging that during a rehearsal is not how anyone should spend the
    morning.

    The voice is a New Zealand English one. An American voice reading NZD figures to a
    Kiwi household is a small thing that sounds wrong immediately.
    """

    name = "twilio"
    channel = "voice"

    def __init__(
        self,
        *,
        account_sid: str,
        auth_token: str,
        from_number: str,
        voice: str = "Polly.Aria-Neural",
    ) -> None:
        if not (account_sid and auth_token and from_number):
            raise RuntimeError(
                "KEA_VOICE_BACKEND=twilio needs KEA_TWILIO_ACCOUNT_SID, "
                "KEA_TWILIO_AUTH_TOKEN and KEA_TWILIO_FROM_NUMBER."
            )
        self._sid, self._token, self._from = account_sid, auth_token, from_number
        self._voice = voice

    def twiml_for(self, script: str) -> str:
        """The spoken document. Public so a test can assert on it without a network."""
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response>"
            f'<Say voice="{self._voice}" language="en-NZ">{xml_escape(script)}</Say>'
            '<Pause length="1"/>'
            f'<Say voice="{self._voice}" language="en-NZ">'
            "You can see the full breakdown in the Kea app. Goodbye."
            "</Say>"
            "</Response>"
        )

    async def send(self, note: Notification) -> Outcome:
        script = note.voice_script or note.body
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self._sid}/Calls.json"
        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                response = await client.post(
                    url,
                    auth=(self._sid, self._token),
                    data={
                        "To": note.to,
                        "From": self._from,
                        "Twiml": self.twiml_for(script),
                    },
                )
        except httpx.HTTPError as exc:
            return Outcome(False, f"twilio call failed: {exc}", provider=self.name)

        if response.status_code >= 400:
            return Outcome(
                False,
                f"twilio returned {response.status_code}: {response.text[:200]}",
                provider=self.name,
            )
        return Outcome(True, destination=response.json().get("sid"), provider=self.name)


# ───────────────────────── registry ─────────────────────────


class GatewayRegistry:
    """Channel -> gateway. The only place a gateway is constructed.

    An unknown or misconfigured backend falls back to `file` with a warning rather than
    raising. A typo in an environment variable should not take the API down — but it must
    not be silent either, and `/health` reports which backend each channel resolved to so
    "no texts were sent" and "SMS is writing to disk" are never indistinguishable.
    """

    def __init__(self, gateways: dict[str, Gateway]) -> None:
        self._gateways = gateways

    def for_channel(self, channel: str) -> Gateway | None:
        return self._gateways.get(channel)

    def describe(self) -> dict[str, str]:
        return {channel: g.name for channel, g in self._gateways.items()}


def build_registry(
    *,
    outbox: Path,
    email_backend: str,
    sms_backend: str,
    voice_backend: str,
    email_from: str,
    smtp_host: str = "",
    smtp_port: int = 587,
    smtp_username: str = "",
    smtp_password: str = "",
    smtp_timeout: int = 10,
    resend_api_key: str = "",
    textbelt_key: str = "textbelt",
    twilio_account_sid: str = "",
    twilio_auth_token: str = "",
    twilio_from_number: str = "",
    aws_region: str = "ap-southeast-2",
    ses_configuration_set: str = "",
    sns_sender_id: str = "",
    connect_instance_id: str = "",
    connect_flow_id: str = "",
    connect_source_number: str = "",
    connect_prompt_builder=None,
) -> GatewayRegistry:
    def _file(channel: str) -> Gateway:
        return FileGateway(outbox=outbox, channel=channel, sender=email_from)

    def _resolve(channel: str, backend: str, build) -> Gateway:
        if backend == "file":
            return _file(channel)
        try:
            return build()
        except RuntimeError as exc:
            log.warning(
                "%s backend %r is not configured (%s) — falling back to file",
                channel, backend, exc,
            )
            return _file(channel)

    gateways: dict[str, Gateway] = {}

    if email_backend == "smtp":
        gateways["email"] = _resolve("email", "smtp", lambda: SmtpGateway(
            host=smtp_host, port=smtp_port, username=smtp_username,
            password=smtp_password, sender=email_from, timeout=smtp_timeout,
        ))
    elif email_backend == "resend":
        gateways["email"] = _resolve("email", "resend", lambda: ResendGateway(
            api_key=resend_api_key, sender=email_from,
        ))
    else:
        if email_backend not in {"file", "ses"}:
            log.warning("unknown KEA_EMAIL_BACKEND %r — using file", email_backend)
        gateways["email"] = _file("email")

    if sms_backend == "twilio":
        gateways["sms"] = _resolve("sms", "twilio", lambda: TwilioSmsGateway(
            account_sid=twilio_account_sid, auth_token=twilio_auth_token,
            from_number=twilio_from_number,
        ))
    elif sms_backend == "textbelt":
        gateways["sms"] = TextbeltGateway(api_key=textbelt_key)
    else:
        if sms_backend not in {"file", "sns"}:
            log.warning("unknown KEA_SMS_BACKEND %r — using file", sms_backend)
        gateways["sms"] = _file("sms")

    if voice_backend == "twilio":
        gateways["voice"] = _resolve("voice", "twilio", lambda: TwilioVoiceGateway(
            account_sid=twilio_account_sid, auth_token=twilio_auth_token,
            from_number=twilio_from_number,
        ))
    else:
        if voice_backend not in {"file", "connect"}:
            log.warning("unknown KEA_VOICE_BACKEND %r — using file", voice_backend)
        gateways["voice"] = _file("voice")

    from app.alerts.aws_channels import (
        ConnectGateway,
        SesGateway,
        SnsGateway,
        UnavailableGateway,
    )

    builders = {
        "email": (email_backend, "ses", lambda: SesGateway(
            region=aws_region, sender=email_from, configuration_set=ses_configuration_set)),
        "sms": (sms_backend, "sns", lambda: SnsGateway(
            region=aws_region, sender_id=sns_sender_id)),
        "voice": (voice_backend, "connect", lambda: ConnectGateway(
            region=aws_region, instance_id=connect_instance_id, flow_id=connect_flow_id,
            source_number=connect_source_number, prompt_builder=connect_prompt_builder)),
    }
    for channel, (selected, backend, build) in builders.items():
        if selected == backend:
            try:
                gateways[channel] = build()
            except RuntimeError:
                gateways[channel] = UnavailableGateway(channel, backend)

    return GatewayRegistry(gateways)
