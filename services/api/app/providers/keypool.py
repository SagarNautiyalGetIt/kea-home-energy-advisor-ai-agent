"""Several Gemini keys, one at a time, rotated when one runs out of quota.

Gemini's free tier is **20 requests per day and 5 per minute, per model, per project**.
Measured 2026-09-08. One agent turn costs two or three requests after the account summary
is pre-loaded, and voice spends another on transcription — so a single key is roughly
seven to ten customer questions a day. That is not enough to rehearse a demo on, let alone
run one, and the failure is not graceful: the quota error surfaces as `AgentUnavailable`
and reads to a user as "it sometimes doesn't respond".

This pool holds several keys and moves to the next when the current one is exhausted. Each
key is a separate free-tier project, so N keys is N times the daily allowance.

## What this is not

**It is not a way around a rate limit.** Each key gets exactly the quota Google issued it,
and nothing here retries a key that has capacity in order to get more out of it. It uses
allowances the account holder already has, in sequence, instead of stopping at the first
one — which is the same thing as having several browser profiles signed in, and no more.

**It is not a substitute for a billed key.** Rotation buys a demo; it does not buy a
product. `config.py` already says to plan a rehearsal around a billed key or the AWS
account, and that stays true — this just means the free tier is usable while that is being
sorted out.

## Why cooldown rather than round-robin

A round robin spreads requests evenly, which sounds better and is worse: every key ends up
partly consumed, and the per-minute limit is then hit on all of them at once during the
one burst that matters. Instead a key is used until it says no, then parked for a cooldown
and the next one takes over. The result is that at any moment there is one key doing the
work and the others are untouched — which is also the arrangement that fails most
legibly, because "key 2 of 4 in use" describes the state completely.

Two cooldowns, because the two limits mean different things:

* **A minute limit** is over in a minute. The key is parked briefly and comes back.
* **A daily limit** is over tomorrow. Parking that key for a minute means walking back into
  the same wall repeatedly, so it is parked for the rest of the session.

The difference is read off the error message, which is crude for the same reason
`loop._is_transient` is crude: three provider SDKs raise three unrelated exception
hierarchies and importing all of them here would drag every SDK into a module that
deliberately depends on none.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

#: How long a key that hit a per-minute limit is rested. A little over the window, because
#: coming back exactly on the boundary reliably trips it again.
MINUTE_COOLDOWN_S = 70.0

#: How long a key that hit its DAILY limit is rested. Not actually until midnight Pacific —
#: the reset time is not in the error and guessing a timezone would park a good key for
#: hours. Twelve hours is long enough that it will not be tried again during a demo, and
#: short enough that a long-running process picks it up the next day.
DAILY_COOLDOWN_S = 12 * 60 * 60

#: Markers that mean "this key is out for the day" rather than "slow down".
#:
#: Google's quota failures all arrive as 429 RESOURCE_EXHAUSTED and the distinction is in
#: the violation detail. Matching on the text is crude and fails safe: a daily limit
#: mistaken for a per-minute one costs one wasted call a minute later, while the reverse
#: costs nothing but an idle key.
_DAILY_MARKERS = (
    "PerDay",
    "per day",
    "GenerateRequestsPerDayPerProjectPerModel",
    "quota_metric",
    "FreeTier",
)

_QUOTA_MARKERS = ("429", "RESOURCE_EXHAUSTED", "quota", "rate limit", "rateLimitExceeded")


def is_quota_error(exc: BaseException) -> bool:
    text = f"{type(exc).__name__}: {exc}"
    return any(m.lower() in text.lower() for m in _QUOTA_MARKERS)


def is_daily_quota_error(exc: BaseException) -> bool:
    text = f"{type(exc).__name__}: {exc}"
    return is_quota_error(exc) and any(m.lower() in text.lower() for m in _DAILY_MARKERS)


@dataclass
class _Key:
    value: str
    label: str
    """`GEMINI_API_KEY_2` and so on — never the key itself. This goes in logs and on
    /health, and a rotation feature that prints credentials into a log file would be a
    worse problem than the quota it solves."""

    rested_until: float = 0.0
    reason: str = ""
    uses: int = 0

    @property
    def available(self) -> bool:
        return time.monotonic() >= self.rested_until


@dataclass
class KeyPool:
    """The keys, in the order they were configured, with the current one first-come.

    Deliberately not thread-safe beyond what CPython gives for free. The API is a single
    async process; two coroutines racing on `current()` would at worst both use the same
    key, which is the normal case anyway.
    """

    keys: list[_Key] = field(default_factory=list)

    @property
    def configured(self) -> int:
        return len(self.keys)

    def current(self) -> _Key | None:
        """The first key not resting, or None when they are all parked."""
        for key in self.keys:
            if key.available:
                return key
        return None

    def rest(self, key: _Key, *, daily: bool) -> None:
        cooldown = DAILY_COOLDOWN_S if daily else MINUTE_COOLDOWN_S
        key.rested_until = time.monotonic() + cooldown
        key.reason = "daily quota exhausted" if daily else "per-minute limit"
        remaining = sum(1 for k in self.keys if k.available)
        # WARNING rather than INFO for the daily case: it is the line somebody greps for
        # when asked why the assistant stopped answering an hour into a demo.
        (log.warning if daily else log.info)(
            "gemini key %s parked (%s) — %d of %d keys still available",
            key.label, key.reason, remaining, len(self.keys),
        )

    def describe(self) -> dict[str, object]:
        """For `/health`. Labels and counts, never a key.

        Surfaced for the same reason the recorder and the alert gateways are: "the
        assistant is not answering" and "every key in the pool is out of quota until
        tomorrow" look identical from outside, and only one of them is fixed by waiting.
        """
        return {
            "keys_configured": len(self.keys),
            "keys_available": sum(1 for k in self.keys if k.available),
            "in_use": (c.label if (c := self.current()) else None),
            "resting": [
                {
                    "key": k.label,
                    "reason": k.reason,
                    "seconds_remaining": int(max(0.0, k.rested_until - time.monotonic())),
                }
                for k in self.keys
                if not k.available
            ],
            "requests_served": sum(k.uses for k in self.keys),
        }


def build_pool(
    primary: str = "", extras: str = "", numbered: dict[str, str] | None = None
) -> KeyPool:
    """Assemble the pool from the environment, in a fixed and documented order.

    Three sources, because there is no single convention people reach for and a rotation
    feature that only reads one of them looks broken to whoever guessed differently:

        GEMINI_API_KEY            the existing single key — always first, so nothing
                                  about an existing .env changes behaviour
        GEMINI_API_KEYS           comma-separated, for adding several at once
        GEMINI_API_KEY_2..N       numbered, for adding them one at a time

    Duplicates are dropped, keeping the first occurrence. Pasting the same key into both
    `GEMINI_API_KEY` and `GEMINI_API_KEYS` is the obvious mistake, and a pool holding it
    twice would report double the capacity it has and rotate from a key onto itself.
    """
    seen: set[str] = set()
    keys: list[_Key] = []

    def add(value: str, label: str) -> None:
        value = value.strip()
        if not value or value in seen:
            return
        seen.add(value)
        keys.append(_Key(value=value, label=label))

    add(primary, "GEMINI_API_KEY")
    for i, part in enumerate(extras.split(","), start=1):
        add(part, f"GEMINI_API_KEYS[{i}]")
    for name, value in sorted((numbered or {}).items()):
        add(value, name)

    return KeyPool(keys=keys)
