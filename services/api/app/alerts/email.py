"""Sending the tier-1 warning.

Two backends behind one interface, chosen by `KEA_EMAIL_BACKEND`:

* **`file`** (default) — writes a real RFC 5322 `.eml` to `var/outbox/`. Costs nothing,
  needs no credential, works with the wifi off, and the file opens in any mail client
  so what you see is genuinely what would have been sent. This is what the demo runs.
* **`smtp`** — `smtplib` over STARTTLS. Standard library, so no dependency and no
  vendor. Reads its credential from the environment.

## Why the default is a file and not a real send

The demo machine is on conference wifi. An SMTP handshake that hangs for 30 seconds
because port 587 is blocked would take the bill-shock warning down with it — and the
warning is half the product. The file backend cannot fail that way, and "here is the
email, on screen, with the figures in it" makes the same point to a judge as an inbox
does.

The credential is never read from a file in the repo and never logged. `.env` is
gitignored; if `KEA_SMTP_PASSWORD` is unset the SMTP backend refuses to start rather
than falling back silently, because a mail path that quietly degrades to "no mail" is
the failure this whole module exists to make visible.

## The one thing this module must not do

It must not compose a figure. The body arrives fully rendered from `app.alerts.render`,
built from the same verified fact bundle the dashboard and the assistant use. Nothing
here formats a dollar amount, because a number that appears only in an email is a
number layer 3 never checked.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Protocol

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Outcome:
    """What happened, in the shape `app.alert` records.

    `detail` is for the failure_reason column, so a failed send explains itself in the
    table rather than only in a log nobody kept.
    """

    delivered: bool
    detail: str | None = None
    #: Where it went — a file path, or the SMTP host. Shown in the UI so the demo can
    #: point at the artefact rather than asserting it exists.
    destination: str | None = None


class EmailSender(Protocol):
    name: str

    def send(self, *, to: str, subject: str, body: str) -> Outcome: ...


def _build(to: str, sender: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message["Date"] = datetime.now(UTC).strftime("%a, %d %b %Y %H:%M:%S +0000")
    message.set_content(body)
    return message


class FileSender:
    """Writes the message to disk instead of a socket.

    Not a mock — the bytes are a valid message, and `open var/outbox/*.eml` shows
    exactly what SMTP would have transmitted. The filename leads with a UTC timestamp
    so the directory sorts chronologically during a rehearsal.
    """

    name = "file"

    def __init__(self, outbox: Path, sender: str) -> None:
        self._outbox = outbox
        self._sender = sender

    def send(self, *, to: str, subject: str, body: str) -> Outcome:
        try:
            self._outbox.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%f")
            # `to` reaches a filename, so anything path-ish in it has to go. An address
            # is not attacker-controlled here, but this is one line and the failure it
            # prevents is writing outside the outbox.
            safe_to = "".join(c if c.isalnum() or c in "._-@" else "_" for c in to)
            path = self._outbox / f"{stamp}-{safe_to}.eml"
            path.write_bytes(bytes(_build(to, self._sender, subject, body)))
        except OSError as exc:
            log.exception("could not write alert email to the outbox")
            return Outcome(delivered=False, detail=f"outbox write failed: {exc}")

        log.info("alert email written to %s", path)
        return Outcome(delivered=True, destination=str(path))


class SmtpSender:
    """STARTTLS over `smtplib`. No dependency, no vendor, no account of ours."""

    name = "smtp"

    def __init__(
        self, *, host: str, port: int, username: str, password: str, sender: str, timeout: int
    ) -> None:
        if not password:
            # Loud, at construction, rather than a silent no-op at send time.
            raise RuntimeError(
                "KEA_EMAIL_BACKEND=smtp but KEA_SMTP_PASSWORD is empty. Set it in .env "
                "(gitignored), or use the default file backend."
            )
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._sender = sender
        self._timeout = timeout

    def send(self, *, to: str, subject: str, body: str) -> Outcome:
        message = _build(to, self._sender, subject, body)
        try:
            with smtplib.SMTP(self._host, self._port, timeout=self._timeout) as client:
                client.starttls(context=ssl.create_default_context())
                client.login(self._username, self._password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException) as exc:
            # Deliberately does not include the exception's repr in `detail` beyond its
            # message: SMTPAuthenticationError stringifies the server's response, which
            # is safe, but never log the password itself.
            log.exception("SMTP send failed to %s", self._host)
            return Outcome(delivered=False, detail=f"smtp send failed: {exc}")

        log.info("alert email sent via %s to %s", self._host, to)
        return Outcome(delivered=True, destination=self._host)


def build_sender(
    *,
    backend: str,
    outbox: Path,
    sender: str,
    host: str = "",
    port: int = 587,
    username: str = "",
    password: str = "",
    timeout: int = 10,
) -> EmailSender:
    """The only place a sender is constructed. Unknown backends fall back to `file`
    with a warning rather than raising — a typo in an env var should not take the API
    down, but it must not be silent either."""
    if backend == "smtp":
        return SmtpSender(
            host=host,
            port=port,
            username=username,
            password=password,
            sender=sender,
            timeout=timeout,
        )
    if backend != "file":
        log.warning("unknown KEA_EMAIL_BACKEND %r — falling back to the file backend", backend)
    return FileSender(outbox=outbox, sender=sender)
