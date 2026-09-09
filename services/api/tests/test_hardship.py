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


def test_an_account_signal_alone_watches_but_does_not_page() -> None:
    """The product is bill-shock prevention, so a bill that jumped is its NORMAL case.

    Tama trips `bill_shock` on a plain "why is my bill so high?" with no distress in the
    message at all. Escalating the tier is right — an agent should be able to see it — but
    paging on it would page on a large share of the cohort every cycle, and a queue that
    full is one nobody reads. That is how the real disclosure underneath gets missed.
    """
    from app.hardship.signals import HardshipAssessment

    account_only = HardshipAssessment(
        signals=[
            Signal(
                key="bill_shock",
                source=Source.ACCOUNT,
                weight=0.45,
                detail="this bill is far larger than the last one",
            )
        ]
    )
    decision = hardship.decide(account_only)
    assert decision.tier is hardship.Tier.MONITORED
    assert decision.notify_agent is False, "account data alone must not page a person"

    # The same score WITH something the customer said does page.
    spoken = hardship.assess("I lost my job last month")
    assert hardship.decide(spoken).notify_agent is True


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


# ---------- the wider circumstances ----------


@pytest.mark.parametrize(
    "message",
    [
        "we've been served notice and have to move out next month",
        "we're in emergency housing at the moment",
        "I've been topping up the meter forty dollars at a time",
        "we ran out of credit on Tuesday night",
        "my husband passed away in June",
        "I've got hospital bills on top of this",
        "the house is damp and there's mould on the bedroom ceiling",
    ],
)
def test_hardship_is_more_than_the_word_money(message: str) -> None:
    """The circumstances that cause a power bill to go unpaid are rarely about power.

    Every one of these is something a person volunteers readily and none of them contains
    "can't afford". A detector that only reads the money vocabulary hears nothing until
    the arrears have already built up, which is a cycle too late for the product to be
    worth anything.
    """
    assert tier_for(message) >= hardship.Tier.MONITORED


@pytest.mark.parametrize(
    "message",
    [
        "was that just the cold snap?",
        "it was really cold last week, is that why?",
        "I turned the heat pump on more in July",
    ],
)
def test_the_weather_is_not_a_cold_home(message: str) -> None:
    """`_COLD_HOME` must not match the commonest question this assistant answers.

    "Was that just the cold snap?" is the modal message on this product. A pattern
    containing a bare `cold` would escalate it, every time, for the whole cohort.
    """
    assert tier_for(message) is hardship.Tier.AUTONOMOUS


def test_caregiving_alone_is_context_not_a_case() -> None:
    """0.3 is below `MONITORED_THRESHOLD` on purpose — a newborn is not a disclosure.

    It earns its place by corroborating: the score formula lets a weak signal push a
    moderate one over the line, and "there's a newborn and I lost my hours" is a
    different case from either half.
    """
    alone = hardship.assess("we've got a newborn at home, why is the bill up?")
    assert hardship.decide(alone).tier is hardship.Tier.AUTONOMOUS

    combined = hardship.assess("we've got a newborn at home and my hours were cut")
    assert hardship.decide(combined).tier >= hardship.Tier.MONITORED


def test_a_disclosed_medical_dependency_is_notice_even_with_no_flag() -> None:
    """Registration is a form somebody has to fill in, so the flag being absent is not
    evidence of anything. The duty attaches to being told."""
    assessment = hardship.assess("I'm on an oxygen concentrator overnight")
    assert assessment.disclosed_medical_dependence
    assert not assessment.on_care_register

    decision = hardship.decide(assessment)
    assert decision.tier is hardship.Tier.MONITORED
    # Unlike the register branch, this one pages: it is new information nobody holds.
    assert decision.notify_agent is True
    assert "registered" in decision.reason


def test_under_heating_needs_the_weather_to_mean_anything() -> None:
    """Using less than the cohort is unremarkable — half of every cohort does.

    It becomes evidence only when the period was cold enough that heating should be
    visible in the meter and is not. Asserted by holding the usage fixed and moving only
    the temperature.
    """
    import datetime as dt

    from app.analytics.account import DayUsage
    from app.hardship.signals import _account_signals

    def account(hdd: float):
        class A:
            billing = None
            current_bill = None
            prior_bill = None
            peer_baseline_kwh_per_day = 20.0
            heating_sensitivity_kwh_per_hdd = 0.9
            days = [
                DayUsage(
                    date=dt.date(2026, 7, 1) + dt.timedelta(days=i),
                    import_kwh=8.0,
                    heating_degree_days=hdd,
                )
                for i in range(21)
            ]

        return A()

    cold = {s.key for s in _account_signals(account(hdd=9.0))}
    mild = {s.key for s in _account_signals(account(hdd=2.0))}

    assert "cold_weather_under_use" in cold
    assert "cold_weather_under_use" not in mild, "under-use in mild weather says nothing"


# ---------- tone, and the wall between it and the ladder ----------


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("this is the THIRD TIME I've asked and nobody has fixed it", "frustration"),
        ("I'm really worried about what next month is going to look like", "anxiety"),
        ("I don't understand what any of this means", "confusion"),
        ("that can't be right, where did that number come from?", "distrust"),
        ("sorry to ask what's probably a silly question", "shame"),
        ("there's no point, nothing ever changes", "resignation"),
        ("I need to know today, it's due tomorrow", "urgency"),
        ("brilliant, thanks — that makes sense now", "gratitude"),
    ],
)
def test_the_register_is_read_from_the_message(message: str, expected: str) -> None:
    read = hardship.read_emotion(message)
    assert read.primary is not None
    assert read.primary.value == expected


def test_tone_never_moves_a_tier() -> None:
    """The firewall the emotions module exists behind.

    The calmest sentence in the phrase bank is the most serious one, and the angriest
    thing we read all day is usually a broken payment page. If tone fed the ladder, both
    would be graded backwards. Asserted structurally as well as behaviourally: `tiers` does
    not import `emotions`, so there is no path for it to leak through later.
    """
    import inspect

    from app.hardship import tiers

    assert "emotions" not in inspect.getsource(tiers)

    # Furious, and not a hardship case.
    assert tier_for("this website is USELESS!! third time I've tried to pay!!!") is (
        hardship.Tier.AUTONOMOUS
    )
    # Flat, polite, and the most serious message in the suite.
    assert tier_for("I won't be able to pay this one.") is hardship.Tier.HUMAN_ONLY


def test_emphasis_raises_intensity_without_adding_an_emotion() -> None:
    from app.hardship.emotions import Intensity

    calm = hardship.read_emotion("I'm a bit worried about the bill")
    loud = hardship.read_emotion("I am WORRIED SICK ABOUT THIS BILL!!!")

    assert calm.primary is loud.primary
    assert calm.intensity is Intensity.MILD
    assert loud.intensity is Intensity.STRONG
    assert "written in capitals" in loud.reasons()


def test_no_guidance_is_customer_facing_prose() -> None:
    """Every tone note must be an instruction about HOW to write, never a sentence to say.

    This is the test that keeps the feature from becoming eight canned openings — which
    would reproduce, in a new place, the exact defect this rewrite removed: every angry
    customer getting the same answer.
    """
    from app.hardship.emotions import _TONE, Emotion

    for emotion in Emotion:
        note = _TONE[emotion]
        assert note.startswith("this customer"), emotion
        # Second person is how you talk TO a customer. These talk ABOUT one.
        assert " you are " not in f" {note} ", emotion
        assert "I " not in note, emotion


def test_the_tone_note_reaches_the_model_without_displacing_the_policy(
    monkeypatch,
) -> None:
    """Both blocks arrive, and HANDLING is last so it wins any disagreement."""
    from app.pipeline import _handling

    tiering = hardship.decide(hardship.assess("I lost my job last month"))
    emotion = hardship.read_emotion("this is RIDICULOUS, nobody has helped me!!")
    handling = _handling(tiering, emotion)

    assert handling.startswith("TONE:")
    assert "HANDLING:" in handling
    assert handling.index("TONE:") < handling.index("HANDLING:")


def test_a_quiet_message_spends_no_prompt_on_tone() -> None:
    """None, not "answer normally". An empty read is the common case, and priming the
    model to think about register on a message that never raised it costs tokens and
    invites a tone the customer did not ask for."""
    assert hardship.read_emotion("what time of day do I use most power?").guidance is None
