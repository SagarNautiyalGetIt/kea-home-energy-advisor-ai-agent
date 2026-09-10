"""How the customer sounds, and what that changes about the reply.

This is the sentiment layer `signals.py` deliberately is not — and the two must never be
confused, so the boundary is worth stating before any code:

    signals.py    Is this household in difficulty?     ->  decides WHO handles it
    emotions.py   How does this person sound?          ->  decides HOW it is written

**An emotional read never moves a tier.** Not up, not down. `read()` returns no score the
ladder consults and `decide()` never imports this module. That firewall is the whole
reason this file is safe to have:

* A flat, polite "I'll have to sell the car to pay this" is the calmest sentence in the
  whole phrase bank and the most serious. If tone fed the ladder it would be scored down.
* A furious paragraph about the website being broken is the angriest thing we will read
  all day and needs no hardship agent at all. If tone fed the ladder it would page one.

Both of those are in `signals.py`'s docstring as the reason it is not sentiment analysis.
Adding sentiment does not make that argument wrong; it makes it load-bearing. So this
module exists alongside the ladder rather than inside it.

## What it is for, then

Tone. The complaint that every answer read the same was never only about depth — it was
also that the same flat register was used on somebody frightened of a disconnection
notice and somebody idly curious about their hot water. A person who works in a contact
centre does not do that, and the difference is most of what customers mean by "they
actually listened".

So each emotion maps to an instruction about *how to write*: what to lead with, what to
leave out, how long to be, whether to show working. Never to what to say. Nothing in this
file contains a sentence intended to reach a customer, and that is checked —
`test_hardship.py::test_no_guidance_is_customer_facing_prose`. The moment a guidance
string becomes a reply, every answer to an angry customer is the same answer again, which
is the defect this whole rewrite was about.

## Why regexes again

Same argument as `signals.py` and one more. Asking the model to read the customer's mood
and then adjust its own tone is asking it to grade its own work in the same pass, and it
is a poor judge of its own register — it reliably reports "the customer seems calm" while
writing to somebody who typed in capitals. Python reading the message and handing down an
instruction is inspectable, testable with fixed strings, and cannot be talked out of its
answer by the message it is reading.

The cost is real: paraphrase gets missed. That is acceptable here in a way it is not in
`signals.py`, because a missed emotion costs a flatter answer, not a missed disclosure.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum


class Emotion(StrEnum):
    """The states worth writing differently for.

    Eight, not a wheel of forty. Each one earns its place by changing the *shape* of a
    good answer, not by being a distinguishable feeling: 'disappointed' and 'frustrated'
    want the same reply, so there is one entry, and splitting them would buy nothing but
    a harder test suite.
    """

    FRUSTRATION = "frustration"
    """Angry, fed up, repeating themselves. Wants the answer first and the apology never."""

    ANXIETY = "anxiety"
    """Worried about what is coming. Wants the number, the range, and what happens next."""

    CONFUSION = "confusion"
    """Lost in the bill or the jargon. Wants one thing explained properly, not five."""

    DISTRUST = "distrust"
    """Thinks the figure, the meter, or the assistant is wrong. Wants the working shown.

    The most important entry here. 61.9% of surveyed customers named "it might give me
    wrong or made-up information" as their single largest concern, so this is not an edge
    case — it is the modal objection, and the product's answer to it is provenance."""

    SHAME = "shame"
    """Apologising for asking, or for their own usage. Wants the apology not to be needed."""

    RESIGNATION = "resignation"
    """Stopped expecting it to change. Wants one concrete thing that is actually theirs."""

    URGENCY = "urgency"
    """Needs it now — a due date, a notice, a Friday. Wants the answer in the first line."""

    GRATITUDE = "gratitude"
    """Pleased. Wants the reply to be short and to not restart the conversation."""


@dataclass(frozen=True)
class EmotionCue:
    emotion: Emotion
    evidence: str
    """The phrase that actually matched. Goes to the agent picking the conversation up,
    for the same reason `Signal.evidence` does — 'frustration: 0.8' is not a handover."""


# ---------------------------------------------------------------------------
# Phrase banks
# ---------------------------------------------------------------------------
#
# Ordered by how much they change the reply, not by how strong the feeling is. Where a
# phrase could belong to two, it goes to the one whose instruction is safer to follow on
# the wrong message — DISTRUST over FRUSTRATION, because showing your working to somebody
# who was merely annoyed costs a sentence, and being brisk with somebody who thinks you
# are lying costs the conversation.

_FRUSTRATION = (
    r"ridiculous", r"absurd", r"outrageous", r"insane\b", r"joke\b",
    r"fed up", r"sick of", r"sick and tired", r"had enough",
    r"useless", r"hopeless", r"rip[- ]?off", r"ripping me off", r"daylight robbery",
    r"third time", r"fourth time", r"again and again", r"every single (?:month|time)",
    r"nobody (?:has|ever|will|can)", r"no ?one (?:has|ever|will|can)",
    r"still (?:waiting|no|haven'?t)", r"keeps? happening",
    r"why (?:is it|does it|do i) (?:always|keep)",
    r"waste of (?:time|money)", r"appalling", r"disgrace",
)

_ANXIETY = (
    r"worried", r"worry\b", r"anxious", r"anxiety", r"stressed", r"stressing",
    r"stress(?:ing)? (?:me )?out", r"panic", r"panicking", r"dreading", r"dread\b",
    r"scared (?:about|of|that)", r"frightened (?:about|of|that)",
    r"terrified", r"keeps? me (?:up|awake)", r"losing sleep", r"can'?t sleep",
    r"what (?:if|happens if)", r"how (?:bad|much worse)",
    r"is it going to (?:keep|get)", r"afraid (?:it|this|the)",
)

_CONFUSION = (
    r"don'?t (?:understand|get it|follow)", r"do not understand",
    r"not sure (?:what|why|how)", r"no idea (?:what|why|how)",
    r"confus(?:ed|ing)", r"makes no sense", r"doesn'?t make sense",
    r"what (?:does|do|is) .{0,40}\bmean\b", r"what'?s the difference",
    r"can you explain", r"explain (?:this|that|it) (?:to me|again|simply)",
    r"in plain english", r"in simple terms", r"lost me\b",
    r"never understood", r"too technical", r"gibberish",
)

_DISTRUST = (
    r"(?:that|this|it) can'?t be right", r"doesn'?t (?:look|seem|sound) right",
    r"(?:are|is) (?:you|that|this) (?:sure|correct|accurate)",
    r"double[- ]?check", r"prove it", r"how do (?:you|i) know",
    r"where did (?:that|this|the) (?:number|figure) come from",
    r"made[- ]?up", r"making (?:it|that|this) up", r"you'?re wrong", r"that'?s wrong",
    r"overcharg", r"charged (?:me )?twice", r"double charg",
    r"meter (?:is|must be) (?:wrong|broken|faulty)", r"faulty meter",
    r"don'?t (?:believe|trust)", r"do not trust", r"trust (?:you|this|an ai)",
    r"(?:just )?(?:a |an )?(?:bot|robot|ai|chatbot|machine)\b",
    r"real (?:person|human)", r"talking to a (?:computer|machine)",
    r"dispute", r"query (?:this|the) (?:bill|charge)",
)

_SHAME = (
    r"sorry to (?:ask|bother|trouble)", r"sorry for (?:asking|bothering)",
    r"(?:this|that) (?:is|might be|may be|sounds) (?:a )?(?:silly|stupid|dumb|daft)",
    r"probably (?:a )?(?:silly|stupid|obvious)", r"feel (?:silly|stupid|embarrassed)",
    r"embarrass", r"ashamed", r"my own fault", r"i know it'?s my fault",
    r"i should (?:have|'?ve) ", r"i shouldn'?t have", r"i'?m (?:probably )?being (?:silly|stupid)",
    r"don'?t (?:want to|like to) (?:ask|bother)", r"hate (?:having )?to ask",
)

_RESIGNATION = (
    r"no point", r"what'?s the point", r"nothing (?:i|we) can do",
    r"nothing (?:changes|ever changes)", r"never changes", r"same every (?:month|time)",
    r"just (?:accept|live with)", r"given up", r"give up on",
    r"whatever\b", r"doesn'?t matter (?:any ?more|now)",
    r"suppose (?:i|we)'?ll (?:just )?have to", r"stuck with it",
    r"beyond (?:my|our) control",
)

_URGENCY = (
    r"urgent", r"asap", r"right (?:now|away)", r"straight away", r"immediately",
    r"today\b", r"tonight\b", r"tomorrow\b", r"by (?:friday|monday|the weekend)",
    r"due (?:today|tomorrow|this week)", r"before (?:they|it|the) ",
    r"running out of time", r"last (?:day|chance)", r"deadline",
    r"final notice",  # also a disconnection signal; here it sets pace, there it sets tier
    r"quick(?:ly)?\b", r"in a (?:rush|hurry)",
)

_GRATITUDE = (
    r"thank(?:s| you)", r"cheers\b", r"appreciate (?:it|that|this)",
    r"that (?:helps|helped|makes sense|clears)", r"brilliant", r"perfect\b",
    r"great,? thanks", r"much better", r"good to know", r"awesome",
)

_BANKS: tuple[tuple[Emotion, tuple[str, ...]], ...] = (
    # Order is the tie-break for `primary` when intensity is equal — see `read`.
    (Emotion.DISTRUST, _DISTRUST),
    (Emotion.ANXIETY, _ANXIETY),
    (Emotion.FRUSTRATION, _FRUSTRATION),
    (Emotion.RESIGNATION, _RESIGNATION),
    (Emotion.SHAME, _SHAME),
    (Emotion.CONFUSION, _CONFUSION),
    (Emotion.URGENCY, _URGENCY),
    (Emotion.GRATITUDE, _GRATITUDE),
)

_COMPILED = tuple(
    (emotion, re.compile("|".join(patterns), re.IGNORECASE)) for emotion, patterns in _BANKS
)

# ---------------------------------------------------------------------------
# Emphasis
# ---------------------------------------------------------------------------
#
# How hard the message is being delivered, independent of what it says. Typing in capitals
# is the clearest signal a customer can send that they are past patience, and it survives
# every paraphrase a phrase bank misses.

#: Runs of exclamation or question marks: "why is it so high???", "fix this!!"
_EMPHATIC_PUNCTUATION = re.compile(r"[!?]{2,}")

#: Words in full caps, three letters or more, so "NZ", "kWh" and "I" do not count.
_SHOUTED_WORD = re.compile(r"\b[A-Z]{3,}\b")

#: Below this many words a capitalised message is a habit or a phone keyboard, not shouting.
_SHOUTING_MIN_WORDS = 4

#: Share of long words in caps at which the message reads as shouted.
_SHOUTING_SHARE = 0.4


def _emphasis(message: str) -> list[str]:
    """Non-lexical intensity markers, as evidence strings.

    Returned rather than scored so the reason survives into the record. "Shouting" is
    something a support agent can read; a +0.3 is not.
    """
    found: list[str] = []
    if _EMPHATIC_PUNCTUATION.search(message):
        found.append("repeated ! or ?")

    words = [w for w in re.findall(r"[A-Za-z']+", message) if len(w) >= 3]
    if len(words) >= _SHOUTING_MIN_WORDS:
        shouted = sum(1 for w in words if w.isupper())
        if shouted / len(words) >= _SHOUTING_SHARE:
            found.append("written in capitals")
    return found


class Intensity(StrEnum):
    """How hard to lean on the tone instruction.

    Three levels because the instruction differs at the ends and not in the middle: `MILD`
    is a hint the model may ignore if the question pulls elsewhere, `STRONG` is a rule.
    """

    MILD = "mild"
    MODERATE = "moderate"
    STRONG = "strong"


@dataclass(frozen=True)
class EmotionalRead:
    """What this message sounds like. Carries no score the tier ladder can consult."""

    cues: list[EmotionCue] = field(default_factory=list)
    emphasis: list[str] = field(default_factory=list)

    @property
    def detected(self) -> list[Emotion]:
        """Every emotion cued, strongest first. Deduplicated, order stable."""
        seen: dict[Emotion, None] = {}
        for cue in sorted(self.cues, key=lambda c: _PRIORITY[c.emotion]):
            seen.setdefault(cue.emotion, None)
        return list(seen)

    @property
    def primary(self) -> Emotion | None:
        """The one that decides the register.

        Most cued wins; ties break on `_BANKS` order, which is ordered by how costly it is
        to get wrong. A message that is both distrustful and frustrated is answered as
        distrustful — showing your working to somebody merely annoyed costs a sentence,
        and being brisk with somebody who thinks you are lying costs the conversation.
        """
        if not self.cues:
            return None
        counts: dict[Emotion, int] = {}
        for cue in self.cues:
            counts[cue.emotion] = counts.get(cue.emotion, 0) + 1
        return min(counts, key=lambda e: (-counts[e], _PRIORITY[e]))

    @property
    def intensity(self) -> Intensity:
        """Cue count and emphasis together.

        Emphasis counts double: somebody typing in capitals has told us more about their
        state than a second matching phrase has.
        """
        weight = len(self.cues) + 2 * len(self.emphasis)
        if weight >= 4:
            return Intensity.STRONG
        if weight >= 2:
            return Intensity.MODERATE
        return Intensity.MILD

    def reasons(self) -> list[str]:
        """Plain-language evidence, for the log and for whoever picks this conversation up."""
        return [f"{c.emotion.value}: {c.evidence}" for c in self.cues] + list(self.emphasis)

    @property
    def guidance(self) -> str | None:
        """The instruction appended to the system prompt, or None when nothing was read.

        None rather than "answer normally" on purpose. An empty read is the common case,
        and spending prompt on a paragraph that says *don't do anything differently* buys
        a longer system prompt and a model that has been primed to think about tone on a
        message that never raised it.
        """
        primary = self.primary
        if primary is None:
            return None

        lines = [_TONE[primary]]
        if self.intensity is Intensity.STRONG:
            lines.append(_STRONG_SUFFIX)

        secondary = [e for e in self.detected if e is not primary][:1]
        if secondary:
            lines.append(f"There is also {secondary[0].value} here: {_SECONDARY[secondary[0]]}")

        return "TONE: " + " ".join(lines)


#: Tie-break order for `primary`, derived from `_BANKS` so the two cannot drift apart.
_PRIORITY: dict[Emotion, int] = {emotion: i for i, (emotion, _) in enumerate(_BANKS)}


# ---------------------------------------------------------------------------
# The instructions
# ---------------------------------------------------------------------------
#
# Every one of these is a rule about HOW to write. None is a sentence to send. That
# distinction is the difference between an assistant that adapts and an assistant with
# eight canned openings, and it is asserted in the tests rather than left to review.

_TONE: dict[Emotion, str] = {
    Emotion.FRUSTRATION: (
        "this customer is angry and has probably explained themselves before. Lead with "
        "the single most useful fact you found — no apology, no preamble, no thanking "
        "them for their patience. Be shorter than usual. Do not defend Kea, do not "
        "explain the process, and do not say you understand how frustrating this is. If "
        "something in their data genuinely went wrong, say so plainly first."
    ),
    Emotion.ANXIETY: (
        "this customer is worried about what is coming. Give them the concrete number "
        "early, including the range if the projection is uncertain — a vague reassurance "
        "reads as bad news being withheld. Say what happens next and on what date. Do not "
        "tell them not to worry, and do not soften a figure to make it land more gently."
    ),
    Emotion.CONFUSION: (
        "this customer is lost. Explain ONE thing properly rather than three things "
        "briefly, in the order it happens rather than the order the data is in. Define "
        "any term the first time you use it. Short sentences, one idea each. Do not list "
        "every driver you found — pick the one that answers what they actually asked."
    ),
    Emotion.DISTRUST: (
        "this customer thinks a figure here is wrong, or does not trust an assistant to "
        "give them one. Show your working: name the source of each number, the period it "
        "covers, and the arithmetic between them, so they can check it themselves. Say "
        "plainly which parts of your answer are measured and which are projected or "
        "illustrative. Do not assert confidence you cannot demonstrate, and do not tell "
        "them the figure is correct — show them where it came from and let them decide. "
        "If they are disputing the bill or the meter, that is a handoff, not an argument."
    ),
    Emotion.SHAME: (
        "this customer is apologising for asking, or blaming themselves. Answer the "
        "question directly and matter-of-factly, as though it were the most ordinary "
        "question in the world — which it is. Do not tell them it is not a silly "
        "question, do not reassure them, and do not comment on the apology at all; the "
        "correction is in how normally you answer, not in a sentence about it. Avoid any "
        "wording that implies their usage is a choice they should have made differently."
    ),
    Emotion.RESIGNATION: (
        "this customer has stopped expecting anything to change. Skip the encouragement "
        "and give them one specific thing that is genuinely within their control, with "
        "the figure attached to it — a number they can act on is the only thing that "
        "counters this, and a general suggestion confirms their point. If the honest "
        "answer is that the increase was fixed charges or price rather than usage, say "
        "that outright rather than offering advice that will not work."
    ),
    Emotion.URGENCY: (
        "this customer needs an answer now. Put it in the first sentence with the date or "
        "amount in it, then the explanation underneath. Cut anything that is not needed "
        "to act today."
    ),
    Emotion.GRATITUDE: (
        "this customer is happy with the answer. Be brief. Do not re-explain what you "
        "just said, do not open a new topic, and do not ask them anything."
    ),
}

_SECONDARY: dict[Emotion, str] = {
    Emotion.FRUSTRATION: "keep it short and skip the softeners.",
    Emotion.ANXIETY: "be concrete about what happens next.",
    Emotion.CONFUSION: "define your terms.",
    Emotion.DISTRUST: "name the source of every figure.",
    Emotion.SHAME: "answer as though it were an ordinary question.",
    Emotion.RESIGNATION: "give them one thing they can actually change.",
    Emotion.URGENCY: "answer in the first line.",
    Emotion.GRATITUDE: "be brief.",
}

_STRONG_SUFFIX = (
    "This is emphatic — they have written in capitals, repeated punctuation, or said it "
    "several ways. Treat the instruction above as a rule rather than a preference."
)


def read(message: str) -> EmotionalRead:
    """Read one message. Pure, synchronous, cheap enough to run on every turn.

    Runs on every turn rather than when something looks wrong, for the same reason
    `signals.assess` does: the tone that matters is usually carried by a question about
    something else, and a check that ran after the answer was written would be a check on
    an answer already in the wrong register.
    """
    if not message or not message.strip():
        return EmotionalRead()

    cues = [
        EmotionCue(emotion=emotion, evidence=match.group(0))
        for emotion, pattern in _COMPILED
        if (match := pattern.search(message))
    ]
    return EmotionalRead(cues=cues, emphasis=_emphasis(message))
