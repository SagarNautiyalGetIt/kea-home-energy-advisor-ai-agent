"""Layer 1 — bill-versus-bill driver decomposition. The answer to "why is it high?".

## Why this module exists

`build_why_high` answers a different question from the one customers ask. It compares
the household against a *peer benchmark* and reports the split between its steady load
and its one-off spikes. That is a good finding and it is the one the pitch turns on —
but "why is my bill so high?" is almost never a question about neighbours. It is a
question about **last month**: the customer has two numbers, they differ, and they want
to know what moved.

Answering that requires attributing a *change* between two bills, which the old path
never computed. So the answer came back as a true, verified, generic statement about
standing load, no matter what actually drove the increase. A 43-day move-in bill, a
network price rise and a cold snap all produced the same sentence.

## The decomposition

Sequential attribution, valued in dollars, in a **fixed order that is part of the
method**. Order matters because each step consumes part of the gap before the next one
sees it, so a different order gives different numbers. This order is chosen so that the
things we know *exactly* are removed before the things we *model*:

    1  period length     days changed                    exact
    2  fixed charges     daily charge x days             exact
    3  unit price        rates moved, volume held        exact
    4  weather           degree-days x heat sensitivity  modelled
    5  base load         the always-on floor moved       measured
    6  discretionary     what is left of the volume      residual
    7  solar             export credit moved             exact
    8  one-offs          fees, discounts, credits        exact
    9  unexplained       everything still unaccounted    honest

Steps 1-3 are the ones that most often produce a *confidently wrong* answer when
skipped. A 43-day bill looks like a 39% consumption increase and is not one; the serving
schema says the same thing in the comment above `delta_from_period_length`, and this
module is the application-side half of that rule.

## The property that makes it defensible

**The drivers sum to the total change, exactly.** Not approximately, not up to a
rounding term quietly dropped. `unexplained` is a named driver that absorbs the
remainder and gets *said out loud* — "I can account for $34 of the $61" is a better
answer than a confident story about the other $27, and it is the answer this returns.
`decompose()` asserts closure before returning; a decomposition that does not close is
a bug, not a result to hedge.

The price/volume split uses a Laspeyres price effect against a Paasche volume effect:

    price  = prior_volume x (rate_now - rate_before)
    volume = (volume_now - prior_volume) x rate_now

Those two are the standard complementary pair, and they sum to the exact revenue change
with **no interaction residue left over**. Pairing two Laspeyres terms instead would
leave a cross-term that has to go somewhere, and the somewhere is always
`unexplained` — which then reads as "we could not explain $12" when in fact we could,
and the $12 was an artefact of the choice of index. Getting this wrong makes the honest
column look worse than the method deserves.

## What it does NOT do

No appliance attribution, at any point, for the same reason as everywhere else in this
service: a whole-house meter cannot see appliances. A driver named `discretionary` means
"volume that is not weather and not base load" — it does not mean "the dryer".
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum

from app.schemas import Fact

# ──────────────────────────── inputs ────────────────────────────


class Confidence(StrEnum):
    """How much weight a driver's figure carries.

    Reported per driver rather than per answer, because they genuinely differ: the day
    count is arithmetic off the bill and the weather share is a regression. Hedging the
    whole answer to the confidence of its weakest part is what produces the mush the
    customer reads as evasive — "it may be partly due to a number of factors". Hedge the
    modelled driver, state the exact one plainly.
    """

    EXACT = "exact"
    """Read off the bill or the tariff catalogue. Arithmetic only."""

    MEASURED = "measured"
    """Computed from meter data. Degraded by estimated reads and interval gaps."""

    MODELLED = "modelled"
    """Output of a fitted relationship. Carries the fit quality with it."""

    RESIDUAL = "residual"
    """What is left after the others. Real, but it is a remainder, not an observation."""


@dataclass(frozen=True)
class BillPeriod:
    """One side of the comparison — everything needed to value a period.

    Deliberately a flat value object rather than an ORM row: the same shape is built
    from `kea.mart_bill_explanation`, from `billing.bill` + `billing.bill_line`, and
    from the fixture households. One decomposition, three sources, no second
    implementation to drift.

    `unit_rate_nzd` is the **effective variable rate** — total variable charges divided
    by billed kWh — not a headline tariff number. On a time-of-use plan there is no
    single unit rate, and the effective rate is the only figure that both reconstructs
    the bill and survives a customer checking it against the paper copy.
    """

    label: str
    days: int
    total_nzd: float
    total_kwh: float

    unit_rate_nzd: float
    """Effective variable $/kWh: variable charges / billed kWh."""

    daily_fixed_nzd: float = 0.0
    """Summed per-day components — network daily, metering daily, levies."""

    base_load_kwh_per_day: float | None = None
    """The always-on floor, from the overnight percentile. None when not measured."""

    heating_degree_days: float | None = None
    """Total HDD across the period, base 18 degC per the NZ convention."""

    export_credit_nzd: float = 0.0
    """Solar buy-back, stored positive; it *reduces* the bill."""

    one_off_nzd: float = 0.0
    """Late fees, term credits, prompt-payment discounts — signed as they hit the bill."""

    estimated_read_pct: float = 0.0
    """Share of the period's reads that were estimated rather than actual."""

    def __post_init__(self) -> None:
        if self.days <= 0:
            raise ValueError(f"{self.label}: a billing period must cover at least one day")

    @classmethod
    def from_bill(
        cls,
        label: str,
        *,
        days: int,
        total_nzd: float,
        total_kwh: float,
        daily_fixed_nzd: float = 0.0,
        export_credit_nzd: float = 0.0,
        one_off_nzd: float = 0.0,
        **rest: object,
    ) -> BillPeriod:
        """Build a period from a real bill, deriving the effective unit rate.

        **Prefer this over the constructor for anything that came off a bill.** The
        decomposition's residual is supposed to mean "no named driver accounts for
        this". It only means that if the period's parts reconstruct its total — and a
        headline tariff rate never quite does, because of GST, line losses, levies and
        rounding at the line level. Passing a nominal 30c/kWh alongside a real total
        puts the difference into `unexplained`, where it reads to the customer as "we
        could not explain $27 of your increase" when the truth is that the caller and
        the bill disagreed about arithmetic.

        Deriving the rate from the total closes that gap by construction: whatever the
        bill actually charged per unit, after everything, is what gets used.

        A period with no consumption has no meaningful unit rate; the rate falls to zero
        and the whole change lands in the fixed and one-off drivers, which is the
        correct reading of a bill for a house that used nothing.
        """
        variable = total_nzd - (daily_fixed_nzd * days) - one_off_nzd + export_credit_nzd
        return cls(
            label=label,
            days=days,
            total_nzd=total_nzd,
            total_kwh=total_kwh,
            unit_rate_nzd=(variable / total_kwh) if total_kwh else 0.0,
            daily_fixed_nzd=daily_fixed_nzd,
            export_credit_nzd=export_credit_nzd,
            one_off_nzd=one_off_nzd,
            **rest,  # type: ignore[arg-type]
        )

    @property
    def reconstructs(self) -> bool:
        """Do the parts add back up to the total, within a cent per day?

        `decompose()` reports this rather than enforcing it. A period that does not
        reconstruct still decomposes correctly — the shortfall simply lands in the
        residual, which is exactly where an unattributable amount belongs. But the two
        situations mean different things to whoever reads the answer, so they are
        distinguishable rather than conflated.
        """
        rebuilt = (
            self.total_kwh * self.unit_rate_nzd
            + self.daily_fixed_nzd * self.days
            + self.one_off_nzd
            - self.export_credit_nzd
        )
        return abs(rebuilt - self.total_nzd) <= max(0.05, 0.01 * self.days)

    @property
    def daily_rate_nzd(self) -> float:
        """Cost per day. The unit that makes two unequal periods comparable at all."""
        return self.total_nzd / self.days

    def scaled_to(self, days: int) -> BillPeriod:
        """This period restated as though it had covered `days` days.

        Volume-like quantities scale; rates do not. That distinction is the entire
        content of step 1, and putting it here rather than inline in `decompose()` is
        what stops a later edit from scaling the unit rate by accident — which would
        silently move a price change into the period-length driver and produce a
        perfectly closed, entirely wrong decomposition.
        """
        f = days / self.days
        return BillPeriod(
            label=self.label,
            days=days,
            total_nzd=self.total_nzd * f,
            total_kwh=self.total_kwh * f,
            unit_rate_nzd=self.unit_rate_nzd,
            daily_fixed_nzd=self.daily_fixed_nzd,
            base_load_kwh_per_day=self.base_load_kwh_per_day,
            heating_degree_days=(
                None if self.heating_degree_days is None else self.heating_degree_days * f
            ),
            export_credit_nzd=self.export_credit_nzd * f,
            one_off_nzd=self.one_off_nzd * f,
            estimated_read_pct=self.estimated_read_pct,
        )


# ──────────────────────────── outputs ────────────────────────────


@dataclass(frozen=True)
class Driver:
    """One named cause, with the dollars it accounts for and the evidence behind it."""

    key: str
    label: str
    """Customer-facing, already in plain words. The narrator copies rather than invents."""

    amount_nzd: float
    """Signed: positive pushed the bill up, negative pulled it down."""

    confidence: Confidence
    evidence: dict[str, float] = field(default_factory=dict)
    """The figures this driver was computed from, so the answer can show its working."""

    note: str | None = None
    """A caveat that belongs to this driver alone, not to the whole answer."""

    @property
    def magnitude(self) -> float:
        return abs(self.amount_nzd)

    @property
    def direction(self) -> str:
        return "increase" if self.amount_nzd > 0 else "decrease"


@dataclass(frozen=True)
class Decomposition:
    """The full attribution: what changed, by how much, and how sure we are of each part.

    `drivers` is sorted by magnitude, largest first, so `drivers[0]` is the headline and
    the narrator does not get to choose which cause to lead with. That ordering is the
    fix for the specific complaint that the old answer buried the actual reason: the
    ranking is computed here, in Python, from the dollars.
    """

    current: BillPeriod
    prior: BillPeriod
    total_delta_nzd: float
    drivers: list[Driver]

    #: Below this share of the change, no single cause is worth calling the reason.
    DOMINANCE_THRESHOLD = 0.35

    #: A change smaller than this is not worth explaining as a change at all.
    MATERIAL_NZD = 1.00

    @property
    def delta_pct(self) -> float:
        if not self.prior.total_nzd:
            return 0.0
        return self.total_delta_nzd / self.prior.total_nzd * 100

    @property
    def headline(self) -> Driver | None:
        """The single biggest cause, or None when nothing dominates.

        None is a real answer and must survive to the customer. Four causes at 26/25/25/24
        is a bill that went up for four reasons, and picking the 26 as "the reason" is a
        false lead dressed as a finding.
        """
        material = [d for d in self.drivers if d.magnitude >= self.MATERIAL_NZD]
        if not material:
            return None
        top = material[0]
        gross = sum(d.magnitude for d in material)
        if not gross or top.magnitude / gross < self.DOMINANCE_THRESHOLD:
            return None
        return top

    @property
    def explained_nzd(self) -> float:
        """Dollars attributed to a named cause — everything but the residual."""
        return sum(d.amount_nzd for d in self.drivers if d.key != "unexplained")

    @property
    def unexplained_nzd(self) -> float:
        return sum(d.amount_nzd for d in self.drivers if d.key == "unexplained")

    @property
    def inputs_reconstruct(self) -> bool:
        """Did both periods' parts add back to their totals?

        When false, some of the residual is the *inputs* disagreeing rather than a cause
        we failed to find, and `build_why_high`'s caller should treat a large
        `unexplained` as a data problem to fix rather than a finding to narrate. Kept
        distinct because the two have opposite remedies: one is answered by saying so to
        the customer, the other by fixing the loader.
        """
        return self.current.reconstructs and self.prior.reconstructs

    @property
    def is_fully_explained(self) -> bool:
        """Is the residual small enough that we can lead with a cause?

        Measured against the size of the *change*, not the size of the bill. A $4
        residual on a $6 change is an unexplained bill; the same $4 on a $200 change is
        rounding.
        """
        if abs(self.total_delta_nzd) < self.MATERIAL_NZD:
            return True
        return abs(self.unexplained_nzd) / abs(self.total_delta_nzd) <= 0.25

    def material_drivers(self) -> list[Driver]:
        """Drivers worth putting in a sentence, largest first."""
        return [d for d in self.drivers if d.magnitude >= self.MATERIAL_NZD]

    def to_facts(self) -> list[Fact]:
        """The decomposition as the only numbers the narrator will be given.

        Ordered headline-first, which is the ordering the prompt relies on: layer 2 is
        told to lead with the first figure, so "lead with the actual reason" becomes a
        property of the data rather than an instruction a 4B model has to follow.
        """
        facts = [
            Fact.money("bill_total", self.current.total_nzd, f"Your {self.current.label} bill"),
            Fact.money("prior_bill_total", self.prior.total_nzd, f"Your {self.prior.label} bill"),
            Fact.money("bill_change", self.total_delta_nzd, "The change between them"),
        ]
        if self.prior.total_nzd:
            facts.append(
                Fact.percent("bill_change_pct", self.delta_pct, "How much it changed in percent")
            )
        for driver in self.material_drivers():
            facts.append(Fact.money(f"driver_{driver.key}", driver.amount_nzd, driver.label))
        return facts

    def caveats(self) -> list[str]:
        """Answer-level constraints. Per-driver notes ride on the driver itself."""
        out: list[str] = [
            "Do not name or guess which appliance caused any change — half-hourly meter "
            "data cannot identify appliances, and claiming otherwise is a fabrication.",
        ]
        if not self.is_fully_explained:
            out.append(
                "You could NOT account for all of the change. Say plainly how much you can "
                "explain and that the rest is unaccounted for. Do not invent a cause for it."
            )
        if self.headline is None and self.material_drivers():
            out.append(
                "No single cause dominates — several things moved together. Do NOT present "
                "any one of them as the reason. List them."
            )
        worst_estimated = max(
            self.current.estimated_read_pct, self.prior.estimated_read_pct
        )
        if worst_estimated >= 10.0:
            out.append(
                "Some meter reads in this comparison were estimated rather than actual. Say "
                "that the figures may change when a real read comes in."
            )
        return out


# ──────────────────────────── the algorithm ────────────────────────────


def _driver(
    key: str,
    label: str,
    amount: float,
    confidence: Confidence,
    evidence: dict[str, float] | None = None,
    note: str | None = None,
) -> Driver:
    return Driver(
        key=key,
        label=label,
        amount_nzd=round(amount, 2),
        confidence=confidence,
        evidence={k: round(v, 4) for k, v in (evidence or {}).items()},
        note=note,
    )


def _clamped_share(requested: float, remaining: float) -> float:
    """Take `requested` out of `remaining` without overshooting or flipping its sign.

    A modelled driver can legitimately come out larger than the gap it is being taken
    from — a warm month against a cold one produces a weather term bigger than the whole
    volume change, because something else moved the other way. Letting it through
    unclamped makes the next driver absorb an equal and opposite amount, and the answer
    becomes "heating cost you $80 more and your everyday use fell $55", which is
    arithmetically closed and reads as nonsense.

    Clamping keeps every driver inside the change it is explaining. The part that does
    not fit is not discarded — it lands in the residual, where it is stated.
    """
    if remaining == 0.0 or requested == 0.0:
        return 0.0
    if (requested > 0) != (remaining > 0):
        return 0.0
    return math.copysign(min(abs(requested), abs(remaining)), remaining)


def decompose(
    current: BillPeriod,
    prior: BillPeriod,
    *,
    heating_sensitivity_kwh_per_hdd: float | None = None,
    weather_fit_r2: float | None = None,
) -> Decomposition:
    """Attribute the change between two bills to named causes, in dollars.

    `heating_sensitivity_kwh_per_hdd` is how many extra kWh this household burns per
    heating degree day — its own fitted slope, not a population constant. Without it the
    weather driver is not computed at all, and its dollars stay in `discretionary` rather
    than being guessed at. That is deliberate: a weather attribution built on somebody
    else's heating sensitivity is a fabrication with a regression stapled to it.
    """
    delta = current.total_nzd - prior.total_nzd
    drivers: list[Driver] = []

    # ── 1. Period length ───────────────────────────────────────────────
    # First, always, and before anything else is attributed. A 43-day move-in bill
    # against a 31-day one looks like a 39% consumption increase and is not one.
    prior_norm = prior.scaled_to(current.days)
    period_effect = prior_norm.total_nzd - prior.total_nzd
    if current.days != prior.days:
        drivers.append(
            _driver(
                "period_length",
                f"Because this bill covers {current.days} days instead of {prior.days}",
                period_effect,
                Confidence.EXACT,
                {
                    "days_now": current.days,
                    "days_before": prior.days,
                    "cost_per_day_before": prior.daily_rate_nzd,
                },
            )
        )

    # Everything from here compares like-for-like on duration.
    remaining = current.total_nzd - prior_norm.total_nzd

    # ── 2. Fixed charges ───────────────────────────────────────────────
    # Known exactly the moment the period starts, and a different story to the customer
    # from a unit-rate rise: nothing they do with a switch changes this one.
    fixed_now = current.daily_fixed_nzd * current.days
    fixed_before = prior.daily_fixed_nzd * current.days
    fixed_effect = fixed_now - fixed_before
    if abs(fixed_effect) >= 0.005:
        drivers.append(
            _driver(
                "fixed_charges",
                "Because your daily fixed charges changed",
                fixed_effect,
                Confidence.EXACT,
                {
                    "daily_charge_now": current.daily_fixed_nzd,
                    "daily_charge_before": prior.daily_fixed_nzd,
                    "days": current.days,
                },
                note="Fixed charges apply whatever you use — using less does not reduce them.",
            )
        )
        remaining -= fixed_effect

    # ── 3. Unit price ──────────────────────────────────────────────────
    # Laspeyres: prior volume at the change in rate. Paired with the Paasche volume term
    # below, the two sum to the exact variable-revenue change with no cross-term.
    rate_delta = current.unit_rate_nzd - prior.unit_rate_nzd
    price_effect = prior_norm.total_kwh * rate_delta
    if abs(price_effect) >= 0.005:
        drivers.append(
            _driver(
                "unit_price",
                "Because the price per unit changed",
                price_effect,
                Confidence.EXACT,
                {
                    "rate_now": current.unit_rate_nzd,
                    "rate_before": prior.unit_rate_nzd,
                    "units_at_old_rate": prior_norm.total_kwh,
                },
                note="A price change is not something the household did.",
            )
        )
        remaining -= price_effect

    # ── 4-6. The volume change, split by cause ─────────────────────────
    kwh_delta = current.total_kwh - prior_norm.total_kwh
    volume_budget = kwh_delta * current.unit_rate_nzd
    volume_remaining = volume_budget

    # 4. Weather — the household's own heating sensitivity against the degree-day change.
    #    Computed before base load because a cold month raises the overnight floor too,
    #    and attributing that to "your always-on load went up" would tell a family they
    #    changed their habits when the weather changed.
    if (
        heating_sensitivity_kwh_per_hdd is not None
        and current.heating_degree_days is not None
        and prior_norm.heating_degree_days is not None
    ):
        hdd_delta = current.heating_degree_days - prior_norm.heating_degree_days
        weather_kwh = heating_sensitivity_kwh_per_hdd * hdd_delta
        weather_effect = _clamped_share(
            weather_kwh * current.unit_rate_nzd, volume_remaining
        )
        if abs(weather_effect) >= 0.005:
            colder = hdd_delta > 0
            drivers.append(
                _driver(
                    "weather",
                    f"Because it was {'colder' if colder else 'warmer'} than the period before",
                    weather_effect,
                    Confidence.MODELLED,
                    {
                        "heating_degree_days_now": current.heating_degree_days,
                        "heating_degree_days_before": prior_norm.heating_degree_days,
                        "kwh_per_degree_day": heating_sensitivity_kwh_per_hdd,
                        **({"fit_r2": weather_fit_r2} if weather_fit_r2 is not None else {}),
                    },
                    note=(
                        "This is an estimate of the weather's share, from how much extra "
                        "this house uses per cold degree."
                    ),
                )
            )
            volume_remaining -= weather_effect

    # 5. Base load — the always-on floor. The most actionable driver there is, because
    #    it is the one number a household can move without noticing the difference.
    if (
        current.base_load_kwh_per_day is not None
        and prior.base_load_kwh_per_day is not None
    ):
        base_kwh = (
            current.base_load_kwh_per_day - prior.base_load_kwh_per_day
        ) * current.days
        base_effect = _clamped_share(base_kwh * current.unit_rate_nzd, volume_remaining)
        if abs(base_effect) >= 0.005:
            drivers.append(
                _driver(
                    "base_load",
                    "Because the power drawn around the clock changed",
                    base_effect,
                    Confidence.MEASURED,
                    {
                        "base_load_now": current.base_load_kwh_per_day,
                        "base_load_before": prior.base_load_kwh_per_day,
                        "days": current.days,
                    },
                    note=(
                        "This is what the house draws even when nobody is using anything — "
                        "it runs 24 hours a day."
                    ),
                )
            )
            volume_remaining -= base_effect

    # 6. Discretionary — the rest of the volume move. Named for what it is: usage that is
    #    neither weather nor always-on. NOT an appliance, and never described as one.
    if abs(volume_remaining) >= 0.005:
        drivers.append(
            _driver(
                "discretionary",
                "Because of day-to-day usage that is not heating or always-on load",
                volume_remaining,
                Confidence.RESIDUAL,
                {"units_now": current.total_kwh, "units_before": prior_norm.total_kwh},
                note=(
                    "A meter reads the whole house. This is the part of the change left "
                    "after weather and always-on load — it does not identify what used it."
                ),
            )
        )
    remaining -= volume_budget

    # ── 7. Solar ───────────────────────────────────────────────────────
    # A larger credit lowers the bill, so the sign flips on the way in.
    solar_effect = -(current.export_credit_nzd - prior_norm.export_credit_nzd)
    if abs(solar_effect) >= 0.005:
        drivers.append(
            _driver(
                "solar_export",
                "Because your solar credit changed",
                solar_effect,
                Confidence.EXACT,
                {
                    "credit_now": current.export_credit_nzd,
                    "credit_before": prior_norm.export_credit_nzd,
                },
            )
        )
        remaining -= solar_effect

    # ── 8. One-offs ────────────────────────────────────────────────────
    one_off_effect = current.one_off_nzd - prior_norm.one_off_nzd
    if abs(one_off_effect) >= 0.005:
        drivers.append(
            _driver(
                "one_offs",
                "Because of fees, credits or discounts on this bill",
                one_off_effect,
                Confidence.EXACT,
                {"now": current.one_off_nzd, "before": prior_norm.one_off_nzd},
            )
        )
        remaining -= one_off_effect

    # ── 9. Unexplained ─────────────────────────────────────────────────
    # Whatever is left. Always appended, even at zero, so that closure is visible in the
    # output rather than being a property somebody has to trust.
    drivers.append(
        _driver(
            "unexplained",
            "Not accounted for by any of the above",
            remaining,
            Confidence.RESIDUAL,
        )
    )

    drivers.sort(key=lambda d: d.magnitude, reverse=True)

    result = Decomposition(
        current=current, prior=prior, total_delta_nzd=round(delta, 2), drivers=drivers
    )

    # Closure is the guarantee this module makes. Assert it rather than documenting it:
    # a decomposition whose parts do not sum to the whole is a bug, and the one place it
    # must not surface is in front of a customer holding the paper bill.
    attributed = sum(d.amount_nzd for d in drivers)
    assert abs(attributed - result.total_delta_nzd) < 0.05, (
        f"decomposition does not close: drivers sum to {attributed:.2f} "
        f"but the bill moved {result.total_delta_nzd:.2f}"
    )
    return result
