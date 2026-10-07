"""Expo push adapter. Opt-in, generic notices, acceptance distinct from delivery."""

import os
from datetime import UTC, datetime

import httpx

from app.account import client_state


async def notify(account: str, period: str, enabled: bool) -> int:
    if not enabled or os.getenv("KEA_EXPO_PUSH_ENABLED", "0") != "1":
        return 0
    accepted = 0
    async with httpx.AsyncClient(timeout=10) as client:
        for owner, key, registration in await client_state.records("push:", "__devices__"):
            if registration.get("account") != account or not registration.get("enabled"):
                continue
            try:
                expired = datetime.fromisoformat(
                    registration.get("expires_at", "")
                ) <= datetime.now(UTC)
            except ValueError:
                expired = True
            if expired:
                await client_state.update_device(key, account, None)
                continue
            # Claim before I/O: ambiguous failures never automatically resend this cycle.
            if not await client_state.claim_period(owner, key, period, account):
                continue
            registration.update(claimed_period=period, claimed_at=datetime.now(UTC).isoformat())
            await client_state.update_device(
                key, account, {"claimed_at": registration["claimed_at"]}
            )
            try:
                response = await client.post(
                    "https://exp.host/--/api/v2/push/send",
                    json={
                        "to": registration["token"],
                        "title": "Kea Energy",
                        "body": "You have a new energy notice. Open Kea to view it securely.",
                        "data": {"screen": "dashboard"},
                        "sound": "default",
                    },
                )
                response.raise_for_status()
                ticket = response.json().get("data", {})
                if ticket.get("status") == "ok":
                    registration.update(ticket_id=ticket.get("id"), status="accepted")
                    accepted += 1
                elif ticket.get("details", {}).get("error") == "DeviceNotRegistered":
                    await client_state.update_device(key, account, None)
                    continue
                else:
                    registration["status"] = "rejected"
            except (httpx.HTTPError, ValueError):
                registration["status"] = "unknown"
            await client_state.update_device(
                key,
                account,
                {
                    name: registration[name]
                    for name in ("status", "ticket_id")
                    if name in registration
                },
            )
    return accepted
