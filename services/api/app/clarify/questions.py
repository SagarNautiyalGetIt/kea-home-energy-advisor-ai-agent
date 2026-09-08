"""The question bank, and how one gets chosen. Pure — no model, no I/O.

## Python writes the question, not the model

Every prompt below is a constant with a couple of computed figures interpolated. That is
not a stylistic preference: a model that composes its own questions is a model deciding
what to ask about somebody's home, and it would compose them from the same context it is
forbidden to reason over. The narrator's job when a question is attached is to *deliver*
it, unchanged, in its own sentence — the caveat on the bundle says so explicitly.

## One question, not a form

`select` returns at most one. Two reasons, and the second is the one that matters:

* A person answering three questions about their house has been given homework in
  exchange for an explanation they asked for.
* **The answers are sequential.** "No, nothing new" is what makes the occupancy question
  worth asking; asking both at once wastes the second one and tells us less. The ladder
  in `_STEP_LADDER` is ordered by prior likelihood, and each denial moves it along.

## Never during hardship

A household that has told us they are struggling gets a person, not a questionnaire.
Same rule as the alert policy, for the same reason.
"""

from __future__ import annotations

from app.clarify.detect import DetectedGap, Gap
from app.clarify.schemas import (
    ClarifyingQuestion,
    HouseholdContext,
    Hypothesis,
)

#: Order the step-change hypotheses by how often each turns out to be the answer, so the
#: first question asked is the one most likely to close the gap in one round.
#:
#: Appliance first because a dated step that persists is overwhelmingly a new always-on
#: load. Occupancy second because guests explain a step that ends and this cycle may not
#: show the end yet. Hot water last because it is the least likely *and* the one people
#: are least able to answer — but it is worth asking, because it is the largest load in
#: most NZ homes and the one nobody thinks to check.
_STEP_LADDER: tuple[Hypothesis, ...] = (
    Hypothesis.NEW_APPLIANCE,
    Hypothesis.MORE_OCCUPANTS,
    Hypothesis.HOT_WATER_CHANGE,
)

_PROMPTS: dict[Hypothesis, str] = {
    Hypothesis.NEW_APPLIANCE: (
        "Your everyday power use stepped up around {when} and has stayed there since. "
        "Did anything new arrive around then — a heater, a heat pump, a freezer, "
        "a spa, an EV charger?"
    ),
    Hypothesis.MORE_OCCUPANTS: (
        "Your everyday power use stepped up around {when}. Has anyone extra been staying "
        "— guests, family home for the holidays, a new flatmate?"
    ),
    Hypothesis.HOT_WATER_CHANGE: (
        "Your everyday power use stepped up around {when} and it looks like a background "
        "load rather than particular busy days. Has anything changed with your hot water "
        "— the thermostat turned up, a longer heating window, or a cylinder that might "
        "be leaking?"
    ),
    Hypothesis.WORKING_FROM_HOME: (
        "Your weekday power use has risen while weekends look much the same. Has someone "
        "started working or studying from home?"
    ),
    Hypothesis.ELECTRIC_HEATING: (
        "Sparky could not work out how much of your {period} use is heating — your usage "
        "does not track the temperature the way an electrically heated home usually does. "
        "Do you heat with electricity, or something else like gas or a wood burner?"
    ),
}

#: What the customer is told the answer would buy them. Without this the question reads as
#: data collection; with it, it reads as an offer.
_PAYOFF = "Knowing would let Sparky account for about ${amount:,.0f} of the increase."


def _question(
    *,
    hypothesis: Hypothesis,
    gap: DetectedGap,
    when: str,
) -> ClarifyingQuestion:
    prompt = _PROMPTS[hypothesis].format(when=when, period="{period}")
    if gap.explains_nzd >= 5:
        prompt = f"{prompt} {_PAYOFF.format(amount=gap.explains_nzd)}"
    return ClarifyingQuestion(
        # Stable across cycles: the id is what stops a household being asked the same
        # thing every month, so it must not carry the period or the amount.
        id=f"{gap.gap.value}:{hypothesis.value}",
        gap=gap.gap,
        hypothesis=hypothesis,
        prompt=prompt,
        explains_nzd=gap.explains_nzd,
        since_day=gap.step.day_index if gap.step else None,
    )


def _next_step_hypothesis(context: HouseholdContext) -> Hypothesis | None:
    """Walk the ladder, skipping anything already settled.

    `no_new_appliance` is what makes this work: a denial is a fact, and it is the fact
    that promotes the occupancy question from "also possible" to "the next thing to ask".

    **The ladder stops as soon as anything explains the step.** The hypotheses are
    alternatives, not a checklist — a customer who has told us a heat pump arrived has
    accounted for the step, and asking them next whether they also have guests is the
    intake-form failure this module exists to avoid. Without this line the ladder walks
    to the end regardless of what it has already learned, because each rung only knows
    whether *it* has been settled.
    """
    if context.explains_a_step:
        return None

    for hypothesis in _STEP_LADDER:
        settled = {
            Hypothesis.NEW_APPLIANCE: context.no_new_appliance
            or context.new_appliance_since is not None,
            Hypothesis.MORE_OCCUPANTS: context.extra_occupants is not None,
            Hypothesis.HOT_WATER_CHANGE: context.hot_water_changed_since is not None,
        }[hypothesis]
        if not settled:
            return hypothesis
    return None


def _is_settled(hypothesis: Hypothesis, context: HouseholdContext) -> bool:
    """Has this household already told us about this one?"""
    return {
        Hypothesis.NEW_APPLIANCE: context.no_new_appliance
        or context.new_appliance_since is not None,
        Hypothesis.MORE_OCCUPANTS: context.extra_occupants is not None,
        Hypothesis.HOT_WATER_CHANGE: context.hot_water_changed_since is not None,
        Hypothesis.WORKING_FROM_HOME: context.works_from_home is not None,
        Hypothesis.ELECTRIC_HEATING: context.has_electric_heating is not None,
    }[hypothesis]


def select(
    gaps: list[DetectedGap],
    context: HouseholdContext,
    *,
    period: str,
    hardship_detected: bool = False,
    evidenced: Hypothesis | None = None,
) -> ClarifyingQuestion | None:
    """The one question worth asking, or None.

    None is the common case and the correct default. A household whose bill is fully
    explained has nothing to be asked, and an assistant that always finds something to ask
    is one people stop reading.

    `evidenced` names a hypothesis the *data* points at, and it jumps the ladder. The
    ladder is ordered by prior likelihood — what is usually true of a household we know
    nothing specific about — and that ordering should lose to a measurement. Today the
    only caller is the controlled-load signal: hot water sits last in `_STEP_LADDER`
    because people rarely know the answer, but when the separately-metered controlled
    circuit has visibly moved, it is the question the meter is pointing at. Still skipped
    if already settled, because evidence does not license asking twice.
    """
    if hardship_detected:
        return None

    if evidenced is not None and not _is_settled(evidenced, context):
        for gap in gaps:
            question = _question(
                hypothesis=evidenced,
                gap=gap,
                when=(
                    f"day {gap.step.day_index} of {period}"
                    if gap.step
                    else f"this {period.split()[0].lower()}"
                ),
            )
            if not context.has_answered(question.id):
                return question.with_period(period)

    for gap in gaps:
        hypothesis: Hypothesis | None = None

        if gap.gap is Gap.BASE_LOAD_STEP:
            hypothesis = _next_step_hypothesis(context)
        elif gap.gap is Gap.NO_WEATHER_FIT:
            if context.has_electric_heating is None:
                hypothesis = Hypothesis.ELECTRIC_HEATING
        elif gap.gap is Gap.WEEKDAY_SHIFT:
            if context.works_from_home is None:
                hypothesis = Hypothesis.WORKING_FROM_HOME
        elif gap.gap is Gap.UNEXPLAINED_REMAINDER:
            # No date to offer, so the appliance question would be the weak version of
            # itself. Occupancy and hot water are answerable without one.
            for candidate in (Hypothesis.MORE_OCCUPANTS, Hypothesis.HOT_WATER_CHANGE):
                settled = (
                    context.extra_occupants is not None
                    if candidate is Hypothesis.MORE_OCCUPANTS
                    else context.hot_water_changed_since is not None
                )
                if not settled:
                    hypothesis = candidate
                    break

        if hypothesis is None:
            continue

        when = (
            f"day {gap.step.day_index} of {period}"
            if gap.step
            else f"this {period.split()[0].lower()}"
        )
        question = _question(hypothesis=hypothesis, gap=gap, when=when)
        if context.has_answered(question.id):
            continue
        return question.with_period(period)

    return None


#: Handed to the narrator alongside the question. The wording is deliberate: a small model
#: given a question and no instruction will paraphrase it, and a paraphrased question about
#: somebody's home is a question we did not write.
def caveats_for(question: ClarifyingQuestion) -> list[str]:
    return [
        f'End your answer by asking this question, word for word, as its own sentence: '
        f'"{question.prompt}" Do not rephrase it, do not shorten it, and do not add a '
        f"second question of your own.",
        "Ask it as an offer, not as a requirement — make clear they do not have to answer "
        "and the figures above stand either way.",
    ]
