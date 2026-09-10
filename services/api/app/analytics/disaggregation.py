"""Where the power actually goes, without naming a single appliance.

The most-asked question this product gets is "what's using all my power", and the honest
answer has always been "one meter reads one number for the whole house, so I cannot tell
you". That is true, it is a fact about the data rather than a policy, and it is also the
least useful sentence in the product.

This module is the answer that is both honest and useful. It does not identify appliances.
It splits the bill into **behavioural categories**, each of which is separately measurable
from data this system already holds, and reports each one with what it is and how well it
is known:

    always_on       the overnight floor — what the house draws with nobody doing anything
    water_heating   the separately metered controlled circuit, where one exists
    space_heating   the part of daily use that moves with outdoor temperature
    everything_else the remainder: cooking, laundry, lighting, entertainment, hot showers

## Why this is not appliance identification with the labels filed off

The distinction is real and it is worth being exact about, because the whole product rests
on it.

**`always_on` is a measurement.** It is the low percentile of daily totals — the floor the
house never goes below. Nothing is inferred about what makes it up.

**`water_heating` is a separate meter.** The controlled circuit is physically metered on its
own because the network switches it. Reporting what it used is reading a second meter, not
attributing a first one. What we still may not say is *what is on that circuit* — in New
Zealand it is usually the hot water cylinder, usually being the operative word, which is
why the category is reported with that caveat attached every time.

**`space_heating` is a fitted slope.** It is the household's own regression of daily kWh on
heating degree days: how many extra units this house draws per degree-day of cold. That is
a measurement of a *response to temperature*, not a claim about a heat pump. A house heated
by a wood burner has a slope near zero and this correctly attributes nothing to it. A house
with a gas hob and an electric heater has a real slope and it is real electricity.

**`everything_else` is deliberately not decomposed further.** This is where an
industry-standard "lighting is 12% of your bill" number would go, and it is exactly the
number this module refuses to produce: that figure comes from a national appliance survey,
not from this house, and quoting it against somebody's own bill presents a population
average as a personal measurement. If a customer wants that, they can be told it is a
national average and told so plainly — but it does not go in the breakdown, because
everything else in the breakdown is theirs.

## The confidence field is the product

Each slice carries `Confidence`, and the wording changes with it. A `MEASURED` slice may be
stated. A `FITTED` slice is real arithmetic on real data with a goodness-of-fit attached and
must be worded as an estimate with its r-squared available. A `RESIDUAL` slice is what is
left over after the others, which means it also carries every error in them — so it is
always described as "everything else" and never as a positive finding about anything.

Where the fit is not usable — a mild month, a house with no electric heating, fewer than
eight days of data — space heating is not reported at all and its energy stays in the
remainder. That is the same rule `forecast.py` follows, and for the same reason: an
attribution built on an unusable regression is a fabrication with statistics stapled to it.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from enum import StrEnum

from app.analytics.account import DayUsage
from app.analytics.forecast import fit_weather_response


class Confidence(StrEnum):
    """What may be said about a slice. Mirrors `homelink.schemas.Confidence` in spirit —
    the same three-level idea, kept separate because these arise from different evidence
    and collapsing them would let a device measurement and a regression share wording."""

    MEASURED = "measured"
    """Read directly off the meter — a separately metered circuit, or the observed floor of
    the daily series. State it plainly."""

    FITTED = "fitted"
    """Estimated from this household's own regression, with a goodness-of-fit. Real
    arithmetic on real data, and still an estimate. Say 'about' and be ready to say how
    well it fits."""

    RESIDUAL = "residual"
    """What is left after the others, so it inherits every error in them. Describe it as
    everything else, never as a finding."""


#: Percentile of daily totals taken as the always-on floor.
#:
#: The 10th rather than the minimum. One day away, one meter fault or one public holiday
#: would otherwise define a household's standing load for the whole period, and a floor set
#: by the single quietest day understates the load on all the others.
#:
#: Matches `engine.standing_load_kwh_per_day`, which uses the same percentile for the same
#: reason. Deliberately not imported: these two answer different questions and should be
#: free to diverge, and the docstring here says which way if they ever do.
BASE_LOAD_PERCENTILE = 0.10

#: Minimum days before a split is offered at all. Below a week the percentile floor is
#: taken over so few points that one quiet evening moves it several kWh, and the fit needs
#: more than that anyway.
MIN_DAYS = 7

#: A slice below this share of the bill is not worth a line of an answer. It is true and it
#: crowds out the finding that matters — nobody changes anything over 2% of a power bill.
MIN_REPORTABLE_SHARE_PCT = 3.0

#: R-squared at or above which the heating slope is described without hedging every clause.
#: Below it the slice is still reported — the fit already passed `forecast.py`'s own floor
#: to be usable at all — but the wording softens.
STRONG_FIT_R2 = 0.5


@dataclass(frozen=True)
class Slice:
    key: str
    label: str
    kwh: float
    cost_nzd: float
    share_pct: float
    confidence: Confidence
    basis: str
    """How this number was arrived at, in one clause the customer could check."""

    caveat: str = ""
    detail: dict[str, float] = field(default_factory=dict)


@dataclass
class Breakdown:
    available: bool
    reason: str | None = None

    period: str = ""
    days: int = 0
    total_kwh: float = 0.0
    total_cost_nzd: float = 0.0
    unit_price_nzd: float = 0.0

    slices: list[Slice] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)

    heating_fit_r2: float | None = None
    heating_kwh_per_degree_day: float | None = None
    heating_not_reported_because: str | None = None
    always_on_not_reported_because: str | None = None
    """Set when the account has no half-hourly data. Standing load is measured overnight,
    and the floor of a daily series is a different quantity — see `split`."""

    @property
    def largest(self) -> Slice | None:
        """The biggest slice that is not the remainder.

        The remainder is excluded on purpose. "Everything else is the biggest part of your
        bill" is arithmetically true for most households and is not an answer to anything,
        and a model handed it as the headline will lead with it.
        """
        real = [s for s in self.slices if s.confidence is not Confidence.RESIDUAL]
        return max(real, key=lambda s: s.kwh) if real else None


def _percentile(values: list[float], q: float) -> float:
    """Linear-interpolated percentile. Written out rather than imported for the same
    reason `fit_weather_response` is — this service deploys to Lambda and numpy is a 20 MB
    layer for four lines of arithmetic."""
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = q * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def split(
    days: list[DayUsage],
    *,
    period: str,
    unit_price_nzd: float,
    has_controlled_load: bool = False,
    heating_sensitivity_kwh_per_hdd: float | None = None,
) -> Breakdown:
    """Split a period into behavioural categories. Pure — no I/O, no model, no database.

    The order matters and is not arbitrary. Each category is subtracted from the total
    before the next is computed, so nothing is counted twice and the remainder is genuinely
    a remainder:

        1. the controlled circuit, because it is a separate meter and needs no inference
        2. the always-on floor, from what is left
        3. temperature response, from what is left of that
        4. everything else

    Doing it in any other order double-counts. The controlled circuit runs overnight on most
    New Zealand connections, so a base load computed over the *total* would swallow the
    cylinder and then the cylinder would be added again from its own meter — inflating the
    bill's attributed portion above 100% and making the remainder negative, which is how
    this went wrong the first time it was written.
    """
    if len(days) < MIN_DAYS:
        return Breakdown(
            available=False,
            reason=(
                f"only {len(days)} days of usage are available and a breakdown needs at "
                f"least {MIN_DAYS}. Below a week the overnight floor is taken over so few "
                "days that one quiet evening moves it by several units."
            ),
        )

    totals = [d.import_kwh for d in days if d.import_kwh is not None]
    if not totals or sum(totals) <= 0:
        return Breakdown(
            available=False, reason="this account has no metered usage for the period"
        )

    total_kwh = sum(totals)
    n = len(days)
    breakdown = Breakdown(
        available=True,
        period=period,
        days=n,
        total_kwh=round(total_kwh, 2),
        total_cost_nzd=round(total_kwh * unit_price_nzd, 2),
        unit_price_nzd=round(unit_price_nzd, 4),
    )

    def add(
        key: str,
        label: str,
        kwh: float,
        confidence: Confidence,
        basis: str,
        caveat: str = "",
        detail: dict[str, float] | None = None,
    ) -> None:
        share = kwh / total_kwh * 100 if total_kwh else 0.0
        breakdown.slices.append(
            Slice(
                key=key,
                label=label,
                kwh=round(kwh, 2),
                cost_nzd=round(kwh * unit_price_nzd, 2),
                share_pct=round(share, 1),
                confidence=confidence,
                basis=basis,
                caveat=caveat,
                detail=detail or {},
            )
        )

    # --- 1. the separately metered circuit -------------------------------------------
    controlled_kwh = sum(d.controlled_kwh or 0.0 for d in days)
    remaining_daily = [d.import_kwh - (d.controlled_kwh or 0.0) for d in days]

    if has_controlled_load and controlled_kwh > 0:
        add(
            "water_heating",
            "the separately metered circuit",
            controlled_kwh,
            Confidence.MEASURED,
            "read straight off the controlled circuit's own meter, not inferred",
            caveat=(
                "This circuit is metered separately because the network switches it. In "
                "New Zealand it usually carries the hot water cylinder — usually, not "
                "certainly. You may say what the circuit used; you may not assert what is "
                "on it. Ask rather than tell."
            ),
            detail={"kwh_per_day": round(controlled_kwh / n, 2)},
        )

    # --- 2. the always-on floor -------------------------------------------------------
    #
    # Reported ONLY where the meter actually measured it overnight. `base_load_kwh` comes
    # off the half-hourly intervals — the draw between about 2am and 5am, when nobody is
    # doing anything — and that is a measurement of standing load.
    #
    # The daily-total floor is NOT the same quantity and must not stand in for it. The
    # quietest day of a month still contains a day of ordinary living: cooking, a shower,
    # the lights on in the evening. Using it as "always-on" put H-COLD's standing load at
    # 86% of its bill, which is not a slightly optimistic estimate — it is the wrong
    # measurement wearing the right label, and it would have been the headline of every
    # answer this tool produced.
    #
    # So on an account with no half-hourly data the standing load is simply not separated,
    # exactly as `get_hourly_profile` refuses to name an hour for the same accounts. The
    # floor is still computed, because the weather fit needs somewhere to start, and it is
    # reported as context rather than as a category.
    measured = [d.base_load_kwh for d in days if d.base_load_kwh is not None]
    from_intervals = len(measured) >= n / 2

    if from_intervals:
        floor_per_day = statistics.fmean(measured)

        # No subtraction for the controlled circuit here, deliberately.
        #
        # `mart_daily_usage.base_load_kwh` is `min(import half-hour) * 48` — the smallest
        # single import reading of the day, scaled up. It is a floor over individual
        # channel readings, not the connection's total overnight draw, so it does not
        # already contain the cylinder's nightly run and there is nothing to take out.
        #
        # A first version subtracted the controlled circuit's daily average from it and
        # drove the standing load to zero on exactly the connections that have the best
        # data for it. The cap below is what actually prevents double counting: the
        # standing load can never exceed what is left after the controlled circuit.
        always_on_kwh = min(floor_per_day * n, sum(remaining_daily))
        add(
            "always_on",
            "the always-on background load",
            always_on_kwh,
            Confidence.MEASURED,
            "the average overnight draw measured on this meter, between 2am and 5am",
            caveat=(
                "This is what the house draws with nobody doing anything — fridges, "
                "standby power, pumps, anything left on. It is the one figure most "
                "households can move without noticing, because by definition nobody is "
                "using it. It cannot be broken down further: one meter reading cannot say "
                "which of those it is."
            ),
            detail={"kwh_per_day": round(always_on_kwh / n, 2)},
        )
    else:
        # The daily floor, kept only as the baseline the weather fit sits on top of.
        floor_per_day = _percentile(remaining_daily, BASE_LOAD_PERCENTILE)
        always_on_kwh = 0.0
        breakdown.always_on_not_reported_because = (
            "this account has no half-hourly data, and standing load is measured "
            "overnight. The lowest a daily total gets still includes a whole day of "
            "ordinary use, so quoting it as always-on load would overstate it several "
            "times over"
        )

    # --- 3. the response to temperature ------------------------------------------------
    above_floor = [max(k - floor_per_day, 0.0) for k in remaining_daily]
    hdds = [d.heating_degree_days for d in days]
    heating_kwh = 0.0

    if all(h is not None for h in hdds):
        fit = fit_weather_response(above_floor, [h or 0.0 for h in hdds])
        breakdown.heating_fit_r2 = fit.r_squared if fit.usable else None
        if fit.usable:
            breakdown.heating_kwh_per_degree_day = fit.heating_kwh_per_hdd
            # The slope times this period's own degree days — the extra electricity this
            # house actually drew because of the cold, not a share of a national figure.
            heating_kwh = min(
                fit.heating_kwh_per_hdd * sum(h or 0.0 for h in hdds),
                sum(above_floor),
            )
            strong = fit.r_squared >= STRONG_FIT_R2
            add(
                "space_heating",
                "heating, as far as the weather explains it",
                heating_kwh,
                Confidence.FITTED,
                (
                    f"this household's own usage regressed against outdoor temperature: "
                    f"{fit.heating_kwh_per_hdd:.2f} extra units per degree-day of cold, "
                    f"fitting {fit.r_squared:.0%} of the daily variation"
                ),
                caveat=(
                    "This is the part of usage that moves with the weather, not a "
                    "measurement of a heater. It is an estimate — say 'about'. "
                    + (
                        "The fit is strong enough to lead with."
                        if strong
                        else "The fit is weak, so give the figure as a rough one and say "
                        "the relationship is loose for this household."
                    )
                ),
                detail={
                    "kwh_per_degree_day": fit.heating_kwh_per_hdd,
                    "r_squared": fit.r_squared,
                    "degree_days_in_period": round(sum(h or 0.0 for h in hdds), 1),
                },
            )
        else:
            breakdown.heating_not_reported_because = fit.unusable_because
    else:
        breakdown.heating_not_reported_because = (
            "this account has no temperature data for the period"
        )

    # --- 4. the remainder ---------------------------------------------------------------
    everything_else = max(total_kwh - controlled_kwh - always_on_kwh - heating_kwh, 0.0)
    includes_standing = not from_intervals
    add(
        "everything_else",
        "everything else" + (", including the always-on load" if includes_standing else ""),
        everything_else,
        Confidence.RESIDUAL,
        "what is left after the other categories, so it carries their error too",
        caveat=(
            "Cooking, laundry, showers, lighting, entertainment, tools — everything the "
            "household actually does. This CANNOT be broken down further from meter data, "
            "and a national average for how much of it is lighting is a fact about New "
            "Zealand rather than about this house. Do not quote one as if it were theirs."
            + (
                " For this account it ALSO contains the always-on background load, which "
                "could not be separated without half-hourly data — so do not describe it "
                "as what the household 'does', and do not imply standing load has been "
                "excluded from it."
                if includes_standing
                else ""
            )
        ),
        detail={
            "kwh_per_day": round(everything_else / n, 2),
            **(
                # Context, not a category. The quietest day is a genuine observation and a
                # useful one — it is an upper bound on standing load — and it is reported
                # here rather than as its own slice precisely so it cannot become a
                # headline percentage.
                {"lowest_daily_total_kwh": round(min(totals), 2)}
                if includes_standing
                else {}
            ),
        },
    )

    # Nothing was separated, so there is no breakdown — only the bill with a different
    # word on it. Returned as unavailable rather than as one 100% slice: a single category
    # called "everything else" reads like an answer, and a model handed it will present it
    # as one. `available: false` with the reasons attached makes the model say what it
    # could not do and why, which is the honest version and the more useful one.
    if all(s.confidence is Confidence.RESIDUAL for s in breakdown.slices):
        why = " and ".join(
            r
            for r in (
                breakdown.always_on_not_reported_because,
                breakdown.heating_not_reported_because,
            )
            if r
        )
        return Breakdown(
            available=False,
            reason=(
                "this account's data cannot be split into categories: "
                + (why or "none of the categories could be measured separately")
                + ". Say which parts you cannot separate and why, then answer what you "
                "can from the daily usage itself — which days were high, how usage moved "
                "through the month — rather than estimating a split."
            ),
            heating_not_reported_because=breakdown.heating_not_reported_because,
            always_on_not_reported_because=breakdown.always_on_not_reported_because,
        )

    breakdown.caveats = _caveats(breakdown, has_controlled_load=has_controlled_load)
    return breakdown


def _caveats(breakdown: Breakdown, *, has_controlled_load: bool) -> list[str]:
    out = [
        "This is a split by BEHAVIOUR, not by appliance. Each category is separately "
        "measurable; none of them names a device. Do not turn 'heating' into 'your heat "
        "pump' — one whole-house meter cannot identify an appliance, and that has not "
        "changed."
    ]

    if breakdown.always_on_not_reported_because:
        out.append(
            f"The always-on load is NOT broken out for this household: "
            f"{breakdown.always_on_not_reported_because}. It sits inside 'everything "
            "else'. Do not estimate it from the quietest day — that day still contains a "
            "day of ordinary use."
        )

    if breakdown.heating_not_reported_because:
        out.append(
            f"Heating is NOT broken out for this household: "
            f"{breakdown.heating_not_reported_because}. Its energy is inside 'everything "
            "else'. Do not present the remainder as if heating had been excluded from it, "
            "and do not estimate a heating figure some other way."
        )
    elif breakdown.heating_fit_r2 is not None and breakdown.heating_fit_r2 < STRONG_FIT_R2:
        out.append(
            f"The weather fit explains {breakdown.heating_fit_r2:.0%} of daily variation, "
            "which is real but loose. Give the heating figure as approximate."
        )

    if not has_controlled_load:
        out.append(
            "This connection has no separately switched circuit, so water heating cannot "
            "be split out — it is inside 'everything else'. Say so if they ask about hot "
            "water rather than estimating it."
        )

    small = [
        s.label
        for s in breakdown.slices
        if s.share_pct < MIN_REPORTABLE_SHARE_PCT
        and s.confidence is not Confidence.RESIDUAL
    ]
    if small:
        out.append(
            f"These came out under {MIN_REPORTABLE_SHARE_PCT:g}% of the bill and are not "
            f"worth a sentence unless asked about directly: {', '.join(small)}."
        )

    return out


def explain(breakdown: Breakdown) -> str:
    """Guidance for reasoning over this particular split. Not a template of the answer."""
    if not breakdown.available:
        return (
            "There is no breakdown to give. Say what is missing and answer whatever else "
            "the question asked."
        )

    lines = [
        "Lead with the largest category that is not 'everything else' — the remainder is "
        "the biggest slice for most households and saying so answers nothing.",
        "Give each category as a share AND as dollars. A percentage is easy to follow and "
        "a dollar figure is what makes somebody act.",
        "Read `confidence` on every slice before you word it. `measured` may be stated "
        "plainly. `fitted` is an estimate from this household's own regression — say "
        "'about', and be ready to say how well it fits if they push. `residual` is what "
        "is left after the others and must be described as everything else, never as a "
        "finding.",
        "The always-on load is usually the most actionable number here, because by "
        "definition nobody is using it. If it is large, say what it is costing them a "
        "year — that is the figure that gets acted on.",
    ]

    largest = breakdown.largest
    if largest is not None:
        lines.append(
            f"The largest identified category here is {largest.label} at "
            f"{largest.share_pct}% (${largest.cost_nzd}). Its basis is: {largest.basis}."
        )

    lines.append(
        "If they ask which APPLIANCE, this is the answer to give them — the honest split, "
        "plus the reason a single meter cannot go further. Do not simply refuse; 'I can't "
        "name the appliance, but here is where the load actually sits' is the useful "
        "version. If they have connected smart devices, those can be named, and only those."
    )
    return " ".join(lines)
