"""What the customer said, and what their account shows.

Two independent evidence streams, scored separately and then combined, because they fail
in opposite directions and a single number would hide that:

* **Linguistic.** What they told us, in their own words. Fast, direct, and the only
  signal that exists for a household whose account looks fine — most people in
  difficulty are up to date right until they are not. It is also the one that can be
  triggered by a turn of phrase, so no linguistic signal alone reaches the top tier.
* **Account.** What the data shows regardless of what they said — a balance that keeps
  climbing, a bill that doubled, a disconnection-adjacent history. Slower, harder to
  fake, and it works when somebody is too embarrassed to say anything, which the
  survey suggests is common.

## Why this is not sentiment analysis

An emotional-tone classifier would fire on anger about a website outage and stay quiet
on a flat "I'll have to sell the car". What matters is not how upset the sentence
sounds, it is whether it discloses **difficulty paying for an essential service**. So
the phrase bank is organised by what a phrase means for the customer's position, not by
how negative it reads, and the highest-weighted entries are the calm ones.

## On matching phrases with regexes

It is crude and it is the right crudeness here. This decides whether a person is brought
into a conversation — it must be inspectable by the support lead who owns the policy,
reproducible in a test, and incapable of being talked out of its answer by the
conversation it is reading. A model asked "is this customer in hardship?" is none of
those, and it is the same model that would then be told to stand down.

The trade is real: this misses paraphrases a model would catch. That is why a *miss*
here is not the end of the ladder — `handoff_to_human` is still in the model's hands and
still forces tier 3, so the two mechanisms cover each other's failure modes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

# ---------------------------------------------------------------------------
# What a signal is
# ---------------------------------------------------------------------------


class Source(StrEnum):
    LANGUAGE = "language"
    ACCOUNT = "account"
    CARE_REGISTER = "care_register"


@dataclass(frozen=True)
class Signal:
    """One piece of evidence, with the reason attached.

    `evidence` is what actually matched — the customer's phrase, or the figure. It goes
    into the escalation record so the person picking this up can see why they were
    brought in, rather than being handed a score. "Flagged: 0.8" is not a handover.
    """

    key: str
    source: Source
    weight: float
    detail: str
    evidence: str | None = None


# ---------------------------------------------------------------------------
# Linguistic signals
# ---------------------------------------------------------------------------
#
# Weights are on a 0-1 scale where 1.0 alone is enough to reach the top tier. Read them
# as "how certain is this that the customer is disclosing difficulty", not "how upset".

#: Explicit inability to pay. The clearest disclosure there is, and the one the
#: Consumer Care Obligations are written about.
_CANNOT_PAY = (
    r"can'?t afford", r"cannot afford", r"can'?t pay", r"cannot pay",
    r"unable to pay", r"no money", r"broke\b", r"skint\b",
    r"don'?t have the money", r"haven'?t got the money",
    r"struggling to pay", r"struggle to pay", r"falling behind",
    r"behind on (?:my|the) (?:bill|payment)", r"in arrears",
)

#: Choosing between essentials. Recognised in the hardship literature as a marker of
#: material deprivation, and people say it plainly when they would not say "hardship".
#
# The verb and its particle are routinely split by the object — "too scared to turn the
# heater on", "afraid to put the heat on". An earlier `too scared to (?:use|turn on)`
# missed every one of those, which is the commonest way a New Zealander says this.
_RATIONING = (
    r"heat or eat", r"choose between", r"can'?t heat", r"cannot heat",
    r"(?:too )?(?:scared|afraid|frightened|nervous) to\b[^.?!]{0,30}"
    r"\b(?:use|turn|put|switch|run|heat)\b",
    r"not (?:using|putting|turning) (?:the|my) (?:heat|heater|heat pump|drier|dryer)",
    r"going without", r"do without heating",
    r"only heat(?:ing)? one room", r"sitting in the (?:cold|dark)",
    r"wearing (?:a )?(?:coat|jacket|blanket) (?:indoors|inside|at home)",
    r"showers? at (?:the )?(?:gym|work)",
)

#: Income shock. Not hardship yet, but the thing that causes it, and the point at which
#: an assistance conversation is most useful.
_INCOME_SHOCK = (
    r"lost my job", r"made redundant", r"been laid off", r"laid off",
    r"hours (?:were )?cut", r"reduced hours", r"on a benefit",
    r"between jobs", r"waiting on (?:a )?benefit", r"lost my income",
    r"my partner left", r"recently widowed", r"off work sick",
)

#: Disconnection is imminent or threatened. Split out from the rest of the debt signals
#: and weighted at the top of the ladder, because by this point the conversation is not
#: about a bill and the Consumer Care Obligations around disconnection are the strictest
#: duties in the whole regime. A first pass lumped this in at 0.65 and a customer saying
#: "they're threatening to cut me off" got a monitored tier — which is a person
#: *watching* somebody about to lose power rather than a person *helping* them.
_DISCONNECTION = (
    r"disconnect", r"cut off", r"cut me off", r"cutting me off",
    r"final notice", r"final demand", r"debt collect",
    r"power (?:gets|is going to be|will be) (?:cut|shut)",
)

#: Assistance services and payment arrangements. Real evidence of difficulty, but a
#: customer *asking about* a payment plan is earlier in the ladder than one being
#: disconnected — and it is a conversation the assistant can usefully start.
_DEBT_PRESSURE = (
    r"payment plan", r"instal?ment plan", r"payment arrangement",
    r"budget(?:ing)? (?:advice|service)", r"work and income", r"winz\b",
    r"food ?bank", r"loan shark", r"payday loan", r"hardship (?:fund|grant|programme)",
)

#: Acute distress. Weighted highest and handled outside the score — see `assess`.
_CRISIS = (
    # Gerunds and modals, not just the bare verb: "killing myself", "want to kill
    # myself", "thinking about ending it". `kill myself` alone missed "sometimes I
    # think about killing myself", which is closer to how anyone actually says it.
    r"kill(?:ing)? (?:myself|my ?self)", r"end(?:ing)? (?:my life|it all)",
    r"suicid", r"want to die", r"better off (?:dead|without me)",
    r"can'?t go on", r"no way out", r"give up on life", r"harm myself",
)

_LINGUISTIC: tuple[tuple[str, tuple[str, ...], float, str], ...] = (
    ("crisis", _CRISIS, 1.0, "acute personal distress"),
    ("cannot_pay", _CANNOT_PAY, 0.85, "explicit difficulty paying"),
    ("disconnection", _DISCONNECTION, 0.8, "disconnection is threatened or imminent"),
    ("rationing", _RATIONING, 0.7, "going without an essential service"),
    ("debt_pressure", _DEBT_PRESSURE, 0.55, "assistance services or a payment arrangement"),
    ("income_shock", _INCOME_SHOCK, 0.5, "a change in income"),
)

_COMPILED = tuple(
    (key, re.compile("|".join(patterns), re.IGNORECASE), weight, detail)
    for key, patterns, weight, detail in _LINGUISTIC
)

#: Phrases that look like a disclosure and are not.
#:
#: "I can't pay online" is a website problem. "I couldn't pay last year but I'm fine now"
#: is history. Without these the assistant escalates a broken payment page to a hardship
#: team, which wastes the customer's time and trains everyone to ignore the flag.
_NEGATED = re.compile(
    r"can'?t pay (?:online|by card|on the (?:app|site|website))"
    r"|couldn'?t pay .{0,30}(?:last year|back then|at the time)"
    r"|used to (?:struggle|be behind)"
    r"|(?:no longer|not) (?:struggling|behind|in arrears)"
    r"|all (?:sorted|paid off) now",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# The assessment
# ---------------------------------------------------------------------------


@dataclass
class HardshipAssessment:
    """Everything known about this customer's position on this turn."""

    signals: list[Signal] = field(default_factory=list)
    crisis: bool = False
    """Acute personal distress. Handled outside the score — see `assess`."""

    on_care_register: bool = False
    """Medically dependent or registered vulnerable. A standing property of the account,
    not a reading of this conversation."""

    @property
    def score(self) -> float:
        """0-1, over the *evidential* signals only.

        `care_register` is excluded deliberately. It is a standing property of the
        account rather than something this conversation revealed, and letting its 0.5
        into the score meant a medically dependent customer asking "what's my balance?"
        scored 0.5 and was reported as "signs of financial pressure on this account" —
        paging an agent about a routine question and mislabelling the reason. The
        register is handled as its own rule in `tiers.py`, which is where a standing
        obligation belongs.

        The strongest signal, plus a diminishing contribution from the rest.

        Not a sum: three weak signals should not outrank one explicit "I can't pay this",
        and not a bare max either, because corroboration across independent sources is
        genuinely more informative than any one of them. So the strongest signal sets the
        floor and everything else can add at most half the remaining distance.
        """
        evidential = [s for s in self.signals if s.source is not Source.CARE_REGISTER]
        if not evidential:
            return 0.0
        weights = sorted((s.weight for s in evidential), reverse=True)
        score = weights[0]
        for weight in weights[1:]:
            score += (1.0 - score) * weight * 0.5
        return round(min(score, 1.0), 3)

    @property
    def corroborated(self) -> bool:
        """True when the language and the account agree.

        The tier ladder leans on this: a linguistic signal on its own can be a turn of
        phrase, and an account signal on its own can be somebody who is simply late. The
        two together are the case where confidence is high enough to act firmly.
        """
        sources = {s.source for s in self.signals}
        return Source.LANGUAGE in sources and Source.ACCOUNT in sources

    def reasons(self) -> list[str]:
        """Plain-language evidence, for the escalation row and the agent's context."""
        return [
            f"{s.detail}: {s.evidence}" if s.evidence else s.detail
            for s in sorted(self.signals, key=lambda s: -s.weight)
        ]


def _language_signals(message: str) -> list[Signal]:
    if not message or not message.strip():
        return []
    if _NEGATED.search(message):
        # One negation suppresses the whole linguistic stream rather than the matching
        # phrase alone. "I can't pay online, and I can't pay at all" is not a sentence
        # anybody writes; "I can't pay online" is, constantly.
        return []

    found: list[Signal] = []
    for key, pattern, weight, detail in _COMPILED:
        match = pattern.search(message)
        if match:
            found.append(
                Signal(
                    key=key,
                    source=Source.LANGUAGE,
                    weight=weight,
                    detail=detail,
                    evidence=match.group(0),
                )
            )
    return found


def _account_signals(account: object) -> list[Signal]:
    """Financial-stress markers from the account itself.

    Every one is guarded with `getattr`: the fixture and seeded households carry almost
    none of this, and a missing field must read as "no signal" rather than raising or —
    worse — as a zero that looks like good news.
    """
    found: list[Signal] = []
    billing = getattr(account, "billing", None)

    balance = getattr(billing, "balance_nzd", None) if billing else None
    last_bill = getattr(billing, "last_bill_total_nzd", None) if billing else None

    # A balance well past one bill is money that has not been paid across more than one
    # cycle. One bill outstanding is normal mid-cycle and says nothing.
    if balance and last_bill and last_bill > 0 and balance > last_bill * 1.5:
        found.append(
            Signal(
                key="balance_exceeds_a_cycle",
                source=Source.ACCOUNT,
                weight=0.6,
                detail="balance is more than one bill behind",
                evidence=f"${balance:,.0f} owing against a ${last_bill:,.0f} bill",
            )
        )

    if billing is not None and getattr(billing, "is_overdue", False):
        found.append(
            Signal(
                key="overdue",
                source=Source.ACCOUNT,
                weight=0.4,
                detail="the current bill is past its due date",
            )
        )

    # A bill that jumped sharply is the thing that turns a coping household into one that
    # is not, which is the entire premise of the product.
    current = getattr(account, "current_bill", None)
    prior = getattr(account, "prior_bill", None)
    if current is not None and prior is not None:
        now = getattr(current, "total_nzd", 0.0) or 0.0
        before = getattr(prior, "total_nzd", 0.0) or 0.0
        if before > 0 and now >= before * 1.6:
            found.append(
                Signal(
                    key="bill_shock",
                    source=Source.ACCOUNT,
                    weight=0.45,
                    detail="this bill is far larger than the last one",
                    evidence=f"${now:,.0f} against ${before:,.0f}",
                )
            )

    # Prepay-style behaviour: a household on a low-user plan whose usage collapsed is
    # often one that has started self-disconnecting rather than one that went on holiday.
    days = getattr(account, "days", None) or []
    if len(days) >= 14:
        recent = [d.import_kwh for d in days[-7:]]
        earlier = [d.import_kwh for d in days[-14:-7]]
        if earlier and recent and sum(earlier) > 0:
            drop = 1.0 - (sum(recent) / sum(earlier))
            if drop >= 0.45:
                found.append(
                    Signal(
                        key="usage_collapse",
                        source=Source.ACCOUNT,
                        weight=0.5,
                        detail=(
                            "usage fell sharply this week, which can mean a household is "
                            "going without rather than away"
                        ),
                        evidence=f"down {drop * 100:.0f}% on the week before",
                    )
                )

    return found


def assess(message: str, account: object | None = None) -> HardshipAssessment:
    """Score one turn. Pure, synchronous, and cheap enough to run on every message.

    Runs on every turn rather than when something looks wrong, because the disclosure
    that matters is usually buried in a question about something else — "why is my bill
    so high, I can't afford this" is one message, and an implementation that only checked
    after the answer was written would escalate a turn too late.
    """
    signals = _language_signals(message)
    if account is not None:
        signals += _account_signals(account)

    crisis = any(s.key == "crisis" for s in signals)
    on_register = bool(
        getattr(account, "is_medically_dependent", False)
        or getattr(account, "is_vulnerable", False)
    )
    if on_register:
        signals.append(
            Signal(
                key="care_register",
                source=Source.CARE_REGISTER,
                weight=0.5,
                detail=(
                    "the account is flagged medically dependent or vulnerable, so "
                    "Consumer Care Obligations apply"
                ),
            )
        )

    return HardshipAssessment(
        signals=signals, crisis=crisis, on_care_register=on_register
    )
