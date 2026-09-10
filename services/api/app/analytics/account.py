"""The account facts layer 1 was never given.

## The gap this closes

`MartRepository.context()` reads two mart rows and throws almost all of both away. It
selects `mart_account_context` for `icp_id` and `customer_name`, then discards the plan,
the network, the solar and controlled-load flags, the billing cycle, the consumer-care
flags and the read quality. It selects `mart_daily_usage` for `import_kwh` and degree
days, discarding base load, export, controlled, peak, off-peak, interval counts,
weekends and public holidays. `mart_bill_explanation`, `mart_forecast_input`,
`bill_forecast` and `mart_hourly_profile` are modelled in `db/marts.py` and read by
nothing at all.

So layer 1 sees five numbers — a list of daily totals, a peer baseline, a label, degree
days, and a normal — and layer 2 can only be as specific as the facts it is handed.
That, and not the model, is why the bill explanation reads as generic: **the answer was
never computed, because the data never arrived.** Every prompt-level fix for that is
treating a symptom.

The pieces here are plain frozen dataclasses rather than ORM rows on purpose. Layer 1 is
pure and synchronous, and the golden set runs it with no event loop and no database; the
repository does the I/O and hands over values. That seam already exists for
`UsageWindow` and this follows it rather than inventing a second convention.

**No PII crosses into a `FactBundle`.** Name, address, email and phone live here because
account lookups need them to *answer*, but `schemas.FactBundle` deliberately carries
none of it, and the bundle builders in `explain.py` are what enforce that boundary.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from app.analytics.drivers import BillPeriod


@dataclass(frozen=True)
class PlanFacts:
    """The plan as rated, from `catalogue` via `mart_account_context`.

    `daily_fixed_nzd` is the summed per-day components — network daily, metering daily,
    levies. It is separated from the variable rate throughout because the two are
    different answers to a customer: nothing they do with a switch or a timer changes
    the fixed half, and telling someone to use less power when their increase was a
    daily-charge rise is advice that cannot work.
    """

    code: str
    name: str
    user_type: str
    """`low_user` | `standard` — the NZ regulated categories."""

    is_tou: bool = False
    daily_fixed_nzd: float | None = None
    unit_rate_nzd: float | None = None
    term_months: int = 0
    prompt_payment_discount_pct: float = 0.0

    @property
    def is_low_user(self) -> bool:
        return self.user_type == "low_user"


@dataclass(frozen=True)
class ConnectionFacts:
    """Where the power is delivered. From `metering` via `mart_account_context`."""

    icp_number: str
    address_display: str | None = None
    climate_region: str | None = None
    network_name: str | None = None
    network_code: str | None = None
    has_solar: bool = False
    has_controlled_load: bool = False


@dataclass(frozen=True)
class BillingFacts:
    """Where the customer is in their cycle, and what they owe.

    `days_into_period` is pre-computed by the pipeline rather than derived here, because
    the mid-cycle warning needs it on every request and a date arithmetic bug in the hot
    path is the kind of thing that shows up as a warning firing on the wrong day.
    """

    account_number: str
    balance_nzd: float | None = None
    last_bill_total_nzd: float | None = None
    due_date: dt.date | None = None
    payment_method: str | None = None
    billing_cycle_day: int | None = None
    current_period_start: dt.date | None = None
    current_period_end: dt.date | None = None
    days_into_period: int | None = None

    @property
    def days_until_due(self) -> int | None:
        """None rather than a negative number when the date has passed — an overdue bill
        is a different conversation from an upcoming one, and the caller must not be able
        to render "due in -4 days"."""
        if self.due_date is None:
            return None
        delta = (self.due_date - dt.date.today()).days
        return delta if delta >= 0 else None

    @property
    def is_overdue(self) -> bool:
        return self.due_date is not None and self.due_date < dt.date.today()


@dataclass(frozen=True)
class DataQuality:
    """How much the figures can be leaned on, surfaced rather than hidden.

    This exists because of the failure shape this repo keeps producing: a system that
    degrades and still reports success. `/health` discloses `recording`, `data_source`
    and `voice.ready` for the same reason. Read quality is the per-account version of
    that disclosure — a green `/health` says nothing about whether *this* customer's
    month was estimated.
    """

    estimated_read_pct: float = 0.0
    missing_intervals: int = 0
    last_read_at: dt.datetime | None = None
    is_quarantined: bool = False
    quarantine_reason: str | None = None
    mart_built_at: dt.datetime | None = None

    @property
    def must_hedge(self) -> bool:
        """Should the narration soften every figure it quotes?"""
        return self.estimated_read_pct >= 10.0 or self.missing_intervals > 0

    @property
    def must_decline(self) -> bool:
        """A quarantined account has unresolved cross-system references — an ICP or plan
        code with no match. The pipeline design is explicit that the agent DECLINES
        rather than answers here: an explanation built on a connection we cannot see is
        worse than no explanation."""
        return self.is_quarantined

    @property
    def staleness_days(self) -> int | None:
        if self.mart_built_at is None:
            return None
        return (dt.datetime.now(dt.UTC) - self.mart_built_at).days


@dataclass(frozen=True)
class DayUsage:
    """One day, with every column the mart carries rather than just the total.

    `base_load_kwh` is the one that matters most and the one the old path dropped: it is
    the overnight percentile, the draw the house never falls below. It is both the most
    explanatory figure available — *"you draw 350 W around the clock, about $480 a year
    before you switch anything on"* — and the most actionable, because it is the only
    number a household can move without noticing the difference.
    """

    date: dt.date
    import_kwh: float
    export_kwh: float = 0.0
    controlled_kwh: float = 0.0
    uncontrolled_kwh: float = 0.0
    base_load_kwh: float | None = None
    peak_kwh: float | None = None
    off_peak_kwh: float | None = None
    temp_mean_c: float | None = None
    heating_degree_days: float | None = None
    is_weekend: bool = False
    is_public_holiday: bool = False
    estimated_count: int = 0
    interval_count: int = 48
    expected_intervals: int = 48

    @property
    def is_complete(self) -> bool:
        """48 is a normal day; 46 and 50 happen at the daylight-saving transitions, so a
        short day is not automatically a gap. Comparing against the mart's own
        `expected_intervals` rather than the constant 48 is what keeps the two DST days
        of the year from being reported as missing data."""
        return self.interval_count >= self.expected_intervals


@dataclass(frozen=True)
class AccountContext:
    """Everything known about one account, assembled once per request.

    Every field is optional below `account_ref` because the three sources populate
    different amounts: the mart repository fills nearly all of it, the seeded `public.*`
    households fill the usage half, and the fixtures fill only the window. A bundle
    builder asks what it has rather than assuming, and says so when the answer is not
    available — which is the same discipline the rest of this service applies to
    figures it cannot compute.
    """

    account_ref: str
    display_name: str = ""

    plan: PlanFacts | None = None
    connection: ConnectionFacts | None = None
    billing: BillingFacts | None = None
    quality: DataQuality = field(default_factory=DataQuality)

    days: list[DayUsage] = field(default_factory=list)
    """The daily series with every column, most recent last."""

    current_bill: BillPeriod | None = None
    prior_bill: BillPeriod | None = None
    """The two sides of the comparison. `prior_bill` is None for a first bill — which is
    itself a complete explanation and one the narration should give, not treat as an
    error."""

    heating_sensitivity_kwh_per_hdd: float | None = None
    weather_fit_r2: float | None = None
    """This household's own fitted slope. Never a population constant: a weather
    attribution built on somebody else's heating sensitivity is a fabrication with a
    regression stapled to it."""

    peer_baseline_kwh_per_day: float | None = None
    """What comparable homes use. Must never be derived from this household — doing that
    once inflated a spike's apparent share from 11% to 71%."""

    is_medically_dependent: bool = False
    is_vulnerable: bool = False
    """Consumer Care flags. They change what the agent is *allowed* to say and when it
    must escalate, so they ride on the context every handler already has rather than
    behind a lookup one of them might skip."""

    # ── derived views over the series ──

    @property
    def has_bill_comparison(self) -> bool:
        return self.current_bill is not None and self.prior_bill is not None

    @property
    def total_import_kwh(self) -> float:
        return sum(d.import_kwh for d in self.days)

    @property
    def total_export_kwh(self) -> float:
        return sum(d.export_kwh for d in self.days)

    @property
    def total_controlled_kwh(self) -> float:
        return sum(d.controlled_kwh for d in self.days)

    @property
    def mean_base_load_kwh(self) -> float | None:
        vals = [d.base_load_kwh for d in self.days if d.base_load_kwh is not None]
        return sum(vals) / len(vals) if vals else None

    @property
    def period_label(self) -> str:
        if not self.days:
            return ""
        return f"{self.days[-1].date:%B %Y}"

    @property
    def has_gaps(self) -> bool:
        return any(not d.is_complete for d in self.days)

    def controlled_load_shift(self, tail_days: int = 10) -> float | None:
        """Change in daily controlled-load kWh, recent window against the rest.

        ## Why this is the one appliance signal that is not a fabrication

        `NO_APPLIANCE` is stated everywhere in this service and it is correct: a
        whole-house meter reads one number, so attributing it to a dryer is invention.

        **Controlled load is different, and the difference is physical rather than
        statistical.** A ripple-controlled circuit is its own register — the network
        switches it, and `mart_daily_usage.controlled_kwh` is metered separately from
        `uncontrolled_kwh`. In New Zealand that circuit is the hot-water cylinder in the
        overwhelming majority of homes. So a rise here is not an inference about which
        appliance moved; it is a reading from the circuit that appliance is on.

        That still does not license *asserting* it was the cylinder — a controlled
        circuit can carry other things, and "typically hot water" is not "certainly". It
        licenses **asking**, which is the honest use of a signal this strong: the
        household knows what is on their controlled circuit and we do not.

        Returns None when the account has no controlled register or too short a series.
        None means "no signal", never "no change" — the hot-water question then falls
        back to its position at the bottom of the ladder rather than being promoted.
        """
        if len(self.days) < tail_days * 2:
            return None
        controlled = [d.controlled_kwh for d in self.days]
        if not any(controlled):
            return None
        recent = controlled[-tail_days:]
        earlier = controlled[:-tail_days]
        return sum(recent) / len(recent) - sum(earlier) / len(earlier)

    @classmethod
    def from_window(
        cls,
        account_ref: str,
        window: object,
        *,
        label: str = "",
        hdd: list[float] | None = None,
        peer_baseline: float | None = None,
    ) -> AccountContext:
        """Build the thinnest possible context from a `UsageWindow` alone.

        This is the fixture and seeded-household path. It carries **no plan, no bill and
        no account row**, because those sources genuinely do not have them — the five
        demo households are a list of daily kWh totals and a benchmark.

        The result is a context in which `has_bill_comparison` is False and every
        account lookup returns its "I cannot see that" bundle. That is the correct
        behaviour rather than a limitation to work around: inventing a plausible plan
        name for a fixture household so the demo has something to say is precisely the
        fabrication this service exists to prevent, and it would be invisible to layer 3
        because a plan name contains no numeric token.

        Dates are synthesised only as *ordinals* for the day series — the fixtures have
        no calendar, and nothing downstream may present these as observed dates.
        """
        import datetime as dt

        daily = list(getattr(window, "daily_kwh", []) or [])
        hdd = list(hdd or [])
        # An arbitrary but stable anchor. The fixtures describe "July 2026" in their own
        # PERIOD constant and carry no real dates; this exists so the series has an
        # ordering, not so that any date can be quoted.
        anchor = dt.date(2026, 7, 1)
        days = [
            DayUsage(
                date=anchor + dt.timedelta(days=i),
                import_kwh=kwh,
                heating_degree_days=hdd[i] if i < len(hdd) else None,
            )
            for i, kwh in enumerate(daily)
        ]
        return cls(
            account_ref=account_ref,
            display_name=label,
            days=days,
            peer_baseline_kwh_per_day=peer_baseline,
        )

    def escalation_reason(self) -> str | None:
        """Why this account must reach a person regardless of what was asked.

        Medical dependence is not a hedge on the answer — it is a category of customer
        for whom a disconnection conversation carries a different duty of care, and the
        Consumer Care Obligations put that duty on the retailer rather than on whoever
        happens to be handling the contact.
        """
        if self.quality.must_decline:
            why = self.quality.quarantine_reason or "unresolved references"
            return f"account data is quarantined: {why}"
        if self.is_medically_dependent:
            return "customer is registered medically dependent"
        return None
