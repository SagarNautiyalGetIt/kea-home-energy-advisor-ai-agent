"""What the customer told us about when to interrupt them.

Until now the escalation ladder was three module constants. That is the right default
and the wrong product: 40% over is a shrug for a household spending $400 a month and a
crisis for one spending $90, and the person who knows which is which is the customer.

## What the customer controls, and what they do not

**They control the thresholds.** How far over their own expectation each channel fires
at, which channels are allowed to fire at all, and when their phone is off limits. These
are preferences about *their tolerance*, and there is no defensible way for us to guess
them.

**They do not control the confidence floor.** How certain the forecast has to be before
we escalate is an engineering property of the model, not a taste. Exposing it would let a
customer set "ring me at 90% over, 10% confidence" and then be rung on day three about a
bill that never arrives — and the resulting distrust would land on the product, not on
their setting. The floors are `CONFIDENCE_FLOORS` below, and rise with the tier.

That split is the whole design. Sensitivity is theirs; rigour is ours.

## Defaults reproduce the previous behaviour exactly

15 / 40 / 75 and a $20 floor are the constants the hard-coded ladder used, so a customer
who never opens Settings gets what they got before this module existed. A new preference
system whose defaults change everybody's alerting is a migration, not a feature.
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, model_validator

#: The ladder as it was before this module — see the note above on why these are the
#: defaults rather than something more opinionated.
DEFAULT_TIER_1_PCT = 15.0
DEFAULT_TIER_2_PCT = 40.0
DEFAULT_TIER_3_PCT = 75.0
DEFAULT_MIN_OVERSHOOT_NZD = 20.0

#: Bounds on what a customer may set. The lower bound is not paternalism: below about 5%
#: the overshoot is inside the measurement error of a straight-line projection over a
#: fortnight, so an alert at 3% is an alert on noise and would fire every cycle. The
#: upper bound stops a threshold so high it silently means "never" without saying so —
#: if they want that, `enabled = false` says it honestly and the UI offers it.
MIN_THRESHOLD_PCT = 5.0
MAX_THRESHOLD_PCT = 200.0

DEFAULT_TIMEZONE = "Pacific/Auckland"

#: How certain the forecast must be before each channel fires. The system-owned half of
#: the pair — see the module docstring on why this is not a customer setting. Rises
#: steeply because the cost of being wrong rises steeply: a wrong email is ignored, a
#: wrong phone call is remembered.
#:
#: Lives here rather than in `policy.py` because `analytics.billshock` needs it to decide
#: `triggered`, and `policy` imports `billshock` for typing. This module imports nothing
#: from the package, so it is the one place both can reach without a cycle. `policy`
#: re-exports it, so `from app.alerts.policy import CONFIDENCE_FLOORS` still works.
CONFIDENCE_FLOORS: dict[int, float] = {1: 0.60, 2: 0.75, 3: 0.90}


class AlertPreferences(BaseModel):
    """One household's alerting settings. Pydantic rather than a dataclass because this
    crosses the API boundary in both directions and the validation below is the whole
    point — a threshold ladder that is not monotonic is not a coherent instruction, and
    it must be rejected at the edge rather than sorted out in the policy layer.
    """

    account_ref: str

    enabled: bool = Field(
        default=True,
        description=(
            "Master switch. False means no bill-shock alerting at all on any channel — "
            "the assessment is still computed and still visible in the app, because "
            "turning off the interruption is not the same as turning off the product."
        ),
    )

    tier1_pct: float = Field(
        default=DEFAULT_TIER_1_PCT,
        ge=MIN_THRESHOLD_PCT,
        le=MAX_THRESHOLD_PCT,
        description="Percent over expectation at which an email goes out.",
    )
    tier2_pct: float = Field(
        default=DEFAULT_TIER_2_PCT,
        ge=MIN_THRESHOLD_PCT,
        le=MAX_THRESHOLD_PCT,
        description="Percent over expectation at which a text message goes out.",
    )
    tier3_pct: float = Field(
        default=DEFAULT_TIER_3_PCT,
        ge=MIN_THRESHOLD_PCT,
        le=MAX_THRESHOLD_PCT,
        description="Percent over expectation at which the assistant calls them.",
    )

    min_overshoot_nzd: float = Field(
        default=DEFAULT_MIN_OVERSHOOT_NZD,
        ge=0.0,
        le=500.0,
        description=(
            "Dollar floor under every tier. A percentage alone fires constantly on small "
            "bills — 20% over on a $40 cycle is $8, which nobody wants a text about."
        ),
    )

    email_enabled: bool = True
    sms_enabled: bool = True
    voice_enabled: bool = Field(
        default=False,
        description=(
            "Opt-IN, unlike the other two. An automated call is the most intrusive thing "
            "this product can do and the one most easily mistaken for a scam, so it is "
            "off until the customer asks for it."
        ),
    )

    email: str | None = None
    #: E.164, e.g. +6421234567. Stored normalised so a gateway never has to guess.
    phone_e164: str | None = None

    quiet_hours_start: int | None = Field(
        default=21, ge=0, le=23, description="Local hour after which the phone is off limits."
    )
    quiet_hours_end: int | None = Field(
        default=8, ge=0, le=23, description="Local hour at which it is fair game again."
    )
    timezone: str = DEFAULT_TIMEZONE

    offline_model_opt_in: bool = Field(
        default=False,
        description=(
            "The customer asked for an on-device model because their connection is "
            "unreliable. Lives here rather than in a separate table because it is the "
            "same shape of thing — a per-customer choice about how the product reaches "
            "them — and because the mobile app fetches both in one request on launch."
        ),
    )

    bill_reminders: bool = Field(
        default=True,
        description=(
            "Send a reminder before a bill falls due. Same shape as the flag above and "
            "here for the same reason: it is a per-customer choice about being "
            "contacted. It sat in React state until now, so the Settings screen offered "
            "a switch the alerting engine never heard — the customer turned reminders "
            "off, the toggle moved, and nothing else in the system changed."
        ),
    )

    theme: str = Field(
        default="light",
        pattern="^(light|dark)$",
        description=(
            "Light or dark. Appearance rather than contact, but stored per customer "
            "because a preference kept only in `localStorage` is one they have to set "
            "again on every device and lose whenever the browser is cleared. The client "
            "still writes localStorage first so the theme applies before this request "
            "returns — the stored value is what a second device reads."
        ),
    )

    @model_validator(mode="after")
    def _ladder_must_be_monotonic(self) -> AlertPreferences:
        """A text at 60% and an email at 80% is not a ladder, it is a bug in someone's UI.

        Rejected rather than sorted, because silently reordering a customer's settings
        means the screen they are looking at no longer describes what will happen.
        """
        if not (self.tier1_pct <= self.tier2_pct <= self.tier3_pct):
            raise ValueError(
                "thresholds must increase: email ≤ text ≤ call "
                f"(got {self.tier1_pct}, {self.tier2_pct}, {self.tier3_pct})"
            )
        return self

    @model_validator(mode="after")
    def _timezone_must_exist(self) -> AlertPreferences:
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"unknown timezone {self.timezone!r}") from exc
        return self

    @property
    def thresholds(self) -> dict[int, float]:
        return {1: self.tier1_pct, 2: self.tier2_pct, 3: self.tier3_pct}

    def channel_allowed(self, channel: str) -> bool:
        return {
            "email": self.email_enabled,
            "sms": self.sms_enabled,
            "voice": self.voice_enabled,
        }.get(channel, False)

    def in_quiet_hours(self, at: datetime | None = None) -> bool:
        """Is it currently a time we agreed not to ring them?

        Applies to sms and voice only — email does not make a noise at 3 am, and holding
        it back would delay the written record the Consumer Care Obligations expect us to
        be able to produce.

        Handles the window crossing midnight, which is the normal case: 21:00 to 08:00 is
        two ranges on the clock and one range in a person's head. Getting this wrong in
        the obvious way (`start <= hour < end`) makes the quiet window *inverted* — the
        only hours we would text are the ones they asked us not to.
        """
        if self.quiet_hours_start is None or self.quiet_hours_end is None:
            return False
        if self.quiet_hours_start == self.quiet_hours_end:
            return False

        moment = (at or datetime.now(UTC)).astimezone(ZoneInfo(self.timezone))
        now = moment.time()
        start = time(hour=self.quiet_hours_start)
        end = time(hour=self.quiet_hours_end)

        if start < end:
            return start <= now < end
        return now >= start or now < end

    def next_open(self, at: datetime | None = None) -> datetime | None:
        """When the quiet window ends, in UTC. None if we are not in one.

        Computed in the customer's local timezone and converted back, rather than by
        adding hours to a UTC instant. New Zealand shifts by an hour twice a year, and a
        message scheduled with UTC arithmetic on the last Sunday in September arrives an
        hour inside the window it was supposed to wait for.
        """
        if not self.in_quiet_hours(at):
            return None

        zone = ZoneInfo(self.timezone)
        moment = (at or datetime.now(UTC)).astimezone(zone)
        end_hour = self.quiet_hours_end or 0

        opens = moment.replace(hour=end_hour, minute=0, second=0, microsecond=0)
        if opens <= moment:
            # The window ends tomorrow morning — the normal case for 21:00-08:00.
            opens = opens + timedelta(days=1)
        return opens.astimezone(UTC)


def defaults_for(account_ref: str) -> AlertPreferences:
    """What a household gets before anyone opens Settings.

    A function rather than a module constant so callers cannot mutate a shared object —
    Pydantic models are mutable by default, and one handler assigning to a shared default
    would change every other household's thresholds for the life of the process.
    """
    return AlertPreferences(account_ref=account_ref)
