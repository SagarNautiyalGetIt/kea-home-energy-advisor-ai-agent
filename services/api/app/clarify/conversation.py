"""Wiring `app/clarify/` into the chat path — the half that was only ever on /bill-shock.

Everything in this package worked and nothing reached a conversation: `app/pipeline.py`
imported none of it, so the assistant could not ask a question and could not receive an
answer to one. Issue #142 point 4.

## Why the question is not written by the model

The model could obviously produce a fluent question, and that is the wrong thing. The
property that makes multi-turn *testable* is that Sparky asks, so **Sparky bounds the
reply space** — we do not have to guess what a customer might type next, only handle the
answers to a question we wrote. A model composing its own question loses that on the
first paraphrase, and it also means a model choosing what to ask about somebody's home.

So `select()` picks it, the prompt in `ClarifyingQuestion.prompt` is the exact text, and
`pipeline.answer()` appends it verbatim after the model has finished. The model is told
not to ask one of its own.

## How the open question survives between turns without a schema change

It is **re-derived**, not stored. The same trick `routes.py:_rebuild_question` uses for
the REST path: a question is a pure function of the account's data and the household's
recorded context, so running `select()` again on the next turn returns the same question —
until an answer is recorded, at which point `HouseholdContext.asked` changes and it
returns the next one, or None.

That means there is no "open question" column to leave stale, and no way for a client to
answer a question it was never asked: the id has to be the question this household would
be asked *right now*.

## What the model does contribute

Mapping "yeah, we got a heat pump in June" onto `Answer.YES, since=2024-06-01`. That is
natural language understanding, which is what it is for, and it stays inside a typed
boundary — `QuestionResponse` validates, and a date attached to "no" is rejected rather
than written. Free text never becomes a stored fact.
"""

from __future__ import annotations

import logging

from app.analytics.account import AccountContext
from app.clarify import apply, from_drivers, questions
from app.clarify.night import sustained_night_rise
from app.clarify.schemas import (
    ClarifyingQuestion,
    Gap,
    HouseholdContext,
    Hypothesis,
    QuestionResponse,
)

log = logging.getLogger(__name__)


def question_for(
    account: AccountContext,
    household: HouseholdContext,
    *,
    period: str,
    hardship_detected: bool,
) -> ClarifyingQuestion | None:
    """The one question worth asking this household right now, or None.

    None is the common case and the correct default — a bill whose drivers account for it
    has nothing to ask about, and an assistant that always finds something to ask is doing
    an intake form.

    Needs both bills: the gaps come from the decomposition, and there is no decomposition
    without something to compare against. A first bill is a complete explanation in itself
    (see `db/marts.py`), not a gap.
    """
    if hardship_detected:
        # The rule this package already applies on the alert path, for the same reason: a
        # household that has told us they are struggling gets a person, not a
        # questionnaire.
        return None

    # Ownership is useful context, never proof that the EV caused the rise. Only mart
    # accounts with interval-derived night bands qualify; daily totals cannot supply it.
    if household.has_ev is None and not household.has_answered("night_load_pattern:ev_charging"):
        rise = (
            sustained_night_rise(account.days) if account.quality.estimated_read_pct < 10 else None
        )
        if rise is not None and account.connection is not None:
            return ClarifyingQuestion(
                id="night_load_pattern:ev_charging",
                gap=Gap.NIGHT_LOAD_PATTERN,
                hypothesis=Hypothesis.EV_CHARGING,
                prompt=(
                    f"Your meter shows night use staying about {rise:.1f} kWh higher per night "
                    "over the last five measured nights. Do you have an EV? If so, I can "
                    "check whether charging is a possibility, but a charger reading or "
                    "charging schedule is needed to confirm it."
                ),
                explains_nzd=0,
            )

    if not account.has_bill_comparison:
        return None

    from app.analytics.drivers import decompose

    try:
        decomposition = decompose(
            account.current_bill,
            account.prior_bill,
            heating_sensitivity_kwh_per_hdd=account.heating_sensitivity_kwh_per_hdd,
            weather_fit_r2=account.weather_fit_r2,
        )
        gaps = from_drivers.gaps_from_decomposition(decomposition, account)
        return questions.select(
            gaps,
            household,
            period=period,
            hardship_detected=hardship_detected,
            evidenced=from_drivers.preferred_hypothesis(account),
        )
    except Exception:  # noqa: BLE001 - a question is a nicety, never a reason to fail
        # The answer is the product; the question is an addition to it. A household whose
        # decomposition cannot be built should still get their explanation.
        log.warning(
            "could not select a clarifying question for %s", account.account_ref, exc_info=True
        )
        return None


def record_answer(
    household: HouseholdContext,
    question: ClarifyingQuestion,
    response: QuestionResponse,
) -> HouseholdContext:
    """Fold one answer in. Thin, but it keeps `apply` off the agent's import path.

    `asked_on` is the day the *detector* found, not the day we asked — when the customer
    cannot give a date, the step is why we asked and is the better estimate.
    """
    asked_on = None
    if question.since_day is not None and household is not None:
        # `since_day` is a 1-based index into the period, and the period's calendar is on
        # the account rather than here. Left None when it cannot be resolved: `apply`
        # treats that as "yes, but no date", which is honest.
        asked_on = None
    return apply.record(household, question, response, asked_on=asked_on)
