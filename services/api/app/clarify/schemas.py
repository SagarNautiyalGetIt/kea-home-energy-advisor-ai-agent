"""The question, the answer, and what an answer is allowed to become.

## Answers are typed, and that is the whole safety story

The obvious way to build this feature is to ask a question, take free text back, and paste
it into the next prompt. That would undo the architecture in one move: the narrator would
be reading customer prose and reasoning from it, which is exactly the raw-input path the
`FactBundle` exists to close. A customer who writes *"yeah we got a heat pump, it's using
heaps, probably 400 kWh"* would have put a number in the model's context that no layer of
this system computed.

So an answer is a closed set — yes, no, not sure — plus at most a date and a count, both
validated. It becomes a `HouseholdContext` field, and that field changes what **layer 1**
computes. The model never sees the answer; it sees the re-attributed facts.

## Confirmed, denied and unknown are three different states

A customer who says "no, nothing new" has told us something valuable: the base-load step
is *not* an appliance, so the next question should be about occupancy. Storing that as
"unanswered" would ask them the same thing next month. `Answer.NO` is a fact about the
household, not an absence of one.
"""

from __future__ import annotations

import datetime as dt
from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class Gap(StrEnum):
    """What we could not work out. One per question the catalogue can ask."""

    BASE_LOAD_STEP = "base_load_step"
    """Everyday load stepped up on a specific day and stayed there. The strongest signal
    here, because it comes with a date."""

    UNEXPLAINED_REMAINDER = "unexplained_remainder"
    """The weather fit worked, but a large share of the overshoot is left over after
    weather and busier days are accounted for."""

    NO_WEATHER_FIT = "no_weather_fit"
    """The regression could not be used at all, so there is no cause breakdown to offer.
    Nothing can be attributed and the customer is owed an honest question rather than a
    hedged guess."""

    WEEKDAY_SHIFT = "weekday_shift"
    NIGHT_LOAD_PATTERN = "night_load_pattern"
    """Weekday usage rose relative to weekends — somebody is home during the day who was
    not before. Only detectable when the cycle start date is known."""


class Answer(StrEnum):
    YES = "yes"
    NO = "no"
    UNSURE = "unsure"
    """Distinct from no answer at all. "I don't know" closes the question — asking again
    will not produce a better result — but it confirms nothing."""


class Hypothesis(StrEnum):
    """What a question is testing. One per thing a household can tell us that changes the
    arithmetic."""

    NEW_APPLIANCE = "new_appliance"
    """Something arrived that draws power continuously. Explains a dated step in the
    everyday floor."""

    MORE_OCCUPANTS = "more_occupants"
    """Guests, a returning student, a new flatmate. Explains a step that is *not* an
    appliance, and usually ends."""

    WORKING_FROM_HOME = "working_from_home"
    """Somebody is home on weekdays who was not. Explains a weekday-only rise."""

    ELECTRIC_HEATING = "electric_heating"
    """Asked when the weather regression failed: a house with no electric heating has no
    temperature response to fit, and knowing that stops us looking for one every cycle."""

    HOT_WATER_CHANGE = "hot_water_change"
    EV_CHARGING = "ev_charging"
    """A cylinder thermostat turned up, or a fault. The classic invisible step — it is the
    largest load in most NZ homes and nobody looks at it."""


class ClarifyingQuestion(BaseModel):
    """One question, and the arithmetic that justifies asking it."""

    id: str = Field(description="Stable. Used to record that it was asked and answered.")
    gap: Gap
    hypothesis: Hypothesis

    prompt: str = Field(
        description=(
            "The question as the customer reads it. Composed by Python, not the model — "
            "a model that writes its own questions is a model choosing what to ask about "
            "somebody's home."
        )
    )

    #: The dollar amount confirming this would re-attribute. Shown to the customer,
    #: because "this would explain about $27 a month" is the difference between a
    #: reasonable question and an interrogation.
    explains_nzd: float

    #: The day the change appears to start, when the gap carries one. A question with a
    #: date is answerable; "has anything changed lately" is not.
    since_day: int | None = None

    def with_period(self, period: str) -> ClarifyingQuestion:
        """Fill the period into the prompt. Split from construction so the catalogue can
        stay a set of constants."""
        return self.model_copy(update={"prompt": self.prompt.replace("{period}", period)})


class QuestionResponse(BaseModel):
    """What the customer sent back."""

    question_id: str
    answer: Answer

    since: dt.date | None = Field(
        default=None,
        description=(
            "When it started, if they know. Optional and often absent — most people "
            "remember 'a few weeks ago', not a date, and a required field here would "
            "make them invent one."
        ),
    )
    count: int | None = Field(
        default=None,
        ge=0,
        le=20,
        description="Extra people, for MORE_OCCUPANTS. Bounded because a typo should not "
        "become a household of 4,000.",
    )

    @model_validator(mode="after")
    def _detail_requires_yes(self) -> QuestionResponse:
        """A date or a count attached to "no" is a client bug, and a silent one — it would
        write a confirmed change into the household's context off a denial."""
        if self.answer is not Answer.YES and (self.since or self.count is not None):
            raise ValueError("since and count may only accompany a 'yes' answer")
        return self


class HouseholdContext(BaseModel):
    """What the customer has told us about their home, as typed facts.

    Fed back into layer 1, never into the prompt. A confirmed new appliance since a date
    lets the attribution *name* the step it already found rather than leaving it in the
    unexplained bucket — and that is the entire payoff of asking.

    Every field is nullable and null means "never asked", which is deliberately different
    from `False` meaning "asked and denied". See the module docstring.
    """

    account_ref: str

    new_appliance_since: dt.date | None = None
    no_new_appliance: bool = False
    """True when they were asked and said no. Stops us asking again, and shifts the next
    question to occupancy."""

    extra_occupants: int | None = None
    extra_occupants_since: dt.date | None = None

    works_from_home: bool | None = None
    has_electric_heating: bool | None = None
    hot_water_changed_since: dt.date | None = None
    has_ev: bool | None = None

    #: Question ids already put to this household. A question asked and ignored is still
    #: asked — re-asking it next cycle is how an assistant becomes something people mute.
    asked: list[str] = Field(default_factory=list)

    updated_at: dt.datetime | None = None

    def has_answered(self, question_id: str) -> bool:
        return question_id in self.asked

    @property
    def explains_a_step(self) -> bool:
        """Whether anything they have told us would account for a step in everyday load."""
        return bool(
            self.new_appliance_since
            or self.extra_occupants
            or self.hot_water_changed_since
        )
