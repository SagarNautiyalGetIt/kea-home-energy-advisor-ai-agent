"""Turning an answer into arithmetic. Pure.

The payoff half of the feature. Asking is easy; the question only earns its place if the
answer changes what the customer is told, and it changes it **here**, in layer 1, not by
being pasted into a prompt.

    detect      residuals            ->  a dated step nobody can explain
    questions   the step             ->  "did something arrive around then?"
    apply       "yes, a heat pump"   ->  the step is now named, costed, and attributed
    narration   the new facts        ->  a sentence

The customer's words never reach the model. What reaches it is a `Fact` saying the step is
$27 a month and a caveat saying they confirmed an appliance arrived on the 12th — both
computed, both verifiable by layer 3, both traceable.
"""

from __future__ import annotations

import datetime as dt

from app.clarify.detect import StepChange
from app.clarify.schemas import (
    Answer,
    ClarifyingQuestion,
    HouseholdContext,
    Hypothesis,
    QuestionResponse,
)
from app.schemas import Fact

#: A month, for quoting a step as a recurring cost. Deliberately 30 rather than the actual
#: cycle length: the point of naming a step is that it *continues*, and "about $27 a month"
#: is the figure a customer can act on. The cycle-specific amount is already elsewhere in
#: the bundle.
DAYS_PER_MONTH = 30


def record(
    context: HouseholdContext,
    question: ClarifyingQuestion,
    response: QuestionResponse,
    *,
    asked_on: dt.date | None = None,
) -> HouseholdContext:
    """Fold one answer into what we know about this household.

    Records the question id **whatever the answer**, including "not sure". A question the
    customer could not answer is still a question they were asked, and re-asking it next
    cycle is how an assistant becomes something people mute.
    """
    updates: dict[str, object] = {
        "asked": [*context.asked, question.id]
        if question.id not in context.asked
        else context.asked,
    }

    if response.answer is Answer.YES:
        # `response.since` is optional because most people remember "a few weeks ago", not
        # a date. When it is missing we fall back to the day the detector found, which is
        # a better estimate than the day they were asked — the step is *why* we asked.
        since = response.since or asked_on

        if question.hypothesis is Hypothesis.NEW_APPLIANCE:
            updates["new_appliance_since"] = since
            updates["no_new_appliance"] = False
        elif question.hypothesis is Hypothesis.MORE_OCCUPANTS:
            # `or 1` rather than leaving it null: "yes" with no count still has to set the
            # field, because null means "never asked" and would put this question straight
            # back on the ladder next cycle.
            updates["extra_occupants"] = response.count or 1
            updates["extra_occupants_since"] = since
        elif question.hypothesis is Hypothesis.HOT_WATER_CHANGE:
            updates["hot_water_changed_since"] = since
        elif question.hypothesis is Hypothesis.WORKING_FROM_HOME:
            updates["works_from_home"] = True
        elif question.hypothesis is Hypothesis.ELECTRIC_HEATING:
            updates["has_electric_heating"] = True

    elif response.answer is Answer.NO:
        # A denial is a fact, not an absence of one — it is what promotes the next
        # hypothesis on the ladder. See questions._next_step_hypothesis.
        if question.hypothesis is Hypothesis.NEW_APPLIANCE:
            updates["no_new_appliance"] = True
        elif question.hypothesis is Hypothesis.MORE_OCCUPANTS:
            updates["extra_occupants"] = 0
        elif question.hypothesis is Hypothesis.WORKING_FROM_HOME:
            updates["works_from_home"] = False
        elif question.hypothesis is Hypothesis.ELECTRIC_HEATING:
            updates["has_electric_heating"] = False
        # HOT_WATER_CHANGE has no denial field: it is last on the ladder, so recording the
        # question id is enough to stop it being re-asked, and there is no next question
        # for a denial to promote.

    # UNSURE sets nothing beyond `asked`. It closes the question — asking again will not
    # produce a better result — without confirming anything.

    return context.model_copy(update={**updates, "updated_at": dt.datetime.now(dt.UTC)})


#: How a confirmed cause is described to the narrator. Phrased as what it *is*, not as
#: what the customer said, because the model must not start attributing figures to
#: reported speech — "you told us you bought a heat pump so it is probably $27" is a
#: different and much weaker claim than "the step costs $27 and started when the heat pump
#: arrived".
_CAUSE_WORDING: dict[str, str] = {
    "new_appliance": (
        "The customer has confirmed a new appliance arrived when this step began, so you "
        "MAY attribute the step to it. Do not guess which appliance it is unless they "
        "named it."
    ),
    "more_occupants": (
        "The customer has confirmed extra people in the house from when this step began, "
        "so you MAY attribute the step to that. Say it plainly and without judgement — "
        "more people using power is not a problem to be fixed."
    ),
    "hot_water": (
        "The customer has confirmed a hot-water change from when this step began, so you "
        "MAY attribute the step to it. Hot water is the largest load in most homes, so "
        "this is worth telling them plainly."
    ),
}


def explain_step(
    context: HouseholdContext,
    step: StepChange,
    *,
    unit_price_nzd: float,
    period: str,
) -> tuple[list[Fact], list[str]]:
    """Facts and caveats for a step the customer has now accounted for.

    Returns empty lists when nothing has been confirmed — an unconfirmed step stays in the
    unexplained bucket and the narrator is still forbidden from offering a cause for it.
    Returning a hedged explanation here would be exactly the fabrication the question was
    asked to avoid.
    """
    cause = None
    if context.new_appliance_since:
        cause = "new_appliance"
    elif context.extra_occupants:
        cause = "more_occupants"
    elif context.hot_water_changed_since:
        cause = "hot_water"

    if cause is None:
        return [], []

    facts = [
        Fact.money(
            "confirmed_step_monthly_nzd",
            step.monthly_cost_nzd(unit_price_nzd, DAYS_PER_MONTH),
            "What this change adds to a typical month",
        ),
        Fact.energy(
            "confirmed_step_kwh_per_day",
            step.step_kwh_per_day,
            "How much more the house uses each day since the change",
            per_day=True,
        ),
        Fact.day_of_period(
            "confirmed_step_day", step.day_index, f"The day it started in {period}"
        ),
    ]
    return facts, [_CAUSE_WORDING[cause]]


def unexplained_caveat(has_open_question: bool) -> str:
    """What the narrator must say about a step nobody has accounted for yet.

    Two wordings because they are two different situations. If a question is going out
    with this answer, the honest line is "we do not know yet, and here is what would tell
    us". If the customer has already been asked and said no to everything, the honest line
    is that we genuinely cannot say — and pretending otherwise after they have helped is
    worse than admitting it.
    """
    if has_open_question:
        return (
            "You do NOT know what caused this step. Do not offer a cause, not even a "
            "hedged one. State the figures, then ask the question you were given."
        )
    return (
        "You do NOT know what caused this step, and the customer has already been asked. "
        "Say plainly that Sparky can see the change and its cost but cannot tell what is "
        "behind it, and offer to put them through to someone who can look further. Do "
        "not speculate."
    )
