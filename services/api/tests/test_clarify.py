"""Clarifying questions — detection, selection, and what an answer changes.

All pure. The tests that matter are the ones about *when not to ask*: a feature that
always finds something to ask is an intake form, and a feature that asks after the
customer has already answered is one people mute.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.alerts.preferences import defaults_for
from app.analytics import billshock, fixtures
from app.analytics.engine import UsageWindow
from app.analytics.forecast import fit_weather_response
from app.clarify import apply, detect, questions
from app.clarify.schemas import (
    Answer,
    ClarifyingQuestion,
    Gap,
    HouseholdContext,
    Hypothesis,
    QuestionResponse,
)

DAYS_IN_JULY = 31
PRICE = 0.30


def stepped_series(before: float, after: float, at: int, days: int = 24) -> list[float]:
    """A clean step with a little noise, so the detector has something to be sure about."""
    wobble = [0.0, 0.2, -0.2, 0.1, -0.1, 0.15]
    return [
        (before if i < at else after) + wobble[i % len(wobble)] for i in range(days)
    ]


def context(**overrides) -> HouseholdContext:
    return HouseholdContext(account_ref="H-JUL", **overrides)


def question_for(hypothesis: Hypothesis, gap: Gap = Gap.BASE_LOAD_STEP) -> ClarifyingQuestion:
    return ClarifyingQuestion(
        id=f"{gap.value}:{hypothesis.value}",
        gap=gap,
        hypothesis=hypothesis,
        prompt="…",
        explains_nzd=27.0,
        since_day=12,
    )


# ───────────────────────── detection ─────────────────────────


def test_a_clean_step_is_found_with_its_date():
    """The whole reason to detect rather than just ask. A date turns "has anything
    changed?" into a question somebody can actually answer."""
    step = detect.find_step_change(stepped_series(8.0, 11.0, at=12))

    assert step is not None
    assert step.day_index == pytest.approx(13, abs=1)
    assert step.step_kwh_per_day == pytest.approx(3.0, abs=0.3)


def test_a_flat_series_has_no_step():
    assert detect.find_step_change([9.0, 9.2, 8.8, 9.1, 9.0] * 4) is None


def test_a_step_smaller_than_the_noise_is_not_a_step():
    """A 2 kWh step means nothing in a series that swings by 5."""
    noisy = [8.0, 14.0, 6.0, 13.0, 7.0, 15.0] * 4
    assert detect.find_step_change(noisy) is None


def test_a_short_series_is_refused():
    assert detect.find_step_change([8.0] * 6) is None


def test_a_cold_snap_is_not_mistaken_for_a_new_appliance():
    """The single most likely way this detector produces a wrong question.

    Usage that rises purely because it got colder must not be read as a step, or every
    household in a southerly gets asked whether they bought a heater.
    """
    hdd = [6.0] * 12 + [14.0] * 12
    daily = [5.0 + 0.5 * h for h in hdd]
    fit = fit_weather_response(daily, hdd)

    assert fit.usable
    # Without the weather adjustment this looks like a textbook step.
    assert detect.find_step_change(daily) is not None
    # With it, correctly nothing.
    assert detect.find_step_change(daily, response=fit, daily_hdd=hdd) is None


def test_gaps_are_ordered_by_what_they_would_explain():
    fit = fit_weather_response([8.0] * 6 + [12.0] * 6, [9.0, 7.0] * 6)
    gaps = detect.find_gaps(
        daily_kwh=stepped_series(8.0, 11.0, at=12),
        daily_hdd=[8.0] * 24,
        response=fit,
        unit_price_nzd=PRICE,
        overshoot_nzd=80.0,
        unexplained_nzd=60.0,
        attribution_explained=True,
    )
    assert [g.explains_nzd for g in gaps] == sorted(
        [g.explains_nzd for g in gaps], reverse=True
    )


def test_a_fully_explained_overshoot_produces_no_gap():
    """Nothing unexplained means nothing to ask about. This is the common case."""
    fit = fit_weather_response([8.0] * 12, [9.0, 7.0] * 6)
    gaps = detect.find_gaps(
        daily_kwh=[9.0, 9.1, 8.9] * 4,
        daily_hdd=[8.0] * 12,
        response=fit,
        unit_price_nzd=PRICE,
        overshoot_nzd=60.0,
        unexplained_nzd=5.0,
        attribution_explained=True,
    )
    assert gaps == []


# ───────────────────────── selection ─────────────────────────


def step_gap(explains: float = 27.0) -> detect.DetectedGap:
    return detect.DetectedGap(
        gap=Gap.BASE_LOAD_STEP,
        explains_nzd=explains,
        step=detect.StepChange(
            day_index=12,
            before_kwh_per_day=8.0,
            after_kwh_per_day=11.0,
            step_kwh_per_day=3.0,
            sigma=2.4,
        ),
    )


def test_no_gaps_means_no_question():
    assert questions.select([], context(), period="July 2026") is None


def test_the_appliance_question_comes_first():
    """A dated step that persists is overwhelmingly a new always-on load."""
    q = questions.select([step_gap()], context(), period="July 2026")
    assert q is not None
    assert q.hypothesis is Hypothesis.NEW_APPLIANCE


def test_a_denial_promotes_the_next_hypothesis():
    """The reason a denial is stored as a fact rather than as an absence. "No, nothing
    new" is what makes the occupancy question worth asking."""
    q = questions.select(
        [step_gap()], context(no_new_appliance=True), period="July 2026"
    )
    assert q is not None
    assert q.hypothesis is Hypothesis.MORE_OCCUPANTS


def test_the_ladder_runs_out_rather_than_repeating():
    settled = context(
        no_new_appliance=True, extra_occupants=0, hot_water_changed_since=dt.date(2026, 7, 1)
    )
    assert questions.select([step_gap()], settled, period="July 2026") is None


def test_a_question_already_asked_is_not_asked_again():
    """A question asked and ignored is still asked. Re-asking it is how an assistant
    becomes something people mute."""
    asked = context(asked=["base_load_step:new_appliance"])
    q = questions.select([step_gap()], asked, period="July 2026")
    assert q is None or q.hypothesis is not Hypothesis.NEW_APPLIANCE


def test_the_question_carries_a_date_and_the_amount_it_would_explain():
    q = questions.select([step_gap(explains=27.0)], context(), period="July 2026")
    assert q is not None
    assert "day 12" in q.prompt
    assert "$27" in q.prompt
    assert q.since_day == 12


def test_a_trivial_amount_gets_no_payoff_sentence():
    """"This would explain about $2" is not a reason to ask somebody about their home."""
    q = questions.select([step_gap(explains=2.0)], context(), period="July 2026")
    assert q is not None
    assert "would let Sparky account" not in q.prompt


def test_nothing_is_asked_during_hardship():
    """A household that has told us they are struggling gets a person, not a
    questionnaire. Same rule as the alert policy."""
    q = questions.select(
        [step_gap()], context(), period="July 2026", hardship_detected=True
    )
    assert q is None


def test_a_failed_weather_fit_asks_about_heating_not_appliances():
    gap = detect.DetectedGap(gap=Gap.NO_WEATHER_FIT, explains_nzd=68.0)
    q = questions.select([gap], context(), period="July 2026")
    assert q is not None
    assert q.hypothesis is Hypothesis.ELECTRIC_HEATING


def test_an_undated_gap_never_asks_the_appliance_question():
    """Without a date the appliance question is the weak version of itself — "has anything
    arrived lately" is not answerable. Occupancy and hot water are."""
    gap = detect.DetectedGap(gap=Gap.UNEXPLAINED_REMAINDER, explains_nzd=40.0)
    q = questions.select([gap], context(), period="July 2026")
    assert q is not None
    assert q.hypothesis is not Hypothesis.NEW_APPLIANCE


def test_the_narrator_is_told_to_deliver_the_question_verbatim():
    """A small model given a question and no instruction paraphrases it, and a paraphrased
    question about somebody's home is a question we did not write."""
    q = questions.select([step_gap()], context(), period="July 2026")
    caveats = " ".join(questions.caveats_for(q))
    assert "word for word" in caveats
    assert "Do not rephrase" in caveats


# ───────────────────────── answers ─────────────────────────


def test_a_yes_records_the_cause_and_the_date():
    updated = apply.record(
        context(),
        question_for(Hypothesis.NEW_APPLIANCE),
        QuestionResponse(
            question_id="base_load_step:new_appliance",
            answer=Answer.YES,
            since=dt.date(2026, 7, 12),
        ),
    )
    assert updated.new_appliance_since == dt.date(2026, 7, 12)
    assert updated.explains_a_step


def test_a_no_is_recorded_as_a_fact():
    updated = apply.record(
        context(),
        question_for(Hypothesis.NEW_APPLIANCE),
        QuestionResponse(question_id="base_load_step:new_appliance", answer=Answer.NO),
    )
    assert updated.no_new_appliance is True
    assert not updated.explains_a_step


def test_unsure_closes_the_question_without_confirming_anything():
    updated = apply.record(
        context(),
        question_for(Hypothesis.NEW_APPLIANCE),
        QuestionResponse(question_id="base_load_step:new_appliance", answer=Answer.UNSURE),
    )
    assert updated.has_answered("base_load_step:new_appliance")
    assert updated.new_appliance_since is None
    assert updated.no_new_appliance is False


def test_a_yes_with_no_date_still_sets_the_field():
    """Most people remember "a few weeks ago", not a date. A required date would make
    them invent one."""
    updated = apply.record(
        context(),
        question_for(Hypothesis.MORE_OCCUPANTS),
        QuestionResponse(question_id="base_load_step:more_occupants", answer=Answer.YES),
        asked_on=dt.date(2026, 7, 20),
    )
    assert updated.extra_occupants == 1
    assert updated.extra_occupants_since == dt.date(2026, 7, 20)


def test_detail_on_a_denial_is_rejected():
    """A date attached to "no" is a client bug, and a silent one — it would write a
    confirmed change into the household's context off a denial."""
    with pytest.raises(ValueError, match="only accompany a 'yes'"):
        QuestionResponse(
            question_id="x", answer=Answer.NO, since=dt.date(2026, 7, 12)
        )


def test_an_absurd_occupant_count_is_rejected():
    with pytest.raises(ValueError):
        QuestionResponse(question_id="x", answer=Answer.YES, count=4000)


# ───────────────────────── the payoff ─────────────────────────


STEP = detect.StepChange(
    day_index=12,
    before_kwh_per_day=8.0,
    after_kwh_per_day=11.0,
    step_kwh_per_day=3.0,
    sigma=2.4,
)


def test_an_unconfirmed_step_gets_no_explanation():
    """Returning a hedged cause here would be the exact fabrication the question was
    asked to avoid."""
    facts, caveats = apply.explain_step(
        context(), STEP, unit_price_nzd=PRICE, period="July 2026"
    )
    assert facts == []
    assert caveats == []


def test_a_confirmed_step_becomes_named_and_costed_facts():
    facts, caveats = apply.explain_step(
        context(new_appliance_since=dt.date(2026, 7, 12)),
        STEP,
        unit_price_nzd=PRICE,
        period="July 2026",
    )
    keys = {f.key for f in facts}
    assert "confirmed_step_monthly_nzd" in keys
    assert "confirmed_step_day" in keys
    # 3 kWh/day x 30 days x $0.30
    monthly = next(f for f in facts if f.key == "confirmed_step_monthly_nzd")
    assert monthly.value == pytest.approx(27.0, abs=0.01)
    assert "MAY attribute" in " ".join(caveats)


def test_the_caveat_differs_once_the_customer_has_already_been_asked():
    """Pretending we might know after they have helped is worse than admitting we don't."""
    open_q = apply.unexplained_caveat(True)
    exhausted = apply.unexplained_caveat(False)
    assert "ask the question you were given" in open_q
    assert "already been asked" in exhausted
    assert "put them through to someone" in exhausted


def test_every_confirmed_step_fact_is_a_scalar():
    """Same rule as every other bundle."""
    facts, _ = apply.explain_step(
        context(extra_occupants=2), STEP, unit_price_nzd=PRICE, period="July 2026"
    )
    for fact in facts:
        assert isinstance(fact.value, int | float)


# ───────────────────────── end to end, through the assessment ─────────────────────────


def assess_with_step(context_: HouseholdContext | None = None):
    daily = stepped_series(7.0, 10.5, at=12, days=24)
    window = UsageWindow(customer_id="H-STEP", period="July 2026", daily_kwh=daily)
    hdd, normal = fixtures.heating_degree_days("H-JUL")
    assessment = billshock.assess(
        window,
        days_in_cycle=DAYS_IN_JULY,
        daily_hdd=hdd[:24],
        normal_hdd_per_day=normal,
        comparable_home_kwh_per_day=7.0,
        preferences=defaults_for("H-STEP"),
    )
    gaps = detect.find_gaps(
        daily_kwh=daily,
        daily_hdd=hdd[:24],
        response=assessment.forecast.response,
        unit_price_nzd=window.unit_price_nzd,
        overshoot_nzd=assessment.overshoot_nzd,
        unexplained_nzd=assessment.attribution.everyday_load_nzd,
        attribution_explained=assessment.attribution.explained,
    )
    household = context_ or HouseholdContext(account_ref="H-STEP")
    question = questions.select(gaps, household, period="July 2026")
    bundle = billshock.build_bill_shock(
        assessment, context=household, question=question
    )
    return assessment, question, bundle


def test_a_step_household_gets_a_question_and_no_cause():
    assessment, question, bundle = assess_with_step()

    assert assessment.step is not None
    assert question is not None
    caveats = " ".join(bundle.caveats)
    assert "Do not offer a cause" in caveats
    assert "word for word" in caveats


def test_once_confirmed_the_step_is_named_and_no_longer_asked_about():
    """Scoped to the *step*, deliberately.

    A confirmed appliance closes the step ladder — asking next whether they also have
    guests, about the same step, is the intake-form failure. It does not close every
    question forever: this synthetic series also has an unfittable weather response, and
    "do you heat with electricity?" is a different gap about a different thing. Asserting
    `question is None` here would be asserting that one answer silences the assistant.
    """
    _, question, bundle = assess_with_step(
        HouseholdContext(
            account_ref="H-STEP",
            new_appliance_since=dt.date(2026, 7, 12),
            asked=["base_load_step:new_appliance"],
        )
    )

    assert question is None or question.gap is not Gap.BASE_LOAD_STEP
    assert "confirmed_step_monthly_nzd" in {f.key for f in bundle.facts}
    assert "MAY attribute" in " ".join(bundle.caveats)


def test_the_bundle_is_unchanged_when_the_feature_is_not_used():
    """Both arguments default to None, and with both absent this must behave exactly as
    it did before the feature existed — which is what keeps the golden set meaningful."""
    assessment, _, _ = assess_with_step()
    plain = billshock.build_bill_shock(assessment)
    assert not any("word for word" in c for c in plain.caveats)
