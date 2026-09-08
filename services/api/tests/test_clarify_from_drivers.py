"""Clarifying questions on the chat path, driven by what the decomposition could not explain.

The machinery in `app/clarify/` already existed but was reachable only from the
bill-shock endpoint. What the chat explainer adds is a better trigger: `delta_unexplained`
is a quantified gap by construction — the decomposition has already tried every cause it
knows and named, in dollars, what is left.

The rule these tests defend is the one that stops this becoming an intake form: **a
question that cannot change the answer is never asked.**
"""

from __future__ import annotations

import datetime as dt

from app.analytics.account import AccountContext, DayUsage
from app.analytics.drivers import BillPeriod, decompose
from app.analytics.explain import build_why_high_v2
from app.clarify import from_drivers
from app.clarify.schemas import HouseholdContext, Hypothesis


def _household(**kw) -> HouseholdContext:
    return HouseholdContext(account_ref="ACC-1", **kw)


def _ctx(*, controlled_recent=0.0, controlled_earlier=0.0, base_now=8.9, total_now=268.0):
    days = [
        DayUsage(
            date=dt.date(2026, 7, 1) + dt.timedelta(days=i),
            import_kwh=18.0,
            controlled_kwh=controlled_recent if i >= 21 else controlled_earlier,
            base_load_kwh=7.6,
        )
        for i in range(31)
    ]
    return AccountContext(
        account_ref="ACC-1",
        days=days,
        current_bill=BillPeriod.from_bill(
            "August 2026", days=31, total_nzd=total_now, total_kwh=690.0,
            daily_fixed_nzd=1.62, base_load_kwh_per_day=base_now, heating_degree_days=250.0),
        prior_bill=BillPeriod.from_bill(
            "July 2026", days=31, total_nzd=190.0, total_kwh=560.0,
            daily_fixed_nzd=1.62, base_load_kwh_per_day=7.0, heating_degree_days=245.0),
        heating_sensitivity_kwh_per_hdd=0.4,
    )


def _asked(bundle) -> str | None:
    for caveat in bundle.caveats:
        if "word for word" in caveat:
            return caveat.split('"')[1]
    return None


# ───────────────────── when a question is worth asking ─────────────────────


def test_a_question_is_asked_when_the_drivers_leave_a_real_gap() -> None:
    assert _asked(build_why_high_v2(_ctx(), household=_household())) is not None


def test_no_question_when_the_bill_is_fully_explained() -> None:
    """An assistant that finds something to ask every time is running an intake form."""
    same = BillPeriod.from_bill(
        "July 2026", days=31, total_nzd=190.0, total_kwh=560.0,
        daily_fixed_nzd=1.62, base_load_kwh_per_day=7.0, heating_degree_days=245.0)
    ctx = AccountContext(
        account_ref="ACC-1",
        days=[DayUsage(date=dt.date(2026, 7, 1) + dt.timedelta(days=i), import_kwh=18.0)
              for i in range(31)],
        current_bill=same, prior_bill=same, heating_sensitivity_kwh_per_hdd=0.4)
    assert _asked(build_why_high_v2(ctx, household=_household())) is None


def test_a_trivial_residual_is_below_the_asking_threshold() -> None:
    """Being interrupted over $3 makes the assistant look worse than saying nothing."""
    result = decompose(_ctx().current_bill, _ctx().prior_bill)
    gaps = from_drivers.gaps_from_decomposition(result, _ctx())
    for gap in gaps:
        assert gap.explains_nzd >= from_drivers.MIN_WORTH_ASKING_NZD


# ───────────────────── the controlled-load signal ─────────────────────


def test_a_moved_controlled_circuit_promotes_the_hot_water_question() -> None:
    """Controlled load is the one appliance signal that is not an inference.

    It is a separate register that the network switches, so a rise is a *reading* from
    the circuit the cylinder is on rather than a guess about a whole-house total. That
    licenses asking — not asserting.
    """
    ctx = _ctx(controlled_recent=5.4, controlled_earlier=3.1)
    assert from_drivers.hot_water_is_evidenced(ctx)
    assert from_drivers.preferred_hypothesis(ctx) is Hypothesis.HOT_WATER_CHANGE
    assert "hot water" in (_asked(build_why_high_v2(ctx, household=_household())) or "")


def test_without_the_signal_the_ladder_asks_the_likeliest_cause_instead() -> None:
    """Hot water sits last by default because people rarely know the answer. It should
    only jump the queue when there is a reading behind it."""
    ctx = _ctx(controlled_recent=3.1, controlled_earlier=3.1)
    assert from_drivers.preferred_hypothesis(ctx) is None
    assert "hot water" not in (_asked(build_why_high_v2(ctx, household=_household())) or "")


def test_no_controlled_register_is_no_signal_not_no_change() -> None:
    """None must not be read as zero — an account with no controlled circuit should fall
    back to the ladder, not be scored as 'the cylinder definitely did not move'."""
    assert _ctx().controlled_load_shift() is None


# ───────────────────── not asking twice, and not asking at all ─────────────────────


def test_an_answered_question_is_not_asked_again() -> None:
    ctx = _ctx(controlled_recent=5.4, controlled_earlier=3.1)
    answered = _household(hot_water_changed_since=dt.date(2026, 7, 22))
    assert _asked(build_why_high_v2(ctx, household=answered)) is None


def test_a_denial_moves_the_ladder_along() -> None:
    """"No, nothing new" is a fact about the household, not an absence of one."""
    ctx = _ctx()
    first = _asked(build_why_high_v2(ctx, household=_household()))
    after = _asked(build_why_high_v2(ctx, household=_household(no_new_appliance=True)))
    assert first != after


def test_a_vulnerable_customer_is_never_questioned() -> None:
    """The same rule the alert policy applies: a person, not a questionnaire."""
    ctx = _ctx()
    assert _asked(build_why_high_v2(ctx, household=_household())) is not None
    vulnerable = AccountContext(**{**ctx.__dict__, "is_vulnerable": True})
    assert _asked(build_why_high_v2(vulnerable, household=_household())) is None


def test_no_household_record_disables_the_question_not_the_answer() -> None:
    """A clarifying question is an enhancement; the explanation is the product."""
    bundle = build_why_high_v2(_ctx(), household=None)
    assert _asked(bundle) is None
    assert bundle.facts


def test_the_question_is_delivered_verbatim_not_paraphrased() -> None:
    """A paraphrased question about somebody's home is a question we did not write."""
    caveats = build_why_high_v2(_ctx(), household=_household()).caveats
    joined = " ".join(caveats)
    assert "word for word" in joined
    assert "Do not rephrase" in joined
