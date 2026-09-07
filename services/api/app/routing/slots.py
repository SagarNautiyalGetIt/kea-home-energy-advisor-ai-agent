"""Layer 0a — pull the structured pieces out of a question, before choosing an intent.

## Why this is separate from intent matching

The old router asked one question of a sentence: which of ten patterns does it match
first? That throws away everything else the sentence said. "How much did I use in July
compared to last winter?" and "how much did I use?" match the same rule and get the same
answer, because the period and the comparison were never extracted — there was nowhere
to put them.

Extracting slots first turns those into different questions. It also means the intent
scorer gets *features* rather than raw text: an intent can say "I need a period" or "a
comparison target rules me out", which is far more robust than trying to express the same
thing as a longer regex. Most of the brittleness in the old rules was regexes trying to
encode slot logic inline — the comment on `PEAK_USAGE` explaining that the interrogative,
not the word "high", is what distinguishes it is exactly a slot condition written the
hard way.

Everything here is pure Python and deterministic. Layer 0 stays model-free: a routing
mistake must remain a debuggable Python bug with a stack trace, not a prompt to tune.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

# ──────────────────────────── slot vocabularies ────────────────────────────


class Period(StrEnum):
    """Which window the customer is asking about."""

    CURRENT = "current"
    """This cycle, in progress — 'so far', 'this month'."""

    LAST_BILL = "last_bill"
    """The most recent closed bill — the default for 'my bill'."""

    NAMED_MONTH = "named_month"
    """An explicit month, e.g. 'in July'. The month lands in `Slots.month`."""

    LAST_YEAR = "last_year"
    """The same window a year ago."""

    RECENT = "recent"
    """A short trailing window — 'this week', 'the last few days'."""

    NONE = "none"


class Comparison(StrEnum):
    """What the customer is measuring against. The single most useful slot there is —
    it is what separates "why is my bill high" (against my own last bill) from "am I
    using more than I should" (against comparable homes), which are different analyses
    that the old router answered identically."""

    PRIOR_PERIOD = "prior_period"
    SAME_PERIOD_LAST_YEAR = "same_period_last_year"
    SIMILAR_HOMES = "similar_homes"
    EXPECTATION = "expectation"
    """'more than usual', 'more than it should be' — against their own normal."""

    NONE = "none"


class Metric(StrEnum):
    """The unit the answer should be in. 71.4% of surveyed customers wanted dollars, so
    when nothing in the sentence signals a unit this resolves to MONEY, not energy."""

    MONEY = "money"
    ENERGY = "energy"
    RATE = "rate"
    TIME = "time"
    NONE = "none"


class Subject(StrEnum):
    """What the question is *about*. Distinguishes the account questions — balance, plan,
    payment, connection — from the usage questions, which is the whole family the old
    ten-intent set had no route for at all."""

    BILL = "bill"
    USAGE = "usage"
    PLAN = "plan"
    PAYMENT = "payment"
    ACCOUNT = "account"
    CONNECTION = "connection"
    SOLAR = "solar"
    HOT_WATER = "hot_water"
    APPLIANCE = "appliance"
    WEATHER = "weather"
    NONE = "none"


class Stance(StrEnum):
    """The shape of the ask, independent of its topic.

    A customer can take any stance toward any subject, and the stance changes what a
    good answer is far more than the subject does: 'what is my plan' wants a fact,
    'should I change my plan' wants a recommendation, 'my plan is wrong' wants a person.
    """

    FACT = "fact"
    """'what is', 'how much', 'when' — state the value."""

    CAUSE = "cause"
    """'why' — attribute it."""

    ACTION = "action"
    """'how do I', 'what can I do', 'should I' — advise."""

    DISPUTE = "dispute"
    """'this is wrong', 'I didn't use that' — the answer is a person, not a number."""

    DISTRESS = "distress"
    """'I can't pay' — outranks everything. Never answered with a chirpy explanation."""


_MONTHS = {
    m: i
    for i, m in enumerate(
        [
            "january", "february", "march", "april", "may", "june",
            "july", "august", "september", "october", "november", "december",
        ],
        start=1,
    )
}
_MONTHS |= {m[:3]: i for m, i in list(_MONTHS.items())}


@dataclass(frozen=True)
class Slots:
    """The structured reading of one question."""

    period: Period = Period.NONE
    month: int | None = None
    comparison: Comparison = Comparison.NONE
    metric: Metric = Metric.NONE
    subject: Subject = Subject.NONE
    stance: Stance = Stance.FACT
    mentions_appliance: bool = False
    mentions_time_of_day: bool = False
    is_question: bool = True
    matched: frozenset[str] = field(default_factory=frozenset)
    """Slot names that were positively detected, for the intent scorer to read as
    features. A slot resolved by default (metric falling to MONEY) is deliberately NOT
    in here — an intent that requires an explicit metric must not be satisfied by one
    we assumed."""

    def has(self, *names: str) -> bool:
        return any(n in self.matched for n in names)


# ──────────────────────────── patterns ────────────────────────────
#
# Grouped by slot rather than by intent. Adding a phrasing means adding it to the one
# vocabulary it belongs to, and every intent that reads that slot improves at once —
# which is the property the old flat rule list did not have, where "cold snap" had to be
# repeated into any rule that wanted it.

_CONTRACTIONS = {
    "what's": "what is", "whats": "what is", "why's": "why is",
    "how's": "how is", "when's": "when is", "where's": "where is",
    "i'm": "i am", "im": "i am", "i've": "i have", "ive": "i have",
    "don't": "do not", "dont": "do not", "can't": "cannot", "cant": "cannot",
    "won't": "will not", "wont": "will not", "isn't": "is not", "isnt": "is not",
    "doesn't": "does not", "wasn't": "was not", "didn't": "did not",
    "shouldn't": "should not", "couldn't": "could not", "haven't": "have not",
    "it's": "it is", "thats": "that is", "that's": "that is", "theres": "there is",
    "there's": "there is", "youre": "you are", "you're": "you are",
    "ill": "i will", "id": "i would", "we're": "we are",
}

_STANCE: list[tuple[Stance, re.Pattern[str]]] = [
    # Distress first and unconditionally. Under the Consumer Care Obligations this is
    # closer to a legal duty than a routing preference, and it must not be outscored by
    # a topic word that happens to appear in the same sentence.
    (
        Stance.DISTRESS,
        re.compile(
            r"\b(cannot afford|can ?not afford|struggl\w*|"
            r"behind on|in arrears|disconnect\w*|cut (?:me )?off|cutting me off|"
            r"payment plan|hardship|cannot pay|can ?not pay|unable to pay|"
            r"help me pay|too expensive for me|choosing between|heat or eat|"
            r"no money|broke|financial difficulty)\b"
        ),
    ),
    (
        Stance.DISPUTE,
        re.compile(
            r"\b(wrong|incorrect|mistake|error|not right|does not look right|"
            r"dispute|complain|complaint|overcharg\w*|double charg\w*|"
            r"i did not use|i was not|never used|not mine|charged twice|"
            r"unfair|rip ?off|scam)\b"
        ),
    ),
    (
        Stance.ACTION,
        re.compile(
            r"\b(how (?:do|can|would|should) i|what can i do|what should i do|"
            r"how to|ways to|tips|advice|recommend\w*|suggest\w*|"
            r"should i (?:switch|change|move|go)|help me (?:reduce|lower|cut|save)|"
            r"reduce|lower|cut down|bring down|save money|save on|cheaper)\b"
        ),
    ),
    (
        Stance.CAUSE,
        re.compile(
            r"\bwhy\b|\bhow come\b|\bwhat (?:is |was )?(?:driving|causing|behind)\b|"
            r"\bwhat made\b|\breason\b|\bexplain\b|\bcause[ds]?\b|\bdue to\b|"
            r"\bwhat happened\b"
        ),
    ),
]

_PERIOD: list[tuple[Period, re.Pattern[str]]] = [
    (
        Period.LAST_YEAR,
        re.compile(
            r"\b(last year|same time last year|this time last year|a year ago|"
            r"year[- ]on[- ]year|last winter|last summer|previous year)\b"
        ),
    ),
    (
        Period.CURRENT,
        re.compile(
            r"\b(so far|to date|this month|this cycle|this period|current|"
            r"right now|at the moment|this bill(?:ing)? (?:cycle|period)|"
            r"end of the month|month end|by the end)\b"
        ),
    ),
    (
        Period.RECENT,
        re.compile(r"\b(this week|last week|past week|last few days|recently|lately|yesterday)\b"),
    ),
    (
        Period.LAST_BILL,
        re.compile(
            r"\b(last (?:month|bill|invoice)|previous (?:month|bill|period)|"
            r"latest bill|most recent bill|month before)\b"
        ),
    ),
]

_MONTH_RE = re.compile(
    r"\b(?:in|for|during|of)?\s*\b("
    + "|".join(sorted(_MONTHS, key=len, reverse=True))
    + r")\b"
)

_COMPARISON: list[tuple[Comparison, re.Pattern[str]]] = [
    (
        Comparison.SIMILAR_HOMES,
        re.compile(
            r"\b(similar (?:homes|houses|households)|other (?:people|homes|households|customers)|"
            r"average (?:home|household|customer|new zealand)|neighbou?rs?|"
            r"everyone else|most people|typical (?:home|household)|"
            r"compared to others|national average|normal for)\b"
        ),
    ),
    (
        Comparison.SAME_PERIOD_LAST_YEAR,
        re.compile(r"\b(last year|last winter|last summer|a year ago|year[- ]on[- ]year)\b"),
    ),
    (
        Comparison.EXPECTATION,
        re.compile(
            r"\b(than usual|more than usual|unusual|abnormal|out of the ordinary|"
            r"than i (?:normally|usually|expected)|than expected|than it should|"
            r"higher than normal|not normal|strange|odd|weird)\b"
        ),
    ),
    (
        Comparison.PRIOR_PERIOD,
        re.compile(
            r"\b(last (?:month|bill|period|cycle)|previous (?:month|bill|period)|"
            r"month before|compared to last|than last|versus last|vs last|"
            r"gone up|went up|jumped|spiked|doubled|risen|increased|"
            r"gone down|dropped|fallen|decreased)\b"
        ),
    ),
]

_METRIC: list[tuple[Metric, re.Pattern[str]]] = [
    (
        Metric.RATE,
        # Every branch has to be able to consume its whole word. The group is closed by
        # `\b`, so a branch ending at a stem — `rate` against "rates" — can never match:
        # the boundary check falls between `e` and `s`, which are both word characters.
        # Three separate routing misses traced back to this one shape.
        re.compile(
            r"\b(rates?|per kwh|per unit|per kilowatt|cents? (?:a|per)|price per|"
            r"tariff rates?|daily charges?|fixed charges?|standing charges?|unit price|"
            r"what am i paying per|how much per)\b"
        ),
    ),
    (
        Metric.ENERGY,
        re.compile(
            r"\b(kwh|kilowatt|units?\b|consumption|how much (?:power|electricity|energy)|"
            r"how many units|energy use|power use|usage in)\b"
        ),
    ),
    (
        Metric.TIME,
        re.compile(
            r"\b(when|what time|which day|what day|which hour|what hour|how long|"
            r"due date|read date|what date)\b"
        ),
    ),
    (
        Metric.MONEY,
        re.compile(
            r"\$|\b(cost|costs?|costing|dollars?|money|pay|paying|paid|owe|owing|"
            r"charge[ds]?|bill|expensive|cheap|spend|spent|amount|balance|price)\b"
        ),
    ),
]

_SUBJECT: list[tuple[Subject, re.Pattern[str]]] = [
    (
        Subject.SOLAR,
        re.compile(r"\b(solar|panels?|export(?:ed|ing)?|buy ?back|feed ?in|generat\w*)\b"),
    ),
    (
        Subject.HOT_WATER,
        re.compile(r"\b(hot water|cylinder|controlled load|ripple|night rate)\b"),
    ),
    (
        Subject.PLAN,
        re.compile(
            r"\b(plan|tariff|package|deal|rate plan|low fixed|standard user|low user|"
            r"time of use|tou|switch(?:ing)? plan|better plan|cheaper plan|"
            r"which plan|what plan|my plan|contract|term)\b"
        ),
    ),
    (
        Subject.PAYMENT,
        re.compile(
            r"\b(direct debit|payment method|how do i pay|autopay|automatic payment|"
            r"credit card|bank transfer|installment|instalment|pay my bill|"
            r"payment(?: date| due)?|late fee|prompt payment|discount)\b"
        ),
    ),
    (
        Subject.CONNECTION,
        re.compile(
            r"\b(icp|meter (?:number|serial|reading|read)|connection|address|property|"
            r"network|lines company|vector|distributor|where i live|my house)\b"
        ),
    ),
    (
        Subject.ACCOUNT,
        re.compile(
            r"\b(account (?:number|details)?|customer number|my details|my account|"
            r"balance|owe|owing|credit|arrears|statement|profile|"
            r"email|phone number|contact details)\b"
        ),
    ),
    (
        Subject.WEATHER,
        re.compile(
            r"\b(weather|cold|colder|cold snap|cold spell|warm|warmer|temperature|"
            r"winter|summer|heating|freezing|frost)\b"
        ),
    ),
    (
        Subject.BILL,
        re.compile(r"\b(bill|invoice|statement|charge[ds]?|amount due|total)\b"),
    ),
    (
        Subject.USAGE,
        re.compile(
            r"\b(usage|use[ds]?|using|consumption|power|electricity|energy|kwh|units?|"
            r"consumed|draw(?:ing)?)\b"
        ),
    ),
]

_APPLIANCE = re.compile(
    r"\b(appliance|heater|heat ?pump|dryer|drier|washing machine|dishwasher|"
    r"fridge|freezer|oven|stove|tv|television|computer|spa|pool|"
    r"which device|what device|what is using|whats using)\b"
)

_TIME_OF_DAY = re.compile(
    r"\b(time of day|what hour|which hour|hourly|peak hour|per hour|"
    r"morning|evening|overnight|afternoon|night ?time|during the day|at night|"
    r"breakfast|dinner ?time)\b"
)


#: Contractions matched as whole tokens, longest first so "cannot" beats "can".
#:
#: ⚠️ Built as one alternation over the ORIGINAL text rather than by splitting into
#: words first. Splitting on `\W+` tears "can't" into `can` / `'` / `t`, so a
#: whole-word lookup never sees the contraction at all and every apostrophised form
#: passes through unexpanded. That is not cosmetic: "I can't afford this bill" then
#: fails to reach the hardship vocabulary, and a customer in financial distress gets
#: routed to a usage explanation — the exact outcome the Consumer Care Obligations
#: make the router responsible for avoiding.
_CONTRACTION_RE = re.compile(
    r"\b(" + "|".join(sorted((re.escape(k) for k in _CONTRACTIONS), key=len, reverse=True)) + r")\b"
)


#: Does the message read as a question at all? A bare statement ("my bill is huge")
#: is still routed — customers state their problem as often as they ask about it —
#: but the distinction is available to any rule that wants it.
_INTERROGATIVE = re.compile(
    r"\?|^\s*(what|why|how|when|which|where|who|is|are|do|does|can|could|should|will|am)\b"
)


def normalise(text: str) -> str:
    """Lowercase, expand contractions, collapse whitespace.

    Contractions are expanded rather than stripped because the apostrophe carries the
    verb: "what's my balance" and "what is my balance" must reach the same slots, and
    deleting the apostrophe gives "whats", which matches nothing.

    Curly apostrophes are folded to straight ones first — phones produce them by
    default, so a customer typing on one would otherwise take a different path through
    the router than a customer typing on a laptop.
    """
    lowered = re.sub(r"[‘’ʼ]", "'", text.lower().strip())
    expanded = _CONTRACTION_RE.sub(lambda m: _CONTRACTIONS[m.group(1)], lowered)
    return re.sub(r"\s+", " ", expanded).strip()


def extract(text: str) -> Slots:
    """Read every slot out of one question. Never raises; an empty string yields defaults."""
    t = normalise(text)
    matched: set[str] = set()

    stance = Stance.FACT
    for candidate, pattern in _STANCE:
        if pattern.search(t):
            stance = candidate
            matched.add("stance")
            break

    period, month = Period.NONE, None
    for candidate, pattern in _PERIOD:
        if pattern.search(t):
            period = candidate
            matched.add("period")
            break

    if (m := _MONTH_RE.search(t)) is not None:
        month = _MONTHS[m.group(1)]
        matched.add("month")
        # A named month beats a relative one — "in July" is more specific than "last
        # month", and a sentence containing both is asking about July.
        if period in (Period.NONE, Period.LAST_BILL):
            period = Period.NAMED_MONTH

    comparison = Comparison.NONE
    for candidate, pattern in _COMPARISON:
        if pattern.search(t):
            comparison = candidate
            matched.add("comparison")
            break

    metric = Metric.NONE
    for candidate, pattern in _METRIC:
        if pattern.search(t):
            metric = candidate
            matched.add("metric")
            break

    subject = Subject.NONE
    for candidate, pattern in _SUBJECT:
        if pattern.search(t):
            subject = candidate
            matched.add("subject")
            break

    mentions_appliance = bool(_APPLIANCE.search(t))
    mentions_time_of_day = bool(_TIME_OF_DAY.search(t))
    if mentions_appliance:
        matched.add("appliance")
    if mentions_time_of_day:
        matched.add("time_of_day")

    return Slots(
        # Dollars are the default unit, per the survey. Note this is resolved AFTER the
        # `matched` set is built, so "metric" stays absent — an intent that genuinely
        # requires the customer to have asked in dollars is not satisfied by our default.
        period=period,
        month=month,
        comparison=comparison,
        metric=metric if metric is not Metric.NONE else Metric.MONEY,
        subject=subject,
        stance=stance,
        mentions_appliance=mentions_appliance,
        mentions_time_of_day=mentions_time_of_day,
        is_question=bool(_INTERROGATIVE.search(t)),
        matched=frozenset(matched),
    )


# ──────────────────────────── composite questions ────────────────────────────

#: Split *before* the second question's interrogative, never through it.
#:
#: The obvious pattern — splitting on `\band what\b` — consumes the "what" it matched,
#: so "why is my bill high and what can I do?" yields "can i do about it" as its second
#: part. That has no interrogative left, matches nothing, and resolves to out_of_scope:
#: the splitter creates the very failure it exists to prevent. A lookahead consumes the
#: conjunction and leaves the question word attached to the clause it introduces.
_SPLIT = re.compile(
    r"\?"
    r"|\band(?: also)?\s+"
    r"(?=what|how|why|when|which|where|who|can|could|should|will|is|are|do|does|am\b)"
    r"|\bplus\s+(?=what|how|why|when)"
    r"|[;]"
)


def split_questions(text: str) -> list[str]:
    """Break a multi-part message into the questions it actually contains.

    "Why is my bill so high and what can I do about it?" is two questions with two
    different answers — one is an attribution and the other is advice. Answering only
    the first is the behaviour customers read as the assistant not listening, and it is
    what a single-intent router structurally has to do.

    Conservative on purpose: it splits on question marks and on a small set of
    conjunctions that introduce a *new interrogative*. A bare "and" is not one of them,
    because "my bill and my usage" is one question about two things.
    """
    parts = [p.strip(" ,.") for p in _SPLIT.split(text)]
    kept = [p for p in parts if len(p.split()) >= 3]
    return kept or [text.strip()]
