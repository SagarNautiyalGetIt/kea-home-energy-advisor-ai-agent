"""Changing a household's alerting from inside a conversation.

The read tools in `agent/tools.py` are safe to call twice. These are not, so they live
apart — a module boundary rather than a naming convention, because the property that makes
a write tool dangerous is invisible at the call site and somebody will eventually add a
tool to whichever file is open.

## What may be changed here, and the rule that decides

Anything the customer could change on the Settings screen themselves, reversibly, in one
sentence: how far over their expectation each channel fires at, the dollar floor under all
of them, which channels are on at all, and when their phone is off limits.

Nothing that moves money, changes who is liable for a supply, or touches a credential. Not
because a model cannot be trusted to be careful, but because those actions need something
the assistant must never hold — a card number, a bank authority, an identity check — or
because they change a legal relationship, which is not a thing to do on the strength of one
sentence in a chat window. `app/knowledge/articles.py:what-sparky-can-change` is the
customer-facing statement of the same list, and the two are meant to be read together.

## Why a diff comes back rather than an acknowledgement

`apply()` returns what changed, from what, to what — and the model is told to say it. "Done"
is not a confirmation, because the customer has no way to tell "done" from "I misunderstood
you and set the text threshold instead of the email one". A customer who asked for 20% and
is told "your text alert now fires at 20% over, up from 40%" can catch the mistake in the
sentence that made it.

## The validation is not here

`AlertPreferences` already refuses a non-monotonic ladder, a threshold outside 5-200%, and
an unknown timezone, and it refuses them at the model boundary with a readable message. So
this module builds the updated object and lets Pydantic reject it, rather than
re-implementing the rules in a second place that can drift from the first. A rejection
comes back to the model as a tool error it can correct, which it reliably does.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.alerts.preferences import (
    MAX_THRESHOLD_PCT,
    MIN_THRESHOLD_PCT,
    AlertPreferences,
)

log = logging.getLogger(__name__)

#: Which channel each threshold belongs to, in the customer's words. The model is given
#: these names rather than `tier1_pct`, because a customer says "text me" and never says
#: "tier 2", and a mapping the model has to infer is a mapping it will occasionally invert.
CHANNEL_FIELDS: dict[str, str] = {
    "email": "tier1_pct",
    "sms": "tier2_pct",
    "voice": "tier3_pct",
}

CHANNEL_ENABLED_FIELDS: dict[str, str] = {
    "email": "email_enabled",
    "sms": "sms_enabled",
    "voice": "voice_enabled",
}

#: How each field reads back to a customer. Used to build the diff sentence, so the change
#: is described in the words they used rather than in the column name.
_LABELS: dict[str, str] = {
    "enabled": "bill-shock warnings",
    "tier1_pct": "the email warning threshold",
    "tier2_pct": "the text warning threshold",
    "tier3_pct": "the phone call threshold",
    "min_overshoot_nzd": "the dollar floor under every warning",
    "email_enabled": "email warnings",
    "sms_enabled": "text warnings",
    "voice_enabled": "phone call warnings",
    "quiet_hours_start": "the hour quiet time starts",
    "quiet_hours_end": "the hour quiet time ends",
}

_PERCENT_FIELDS = frozenset({"tier1_pct", "tier2_pct", "tier3_pct"})
_HOUR_FIELDS = frozenset({"quiet_hours_start", "quiet_hours_end"})
_BOOL_FIELDS = frozenset(
    {"enabled", "email_enabled", "sms_enabled", "voice_enabled"}
)


@dataclass(frozen=True)
class FieldChange:
    field: str
    label: str
    before: object
    after: object

    def describe(self) -> str:
        """One sentence a customer can check the change against."""
        if self.field in _BOOL_FIELDS:
            return f"{self.label} turned {'on' if self.after else 'off'}"
        if self.field in _PERCENT_FIELDS:
            return f"{self.label} moved from {self.before:g}% to {self.after:g}% over"
        if self.field in _HOUR_FIELDS:
            return f"{self.label} moved from {self.before}:00 to {self.after}:00"
        if self.field == "min_overshoot_nzd":
            return f"{self.label} moved from ${self.before:g} to ${self.after:g}"
        return f"{self.label} changed from {self.before} to {self.after}"


class SettingsError(ValueError):
    """A change that cannot be made, with a message written for the model to act on."""


def build(
    current: AlertPreferences,
    *,
    channel: str | None = None,
    threshold_pct: float | None = None,
    minimum_nzd: float | None = None,
    turn_on: list[str] | None = None,
    turn_off: list[str] | None = None,
    quiet_from_hour: int | None = None,
    quiet_until_hour: int | None = None,
    warnings_enabled: bool | None = None,
) -> tuple[AlertPreferences, list[FieldChange]]:
    """Work out the new settings and what moved. Pure — no I/O, so it is unit-testable.

    Raises `SettingsError` for a request that cannot be honoured, and lets
    `AlertPreferences` raise for one that is individually valid and jointly incoherent
    (a text at 60% under an email at 80%). Both come back to the model as an error result
    it can correct rather than as a 500.
    """
    updates: dict[str, object] = {}

    if threshold_pct is not None:
        if channel is None:
            raise SettingsError(
                "a threshold needs a channel — say which of email, sms or voice it is "
                "for. Setting all three from one number would silently flatten the "
                "ladder the customer already has."
            )
        if channel not in CHANNEL_FIELDS:
            raise SettingsError(
                f"unknown channel {channel!r}. Valid channels are: "
                f"{', '.join(CHANNEL_FIELDS)}."
            )
        if not MIN_THRESHOLD_PCT <= threshold_pct <= MAX_THRESHOLD_PCT:
            raise SettingsError(
                f"{threshold_pct}% is outside the range a threshold can take "
                f"({MIN_THRESHOLD_PCT:g}% to {MAX_THRESHOLD_PCT:g}%). Below "
                f"{MIN_THRESHOLD_PCT:g}% the overshoot is inside the measurement error of "
                "the projection, so the alert would fire on noise every cycle. If they "
                "want no warnings on that channel, turn the channel off instead — that "
                "says it honestly."
            )
        updates[CHANNEL_FIELDS[channel]] = float(threshold_pct)

    if minimum_nzd is not None:
        if minimum_nzd < 0:
            raise SettingsError("the dollar floor cannot be negative")
        updates["min_overshoot_nzd"] = float(minimum_nzd)

    for name in turn_on or []:
        if name not in CHANNEL_ENABLED_FIELDS:
            raise SettingsError(f"unknown channel {name!r} to turn on")
        updates[CHANNEL_ENABLED_FIELDS[name]] = True

    for name in turn_off or []:
        if name not in CHANNEL_ENABLED_FIELDS:
            raise SettingsError(f"unknown channel {name!r} to turn off")
        if name in (turn_on or []):
            raise SettingsError(f"{name} is in both turn_on and turn_off")
        updates[CHANNEL_ENABLED_FIELDS[name]] = False

    if quiet_from_hour is not None:
        if not 0 <= quiet_from_hour <= 23:
            raise SettingsError("quiet hours start must be an hour from 0 to 23")
        updates["quiet_hours_start"] = quiet_from_hour
    if quiet_until_hour is not None:
        if not 0 <= quiet_until_hour <= 23:
            raise SettingsError("quiet hours end must be an hour from 0 to 23")
        updates["quiet_hours_end"] = quiet_until_hour

    if warnings_enabled is not None:
        updates["enabled"] = bool(warnings_enabled)

    if not updates:
        raise SettingsError(
            "no change was asked for. Say what you understood them to want and ask them "
            "to confirm the specific setting rather than guessing at one."
        )

    changes = [
        FieldChange(
            field=name,
            label=_LABELS.get(name, name),
            before=getattr(current, name),
            after=value,
        )
        for name, value in updates.items()
        if getattr(current, name) != value
    ]

    # Every field they asked for already holds the value they asked for. Not an error, and
    # emphatically not a silent no-op: the honest reply is "that is already how it is set",
    # which is a better answer than a confirmation of a change that did not happen.
    if not changes:
        return current, []

    # Rebuilt through `model_validate` rather than `model_copy(update=...)`. That
    # distinction is the whole safety of this function: `model_copy` assigns the fields and
    # skips every validator, so a request to put the text alert at 60% under an email alert
    # at 80% would be saved, and the customer's Settings screen would then describe a
    # ladder that cannot fire in the order it shows. Validating rebuilds the object through
    # the monotonic check and the bounds, and a rejection comes back to the model as a tool
    # error it can correct.
    return AlertPreferences.model_validate({**current.model_dump(), **updates}), changes


def ladder_after(prefs: AlertPreferences) -> dict[str, object]:
    """The whole ladder as it now stands, in the customer's terms.

    Returned alongside the diff because a single threshold is meaningless on its own — a
    customer who moves their text alert to 20% needs to see that their email alert is still
    at 15%, or they will assume the first warning they get is the text.
    """
    return {
        "warnings_enabled": prefs.enabled,
        "email": {
            "on": prefs.email_enabled,
            "fires_at_pct_over": prefs.tier1_pct,
            "address_on_file": bool(prefs.email),
        },
        "sms": {
            "on": prefs.sms_enabled,
            "fires_at_pct_over": prefs.tier2_pct,
            "number_on_file": bool(prefs.phone_e164),
        },
        "voice": {
            "on": prefs.voice_enabled,
            "fires_at_pct_over": prefs.tier3_pct,
            "number_on_file": bool(prefs.phone_e164),
        },
        "dollar_floor_under_every_warning_nzd": prefs.min_overshoot_nzd,
        "quiet_hours": (
            f"{prefs.quiet_hours_start}:00 to {prefs.quiet_hours_end}:00 "
            f"{prefs.timezone}"
            if prefs.quiet_hours_start is not None and prefs.quiet_hours_end is not None
            else None
        ),
        "quiet_hours_note": (
            "Quiet hours hold back texts and calls only. Email still goes out — it makes "
            "no noise at 3am and it is the written record."
        ),
    }
