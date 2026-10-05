"""The clarifying question in a conversation — issue #142 point 4.

`app/clarify/` was complete and reached nothing: `pipeline.py` imported none of it, so
the assistant could not ask a question and could not receive an answer to one. These
tests cover the seam that closed that, and they are weighted towards the property the
whole design rests on rather than the happy path.

**The question is delivered verbatim.** That is what makes multi-turn testable at all:
Sparky asks, so Sparky bounds the reply space — we never have to guess what a customer
might type next, only handle answers to a question we wrote. A model paraphrasing loses
that on the first turn, so the text is appended after the model rather than composed by
it, and the test below compares against `ClarifyingQuestion.prompt` character for
character.
"""

from __future__ import annotations

import datetime as dt

import pytest
from fakes import ScriptedProvider

from app.agent.tools import dispatch
from app.clarify import conversation as clarify_conversation
from app.clarify.schemas import (
    Answer,
    ClarifyingQuestion,
    Gap,
    HouseholdContext,
    Hypothesis,
    QuestionResponse,
)
from app.pipeline import answer, build_context

QUESTION = ClarifyingQuestion(
    id="new_appliance:step",
    gap=Gap.BASE_LOAD_STEP,
    hypothesis=Hypothesis.NEW_APPLIANCE,
    prompt=(
        "Did anything new that runs all the time arrive around day 12? "
        "That would explain about $27."
    ),
    explains_nzd=27.0,
    since_day=12,
)


@pytest.fixture
def ctx_with_question(monkeypatch):
    """A context carrying an open question, without needing a mart account.

    The fixture households have no bill comparison, so `question_for` correctly returns
    None for them — a first bill is a complete explanation, not a gap. Injecting the
    question directly keeps these tests about the *conversation* seam rather than about
    the detector, which `test_clarify_from_drivers.py` already owns.
    """

    async def _make():
        ctx = await build_context("H-JUL")
        ctx.open_question = QUESTION
        return ctx

    return _make


# ---------- the question is Python's, word for word ----------


async def test_the_question_is_appended_verbatim(monkeypatch, ctx_with_question) -> None:
    """Not paraphrased, not summarised, not merged into the model's prose."""
    provider = ScriptedProvider(
        rounds=[], answer="Your bill rose because of a steady overnight load."
    )
    monkeypatch.setattr("app.pipeline.get_provider", lambda: provider)

    ctx = await ctx_with_question()
    monkeypatch.setattr("app.pipeline.build_context", lambda _cid: _async(ctx))

    result = await answer("H-JUL", "why is my bill so high?")

    assert result.text.endswith(QUESTION.prompt), (
        "the question must arrive exactly as Python wrote it — a paraphrase unbounds the "
        f"reply space. got: {result.text!r}"
    )
    assert QUESTION.prompt in result.text
    # And it is separated from the answer rather than run on to the end of a sentence.
    assert f"\n\n{QUESTION.prompt}" in result.text


async def test_the_model_is_told_not_to_ask_its_own(monkeypatch, ctx_with_question) -> None:
    from app.agent.prompts import SYSTEM

    assert "Do not invent a second household-cause question" in SYSTEM
    assert "You may ask one necessary clarification" in SYSTEM
    assert "Python chooses those from unexplained" in SYSTEM
    assert "appends one after you" in SYSTEM


async def test_no_question_is_appended_when_there_is_none(monkeypatch) -> None:
    """The common and correct case. A bill whose drivers account for it has nothing to
    ask about, and an assistant that always finds something to ask is doing an intake
    form."""
    provider = ScriptedProvider(rounds=[], answer="Your July total was 300 kWh.")
    monkeypatch.setattr("app.pipeline.get_provider", lambda: provider)

    result = await answer("H-JUL", "how much did I use?")

    assert result.text == "Your July total was 300 kWh."
    assert "?" not in result.text.split(".")[-1]


# ---------- the reply is understood as an answer ----------


async def test_a_reply_is_recorded_against_the_open_question(ctx_with_question) -> None:
    ctx = await ctx_with_question()

    result = await dispatch(
        ctx, "answer_clarifying_question", {"answer": "yes", "since": "2024-06-14"}
    )

    assert result["recorded"] is True
    assert ctx.answered_question is not None
    question, response = ctx.answered_question
    assert question.id == QUESTION.id
    assert response.answer is Answer.YES
    assert response.since == dt.date(2024, 6, 14)


async def test_answering_with_no_open_question_is_declined(ctx_with_question) -> None:
    """A model that mistakes a new question for a reply must not write a fact about
    somebody's home against a question nobody asked."""
    ctx = await ctx_with_question()
    ctx.open_question = None

    result = await dispatch(ctx, "answer_clarifying_question", {"answer": "yes"})

    assert result["available"] is False
    assert "no open question" in result["reason"]
    assert ctx.answered_question is None


async def test_a_date_on_a_denial_is_refused(ctx_with_question) -> None:
    """`QuestionResponse` rejects it, and the tool surfaces that rather than dropping the
    date silently — a date attached to "no" would write a confirmed change off a denial."""
    ctx = await ctx_with_question()

    result = await dispatch(
        ctx, "answer_clarifying_question", {"answer": "no", "since": "2024-06-14"}
    )

    assert "error" in result
    assert ctx.answered_question is None


async def test_an_unparseable_date_still_records_the_yes(ctx_with_question) -> None:
    """A yes with a date we cannot read is still a yes. Refusing the whole answer would
    lose the part that matters."""
    ctx = await ctx_with_question()

    result = await dispatch(
        ctx, "answer_clarifying_question", {"answer": "yes", "since": "a few weeks ago"}
    )

    assert result["recorded"] is True
    _, response = ctx.answered_question
    assert response.answer is Answer.YES
    assert response.since is None


async def test_an_invalid_answer_is_corrected_not_guessed(ctx_with_question) -> None:
    ctx = await ctx_with_question()
    result = await dispatch(ctx, "answer_clarifying_question", {"answer": "maybe-ish"})

    assert "error" in result
    assert "yes, no, unsure" in result["hint"]
    assert ctx.answered_question is None


# ---------- recording settles it ----------


def test_recording_an_answer_settles_the_question() -> None:
    """The next turn must not ask the same thing again. `apply.record` adds the id to
    `asked` whatever the answer — including "not sure", because a question they could not
    answer is still one they were asked."""
    household = HouseholdContext(account_ref="H-JUL")
    assert not household.has_answered(QUESTION.id)

    for reply in (Answer.YES, Answer.NO, Answer.UNSURE):
        updated = clarify_conversation.record_answer(
            HouseholdContext(account_ref="H-JUL"),
            QUESTION,
            QuestionResponse(question_id=QUESTION.id, answer=reply),
        )
        assert updated.has_answered(QUESTION.id), f"{reply} left the question open"


# ---------- the rule that outranks the ladder ----------


async def test_no_question_is_asked_during_hardship(monkeypatch) -> None:
    """The rule `app/clarify/` already applies on the alert path, now applied here.

    A household that has told us they are struggling gets a person, not a questionnaire.
    Asserted through the pipeline rather than through `select()` because the tier check
    is what enforces it on this path.
    """
    provider = ScriptedProvider(rounds=[], answer="Here is what your bill shows.")
    monkeypatch.setattr("app.pipeline.get_provider", lambda: provider)

    result = await answer("H-JUL", "I lost my job last month, why is my bill so high?")

    assert result.tier == 2, "an income shock is a monitored turn"
    assert QUESTION.prompt not in result.text
    assert not result.text.rstrip().endswith("?")


def _async(value):
    """Wrap a value in an awaitable, for monkeypatching an async function."""

    async def _inner(*_args, **_kwargs):
        return value

    return _inner()
