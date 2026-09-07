"""Layer 1 bundle builders for the driver decomposition and the account lookups.

## Two kinds of bundle, and why they are checked differently

**Explanations** (`build_why_high_v2`, `build_how_to_reduce`) are computed. Every figure
is the output of arithmetic over meter and bill data, and layer 3 checks each one
numerically against `allowed_values()`.

**Account lookups** (`build_plan_details` and its neighbours) are copies. The plan name,
the ICP, the due date and the balance are stored values reproduced verbatim; nothing is
derived, so nothing can be derived wrongly. They carry `Fact.reference` facts, which
layer 3 checks by string containment instead. Separating them is what lets the service
answer "what is my ICP?" at all — the old path had no route for the question, and the
number-checker would have rejected the answer if it had.

## The ordering rule

`build_why_high_v2` emits the headline driver **first**, and the narration prompt is
told to lead with the first figure. That makes "state the actual reason up front" a
property of the data rather than an instruction a 4B model has to be trusted to follow.
The old bundle listed five facts in a fixed order regardless of which one mattered, so
the model chose the lede — and it chose the standing-load framing every time, because
that framing was the same on every household.
"""

from __future__ import annotations

from app.analytics.account import AccountContext
from app.analytics.drivers import Confidence, Decomposition, decompose
from app.schemas import Fact, FactBundle, Intent

NO_APPLIANCE = (
    "Do not name or guess which appliance caused any change — half-hourly meter "
    "data cannot identify appliances, and claiming otherwise is a fabrication."
)


def _shell(
    ctx: AccountContext,
    intent: Intent,
    facts: list[Fact],
    caveats: list[str],
    period: str | None = None,
) -> FactBundle:
    """Assemble a bundle, folding in the caveats every answer for this account needs.

    Data-quality hedging is applied here rather than by each builder, because the
    failure it guards against is per-account and every intent is exposed to it equally.
    A builder that forgot to hedge would produce a confident answer off estimated reads,
    and — being numerically correct against its own facts — would pass layer 3.

    `period` overrides the label taken from the usage series. Bill-shaped answers must
    carry the *bill's* period: the meter series runs to today while the bill it explains
    closed weeks ago, so defaulting to the series labelled an August bill "September
    2026". Layer 3 also treats a year in the period phrase as context rather than a
    claim, so a mismatched label quietly widens what the verifier will accept.
    """
    out = list(caveats)
    if ctx.quality.must_hedge:
        out.append(
            "Some readings in this period were estimated rather than actual. Say that "
            "the figures may change when a real meter read comes in."
        )
    if ctx.has_gaps:
        out.append(
            "There are gaps in the meter data for this period. Do not present the "
            "totals as complete."
        )
    stale = ctx.quality.staleness_days
    if stale is not None and stale > 2:
        out.append(
            f"This data was last refreshed {stale} days ago. Say that it may not include "
            "the most recent days."
        )
    return FactBundle(
        customer_id=ctx.account_ref,
        intent=intent,
        period=period
        or ctx.period_label
        or (ctx.current_bill.label if ctx.current_bill else ""),
        facts=facts,
        caveats=out,
    )


# ──────────────────────────── the flagship ────────────────────────────


def build_why_high_v2(ctx: AccountContext) -> FactBundle:
    """"Why is my bill so high?" — answered against their own last bill.

    Falls back to a declared inability rather than to the peer-benchmark answer when
    there is no prior bill to compare against. That is not a degradation: a first bill
    has no increase to explain, and the honest reply is to say so and offer what the
    bill *does* show. Substituting a comparison against similar homes would answer a
    question the customer did not ask and present it as though they had.
    """
    if not ctx.has_bill_comparison:
        return _shell(
            ctx,
            Intent.WHY_HIGH,
            facts=(
                [Fact.money("bill_total", ctx.current_bill.total_nzd, "Your current bill")]
                if ctx.current_bill
                else []
            ),
            caveats=[
                "There is no earlier bill to compare this one against, so you cannot say "
                "why it changed. Say that plainly — do not describe it as high, low, "
                "normal or unusual, and do not compare it with anything.",
                NO_APPLIANCE,
            ],
        )

    assert ctx.current_bill is not None and ctx.prior_bill is not None
    result = decompose(
        ctx.current_bill,
        ctx.prior_bill,
        heating_sensitivity_kwh_per_hdd=ctx.heating_sensitivity_kwh_per_hdd,
        weather_fit_r2=ctx.weather_fit_r2,
    )
    return _bundle_from_decomposition(ctx, result)


def _bundle_from_decomposition(ctx: AccountContext, result: Decomposition) -> FactBundle:
    facts: list[Fact] = []
    caveats: list[str] = [NO_APPLIANCE]

    headline = result.headline
    if headline is not None:
        # First, and named as the reason. Everything downstream — the prompt, the UI,
        # the template fallback — reads position 0 as the lede.
        facts.append(Fact.money("driver_headline", headline.amount_nzd, headline.label))
        if headline.note:
            caveats.append(headline.note)

    facts += [
        Fact.money("bill_total", result.current.total_nzd, f"Your {result.current.label} bill"),
        Fact.money(
            "prior_bill_total", result.prior.total_nzd, f"Your {result.prior.label} bill"
        ),
        Fact.money("bill_change", result.total_delta_nzd, "How much it changed"),
    ]
    if result.prior.total_nzd:
        facts.append(
            Fact.percent("bill_change_pct", result.delta_pct, "The change in percent")
        )

    for driver in result.material_drivers():
        if headline is not None and driver.key == headline.key:
            continue
        facts.append(Fact.money(f"driver_{driver.key}", driver.amount_nzd, driver.label))
        if driver.note and driver.confidence is not Confidence.EXACT:
            caveats.append(driver.note)

    caveats += result.caveats()

    if headline is not None:
        caveats.append(
            "LEAD WITH THE FIRST FIGURE — it is the largest single cause and it is the "
            "answer to the question. Do not open with a general statement about their "
            "usage."
        )
    if not result.inputs_reconstruct:
        caveats.append(
            "Some of this bill's charges could not be reconciled against its total. Do "
            "not present the breakdown as complete."
        )

    return _shell(ctx, Intent.WHY_HIGH, facts, caveats, period=result.current.label)


def build_how_to_reduce(ctx: AccountContext) -> FactBundle:
    """"What can I do about it?" — advice grounded in this household's own drivers.

    Generic energy tips are worse than useless here: they are the thing the customer has
    already read, and offering them after an explanation the customer just accepted
    reads as not having listened. So the advice is derived from the decomposition — a
    household whose increase was a price rise is told that using less will not undo it,
    and one whose base load moved is told where the money actually is.

    **Never names an appliance**, for the same reason as everywhere else. "Your
    always-on draw rose by 0.6 kWh a day" is a finding; "check your heat pump" is a
    guess wearing a finding's clothes.
    """
    facts: list[Fact] = []
    caveats: list[str] = [NO_APPLIANCE]

    base = ctx.mean_base_load_kwh
    rate = ctx.current_bill.unit_rate_nzd if ctx.current_bill else None
    if base is not None and rate:
        facts.append(
            Fact.energy(
                "base_load", base, "Running every hour, even when you are out", per_day=True
            )
        )
        facts.append(
            Fact.money(
                "base_load_annual",
                base * 365 * rate,
                "What that costs over a year",
                per_year=True,
            )
        )

    if ctx.has_bill_comparison:
        assert ctx.current_bill is not None and ctx.prior_bill is not None
        result = decompose(
            ctx.current_bill,
            ctx.prior_bill,
            heating_sensitivity_kwh_per_hdd=ctx.heating_sensitivity_kwh_per_hdd,
        )
        movable = [
            d for d in result.material_drivers() if d.key in {"base_load", "discretionary"}
        ]
        fixed_causes = [
            d
            for d in result.material_drivers()
            if d.key in {"unit_price", "fixed_charges", "period_length"}
        ]
        for d in movable:
            facts.append(Fact.money(f"movable_{d.key}", d.amount_nzd, d.label))
        if fixed_causes and not movable:
            caveats.append(
                "The increase was NOT caused by anything the household did — it was "
                "price, fixed charges or the length of the billing period. Say that "
                "plainly and do not suggest they use less to undo it. Offer a plan "
                "check instead."
            )

    if ctx.plan and ctx.plan.is_low_user is False and ctx.total_import_kwh:
        caveats.append(
            "You may mention that a plan check is available. Do NOT claim a saving — no "
            "figure for an alternative plan has been given to you."
        )

    if not facts:
        caveats.append(
            "You have NO figures to base advice on. Say you cannot give specific advice "
            "for this account yet and offer to connect them with the team. Do not offer "
            "general energy-saving tips."
        )

    return _shell(ctx, Intent.HOW_TO_REDUCE, facts, caveats)


# ──────────────────────────── account lookups ────────────────────────────
#
# Copies, not computations. Each returns stored values as reference facts, so layer 3
# checks them by containment. None of them may invent, round, or convert anything.

_LOOKUP_CAVEAT = (
    "This is a stored detail from the customer's account. Repeat it exactly as given "
    "and add nothing to it."
)


def _missing(ctx: AccountContext, intent: Intent, what: str) -> FactBundle:
    """The honest answer when the account row does not carry the field.

    A dedicated builder rather than an empty bundle, because an empty bundle with no
    caveats is the one case layer 3 cannot protect: a sentence with no numeric token
    passes the checker, so "your plan is our standard residential rate" would reach the
    customer unchallenged. The caveat is the only guard on this path.
    """
    return _shell(
        ctx,
        intent,
        facts=[],
        caveats=[
            f"You do NOT have {what} for this account. Say plainly that you cannot see "
            f"it and offer to connect them with the team. Do not guess, do not describe "
            f"it in general terms, and do not substitute a different detail.",
        ],
    )


def build_plan_details(ctx: AccountContext) -> FactBundle:
    if ctx.plan is None:
        return _missing(ctx, Intent.PLAN_DETAILS, "plan details")
    facts = [
        Fact.reference("plan_name", ctx.plan.name, "Your plan"),
        Fact.reference(
            "user_type",
            "low user" if ctx.plan.is_low_user else "standard user",
            "Your user category",
        ),
    ]
    if ctx.plan.is_tou:
        facts.append(
            Fact.reference("plan_shape", "time of use", "How your plan prices power")
        )
    if ctx.plan.term_months:
        facts.append(
            Fact.reference("term", f"{ctx.plan.term_months} months", "Your term commitment")
        )
    return _shell(ctx, Intent.PLAN_DETAILS, facts, [_LOOKUP_CAVEAT])


def build_rate_details(ctx: AccountContext) -> FactBundle:
    if ctx.plan is None or (
        ctx.plan.unit_rate_nzd is None and ctx.plan.daily_fixed_nzd is None
    ):
        return _missing(ctx, Intent.RATE_DETAILS, "the rates")
    facts: list[Fact] = []
    if ctx.plan.unit_rate_nzd is not None:
        facts.append(
            Fact.money("unit_rate", ctx.plan.unit_rate_nzd, "What you pay for each unit")
        )
    if ctx.plan.daily_fixed_nzd is not None:
        facts.append(
            Fact.money("daily_fixed", ctx.plan.daily_fixed_nzd, "Your fixed charge each day")
        )
    caveats = [_LOOKUP_CAVEAT]
    if ctx.plan.is_tou:
        caveats.append(
            "This plan prices power differently at different times of day, so the unit "
            "rate you were given is an average across the period rather than a single "
            "posted rate. Say so."
        )
    return _shell(ctx, Intent.RATE_DETAILS, facts, caveats)


def build_account_balance(ctx: AccountContext) -> FactBundle:
    if ctx.billing is None or ctx.billing.balance_nzd is None:
        return _missing(ctx, Intent.ACCOUNT_BALANCE, "a current balance")
    balance = ctx.billing.balance_nzd
    facts = [
        Fact.money(
            "balance",
            abs(balance),
            "In credit by" if balance < 0 else "Currently owing",
        )
    ]
    caveats = [_LOOKUP_CAVEAT]
    if ctx.billing.is_overdue:
        caveats.append(
            "This balance is past its due date. Mention that, warmly and without "
            "pressure, and offer to connect them with the team about payment options. "
            "Do not warn about disconnection and do not mention fees."
        )
    if balance < 0:
        caveats.append("The account is IN CREDIT. Do not describe this as money owed.")
    return _shell(ctx, Intent.ACCOUNT_BALANCE, facts, caveats)


def build_bill_due(ctx: AccountContext) -> FactBundle:
    if ctx.billing is None or ctx.billing.due_date is None:
        return _missing(ctx, Intent.BILL_DUE, "a due date")
    facts = [Fact.on_date("due_date", ctx.billing.due_date, "Your bill is due")]
    if ctx.billing.last_bill_total_nzd is not None:
        facts.append(
            Fact.money("amount_due", ctx.billing.last_bill_total_nzd, "The amount due")
        )
    caveats = [_LOOKUP_CAVEAT]
    if ctx.billing.is_overdue:
        caveats.append(
            "That date has PASSED. Say so plainly and offer to connect them with the "
            "team. Do not threaten disconnection or quote a late fee."
        )
    elif (days := ctx.billing.days_until_due) is not None:
        facts.append(Fact.duration("days_until_due", days, "Time left to pay"))
    return _shell(ctx, Intent.BILL_DUE, facts, caveats)


def build_payment_method(ctx: AccountContext) -> FactBundle:
    if ctx.billing is None or ctx.billing.payment_method is None:
        return _missing(ctx, Intent.PAYMENT_METHOD, "a payment method")
    pretty = ctx.billing.payment_method.replace("_", " ")
    return _shell(
        ctx,
        Intent.PAYMENT_METHOD,
        [Fact.reference("payment_method", pretty, "How your bill is paid")],
        [
            _LOOKUP_CAVEAT,
            "Do NOT offer to change the payment method, take payment details, or "
            "describe how to set one up. Offer to connect them with the team instead.",
        ],
    )


def build_account_identity(ctx: AccountContext) -> FactBundle:
    """Account number, ICP, address, network.

    Carries PII into a `FactBundle`, which nothing else here does — and it is the reason
    the bundle docstring's rule is written as "no PII the *narration* does not need"
    rather than "no PII". A customer asking for their own ICP cannot be answered without
    it. Scope is the control: everything in this bundle belongs to the authenticated
    account, `resolver._REFUSE` blocks requests aimed at anyone else's, and no other
    intent's bundle includes any of it.
    """
    facts: list[Fact] = []
    if ctx.billing is not None:
        facts.append(
            Fact.reference("account_number", ctx.billing.account_number, "Your account number")
        )
    if ctx.connection is not None:
        facts.append(Fact.reference("icp", ctx.connection.icp_number, "Your ICP number"))
        if ctx.connection.address_display:
            facts.append(
                Fact.reference("address", ctx.connection.address_display, "The supply address")
            )
        if ctx.connection.network_name:
            facts.append(
                Fact.reference(
                    "network", ctx.connection.network_name, "The lines company for your area"
                )
            )
    if not facts:
        return _missing(ctx, Intent.ACCOUNT_IDENTITY, "those details")
    return _shell(
        ctx,
        Intent.ACCOUNT_IDENTITY,
        facts,
        [
            _LOOKUP_CAVEAT,
            "An ICP is the identifier for the physical connection. If you explain it, "
            "explain only that.",
        ],
    )


def build_billing_cycle(ctx: AccountContext) -> FactBundle:
    if ctx.billing is None or ctx.billing.current_period_end is None:
        return _missing(ctx, Intent.BILLING_CYCLE, "billing cycle dates")
    facts: list[Fact] = [
        Fact.on_date(
            "period_end", ctx.billing.current_period_end, "Your current period ends"
        )
    ]
    if ctx.billing.current_period_start is not None:
        facts.insert(
            0,
            Fact.on_date(
                "period_start", ctx.billing.current_period_start, "Your current period started"
            ),
        )
    if ctx.billing.days_into_period is not None:
        facts.append(
            Fact.day_of_period(
                "days_elapsed", ctx.billing.days_into_period, "Days into this period"
            )
        )
    return _shell(ctx, Intent.BILLING_CYCLE, facts, [_LOOKUP_CAVEAT])


def build_supply_quality(ctx: AccountContext) -> FactBundle:
    """"Is this an estimate?" — the disclosure, asked for directly.

    Answerable precisely, and worth answering well: a customer who asks this is checking
    whether to trust everything else the service has told them.
    """
    q = ctx.quality
    facts: list[Fact] = [
        Fact.percent("estimated_pct", q.estimated_read_pct, "Share of readings that were estimated")
    ]
    if q.last_read_at is not None:
        facts.append(
            Fact.on_date("last_read", q.last_read_at.date(), "Your meter was last read")
        )
    caveats = [_LOOKUP_CAVEAT]
    if q.estimated_read_pct <= 0 and not ctx.has_gaps:
        caveats.append(
            "Every reading in this period was an actual meter read. Say so plainly."
        )
    return _shell(ctx, Intent.SUPPLY_QUALITY, facts, caveats)


def build_solar_export(ctx: AccountContext) -> FactBundle:
    if ctx.connection is not None and not ctx.connection.has_solar:
        return _shell(
            ctx,
            Intent.SOLAR_EXPORT,
            facts=[],
            caveats=[
                "This connection has NO solar registered. Say so plainly and do not "
                "quote any export or credit figure.",
            ],
        )
    exported = ctx.total_export_kwh
    if not exported:
        return _missing(ctx, Intent.SOLAR_EXPORT, "any export readings")
    facts = [Fact.energy("exported", exported, "Sent back to the grid this period")]
    if ctx.current_bill is not None and ctx.current_bill.export_credit_nzd:
        facts.append(
            Fact.money(
                "export_credit", ctx.current_bill.export_credit_nzd, "What you were credited"
            )
        )
    return _shell(ctx, Intent.SOLAR_EXPORT, facts, [_LOOKUP_CAVEAT])


def build_compare_to_similar(ctx: AccountContext) -> FactBundle:
    """"Am I using more than other people?" — against the peer cohort, named as such.

    The caveat is the load-bearing part. The baseline is the mean daily use of the other
    seeded accounts: a real cohort, reproducible from the same tables, and **not** a
    claim about New Zealand averages. Letting the narration imply otherwise would be a
    fabricated statistic in the one place nobody would check it, because it sounds
    exactly like the figure a retailer would have.
    """
    peer = ctx.peer_baseline_kwh_per_day
    if peer is None or not ctx.days:
        return _missing(ctx, Intent.COMPARE_TO_SIMILAR, "a comparison group")
    mine = ctx.total_import_kwh / len(ctx.days)
    facts = [
        Fact.energy("your_daily_use", mine, "What you use on an average day", per_day=True),
        Fact.energy("peer_daily_use", peer, "What comparable homes use", per_day=True),
        Fact.energy("daily_difference", abs(mine - peer), "The difference", per_day=True),
    ]
    return _shell(
        ctx,
        Intent.COMPARE_TO_SIMILAR,
        facts,
        [
            NO_APPLIANCE,
            "The comparison group is other households in this dataset. It is NOT a New "
            "Zealand average and must not be described as one.",
            "Do not tell them whether this is good or bad. State the two figures.",
        ],
    )


def build_bill_breakdown(ctx: AccountContext) -> FactBundle:
    """"What are all these charges?" — the bill split into what it is made of.

    Splits fixed from variable before anything else, because that is the division a
    customer cannot see on the printed bill and the one that changes what they can do
    about it. Line-level detail (`billing.bill_line`) is a further step and is not
    modelled on the application side yet — so this gives the three totals it can
    reconstruct exactly, and does not pretend to itemise.
    """
    bill = ctx.current_bill
    if bill is None:
        return _missing(ctx, Intent.BILL_BREAKDOWN, "a bill to break down")

    fixed = bill.daily_fixed_nzd * bill.days
    variable = bill.total_kwh * bill.unit_rate_nzd
    facts = [
        Fact.money("bill_total", bill.total_nzd, f"Your {bill.label} bill"),
        Fact.money("variable_charges", variable, "For the power you used"),
        Fact.money("fixed_charges", fixed, f"Fixed daily charges over {bill.days} days"),
        Fact.money("daily_fixed", bill.daily_fixed_nzd, "The fixed charge per day"),
    ]
    if bill.export_credit_nzd:
        facts.append(
            Fact.money("export_credit", bill.export_credit_nzd, "Credited for solar you exported")
        )
    if bill.one_off_nzd:
        facts.append(Fact.money("one_offs", bill.one_off_nzd, "Fees, credits or discounts"))

    caveats = [
        _LOOKUP_CAVEAT,
        "Fixed charges apply whatever they use. Say so — it is the part of the bill "
        "using less power cannot reduce.",
    ]
    if not bill.reconstructs:
        caveats.append(
            "These parts do NOT add up to the bill total. Say that this is a summary "
            "rather than a complete itemisation, and offer to connect them with the team."
        )
    return _shell(ctx, Intent.BILL_BREAKDOWN, facts, caveats, period=bill.label)


def build_usage_total(ctx: AccountContext) -> FactBundle:
    total = ctx.total_import_kwh
    if not total:
        return _missing(ctx, Intent.USAGE_TOTAL, "usage readings")
    facts = [
        Fact.energy("total_usage", total, f"Used in {ctx.period_label}"),
        Fact.energy("mean_daily", total / len(ctx.days), "Average per day", per_day=True),
    ]
    if ctx.current_bill is not None:
        facts.append(Fact.money("period_cost", ctx.current_bill.total_nzd, "What it cost"))
    if ctx.total_controlled_kwh:
        facts.append(
            Fact.energy(
                "controlled_usage", ctx.total_controlled_kwh, "Of that, on your controlled circuit"
            )
        )
    return _shell(ctx, Intent.USAGE_TOTAL, facts, [NO_APPLIANCE])
