"""Hardship detection and the tier ladder.

The one part of this system where a false negative has a cost that is not measured in
customer satisfaction. Under Part 6 of the Consumer Care Obligations a retailer on notice
of payment difficulty has duties, and "our classifier did not fire" is not a defence.

So the tests below are weighted towards the misses rather than the hits: the phrasings
real people use, the ones an obvious implementation gets wrong, and the two rules that
must hold whatever the score says.
"""

from __future__ import annotations

import pytest
from fakes import ScriptedProvider

from app import hardship
from app.hardship.signals import Signal, Source
from app.pipeline import HANDOVER_TEXT, build_context


def tier_for(message: str, account=None) -> hardship.Tier:
    return hardship.decide(hardship.assess(message, account)).tier


# ---------- what must reach a person ----------


@pytest.mark.parametrize(
    "message",
    [
        "I honestly can't afford this bill",
        "I cannot pay this",
        "we're falling behind on the power bill",
        "I'm in arrears and it keeps growing",
        "I've had a final notice and they're threatening to cut me off",
        "they said they're going to disconnect us",
        "I haven't got the money for this",
    ],
)
def test_an_explicit_disclosure_reaches_a_person(message: str) -> None:
    assert tier_for(message) is hardship.Tier.HUMAN_ONLY


@pytest.mark.parametrize(
    "message",
    [
        "I just want to end my life",
        "I can't go on like this",
        "sometimes I think about killing myself",
    ],
)
def test_acute_distress_bypasses_the_score_entirely(message: str) -> None:
    """Crisis is checked before every threshold and is not a function of the score.

    Asserted separately from the disclosure cases because the *ordering* inside
    `decide()` is the property that matters — a refactor that moved the threshold check
    above the crisis check would still pass a test that only looked at the tier.
    """
    assessment = hardship.assess(message)
    assert assessment.crisis
    assert hardship.decide(assessment).tier is hardship.Tier.HUMAN_ONLY


@pytest.mark.parametrize(
    "message",
    [
        # The phrasing an earlier pattern missed: the particle is split by the object.
        "I'm too scared to turn the heater on",
        "we're afraid to put the heat pump on",
        "we've been sitting in the cold to save money",
        "it's heat or eat at this point",
        "I'm not using the heater at all now",
    ],
)
def test_going_without_is_detected_however_it_is_phrased(message: str) -> None:
    """Rationing is the signal people volunteer when they will not say "hardship".

    `too scared to (?:use|turn on)` matched none of these, because nobody says "too
    scared to turn on the heater" — they say "too scared to turn the heater on".
    """
    assert tier_for(message) >= hardship.Tier.MONITORED


# ---------- what must NOT ----------


@pytest.mark.parametrize(
    "message",
    [
        "I can't pay online, the card form is broken",
        "the website won't let me pay by card",
        "I couldn't pay last year but it's all sorted now",
        "I used to struggle with this but not any more",
    ],
)
def test_a_payment_page_fault_is_not_hardship(message: str) -> None:
    """The false positive that would poison the queue.

    "I can't pay online" contains "can't pay" and is a bug report. Escalating it wastes
    the customer's time and — worse — trains the hardship team to close these unread,
    which is how a real disclosure gets missed.
    """
    assert tier_for(message) is hardship.Tier.AUTONOMOUS


@pytest.mark.parametrize(
    "message",
    [
        "why is my power bill so high?",
        "was that just the cold snap?",
        "what will my bill be this month?",
        "am I on the right plan?",
        "this bill is wrong, I want it checked",
    ],
)
def test_ordinary_questions_stay_autonomous(message: str) -> None:
    """Including a billing dispute: annoyed is not the same as unable to pay, and
    routing every complaint to a person defeats the purpose of the assistant."""
    assert tier_for(message) is hardship.Tier.AUTONOMOUS


# ---------- the middle band ----------


def test_an_income_shock_is_watched_not_escalated() -> None:
    """Tier 2 exists for exactly this: real evidence, not yet a disclosure.

    Someone who just lost their job has not said they cannot pay. Sending them to a
    person is premature; ignoring them until the disconnection notice is negligent.
    """
    assert tier_for("I lost my job last month so things are tight") is hardship.Tier.MONITORED


def test_corroboration_promotes_to_a_person() -> None:
    """Language and account agreeing is stronger evidence than either alone.

    A moderate phrase can be a turn of speech and a moderate account signal can be
    somebody who is simply late. Together they are the commonest shape of a real case,
    and neither would clear the top threshold on its own.
    """
    assessment = hardship.assess("things have been tight since I lost my job")
    assessment.signals.append(
        Signal(
            key="balance_exceeds_a_cycle",
            source=Source.ACCOUNT,
            weight=0.6,
            detail="balance is more than one bill behind",
        )
    )
    assert assessment.corroborated
    assert hardship.decide(assessment).tier is hardship.Tier.HUMAN_ONLY


def test_the_care_register_is_never_left_unwatched() -> None:
    """A medically dependent customer is a category of person, not a state of a
    conversation. The duty exists before they say anything."""

    class OnRegister:
        is_medically_dependent = True
        is_vulnerable = False
        billing = None
        current_bill = None
        prior_bill = None
        days: list = []

    decision = hardship.decide(hardship.assess("what's my balance?", OnRegister()))
    assert decision.tier is hardship.Tier.MONITORED
    # Watched, but not paged — nothing has actually happened yet.
    assert decision.notify_agent is False


# ---------- the asymmetry ----------


def test_the_model_can_escalate_but_never_de_escalate() -> None:
    """The safety property the whole design rests on.

    The model sees paraphrases the phrase bank misses, so it must be able to raise the
    tier. It must never be able to lower one, or it will eventually argue its way down
    from tier 3 on the conversation where that matters.
    """
    quiet = hardship.assess("what time of day do I use most power?")
    assert hardship.decide(quiet).tier is hardship.Tier.AUTONOMOUS
    assert (
        hardship.decide(quiet, model_requested_handoff=True).tier is hardship.Tier.HUMAN_ONLY
    )

    loud = hardship.assess("I can't afford this bill")
    # Not calling the tool does NOT bring a disclosure back down.
    assert hardship.decide(loud, model_requested_handoff=False).tier is hardship.Tier.HUMAN_ONLY


def test_guidance_is_attached_for_every_tier() -> None:
    """The model is told its own position so its tone matches what is happening.

    An assistant reassuring somebody that their bill is normal while a hardship agent is
    being paged reads as not listening.
    """
    for message, expected in [
        ("why is my bill high?", "answer normally"),
        ("I lost my job last month", "watching this conversation"),
        ("I can't afford this", "a person is taking this conversation"),
    ]:
        decision = hardship.decide(hardship.assess(message))
        assert expected in decision.guidance, (message, decision.tier)


# ---------- the pipeline ----------


async def test_a_tier_three_turn_spends_no_model_call(monkeypatch) -> None:
    """Two reasons, and the second is the important one.

    It is cheap — but more than that, the handover must work when the provider is down.
    A customer disclosing hardship during an outage still needs a person, and an
    implementation that asked the model to write the handover would fail exactly then.
    """
    provider = ScriptedProvider()
    monkeypatch.setattr("app.pipeline.get_provider", lambda: provider)

    from app.pipeline import answer

    result = await answer("H-JUL", "I can't afford this bill any more")

    assert result.tier == 3
    assert result.escalate is True
    assert result.text == HANDOVER_TEXT
    assert provider.calls == [], "the model must not be called on a tier-3 turn"
    assert result.hardship_evidence, "the agent picking this up needs the reason"


async def test_an_ordinary_question_still_reaches_the_model(monkeypatch) -> None:
    provider = ScriptedProvider()
    monkeypatch.setattr("app.pipeline.get_provider", lambda: provider)

    from app.pipeline import answer

    result = await answer("H-JUL", "why is my power bill so high?")

    assert result.tier == 1
    assert result.escalate is False
    assert provider.calls, "a tier-1 turn is answered by the model"


async def test_the_tier_reaches_the_stream(monkeypatch) -> None:
    """Both transports carry it, so the UI can show the handover on the message that
    caused it rather than one turn later."""
    provider = ScriptedProvider()
    monkeypatch.setattr("app.pipeline.get_provider", lambda: provider)

    from app.pipeline import answer_stream

    frames = [
        (name, payload)
        async for name, payload in answer_stream("H-JUL", "I can't pay this bill")
    ]
    names = [n for n, _ in frames]
    done = dict(frames)["done"]

    assert names == ["token", "done"], names
    assert done["tier"] == 3
    assert done["escalate_to_human"] is True
    assert provider.calls == []


async def test_guidance_reaches_the_model_on_a_monitored_turn(monkeypatch) -> None:
    """Tier 2 answers normally, so the only way the model knows to change register is
    the handling note appended to its system prompt."""
    provider = ScriptedProvider(rounds=[])
    monkeypatch.setattr("app.pipeline.get_provider", lambda: provider)

    from app.pipeline import answer

    result = await answer("H-JUL", "I lost my job last month, why is my bill so high?")

    assert result.tier == 2
    system = provider.calls[0]["system"]
    assert "a Kea agent is watching" in system
    assert "do not tell them their bill is fine" in system.lower()


async def test_context_free_assessment_needs_no_account() -> None:
    """`assess` takes the account optionally, because voice assesses the transcript
    before the repository read on some paths and a missing account must read as "no
    account signal" rather than raising."""
    assert hardship.assess("I can't afford this", None).score > 0
    ctx = await build_context("H-JUL")
    assert hardship.assess("I can't afford this", ctx.account).score > 0
