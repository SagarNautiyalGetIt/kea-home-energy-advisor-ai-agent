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
    # Future tense, and calm. This is how the disclosure usually actually arrives —
    # nobody writes "I am in financial hardship", they write "I won't be able to pay this
    # one". An earlier bank had every present-tense form and none of these, so the
    # politest phrasing of the most serious message scored zero.
    r"won'?t be able to (?:pay|cover|manage)",
    r"not going to be able to (?:pay|cover|manage)",
    r"no way (?:i|we) can (?:pay|afford)",
    r"can'?t (?:cover|manage) (?:it|this|the bill)",
    r"(?:i'?m|we'?re) short (?:this|next) (?:month|week|fortnight)",
    r"(?:don'?t|won'?t) have (?:it|enough|the funds)",
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
    # Borrowing to pay for power. The point at which a bill stops being a bill and starts
    # compounding — and all of these are things people say before they say "hardship".
    r"citizens advice", r"salvation army", r"work ?and ?income",
    r"afterpay", r"buy now,? pay later", r"\bbnpl\b",
    r"(?:on|maxed out) (?:my|the) credit card", r"credit card to pay",
    r"\boverdraft\b", r"borrow(?:ing|ed)? (?:money|from|off)",
    r"asked? (?:my|our) (?:family|parents|mum|dad) for money",
    r"power bill (?:grant|assistance|help)", r"winter energy payment",
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

#: Safety. Weighted with `_CANNOT_PAY` because it is not a bill conversation at all.
#:
#: A household that has left, or is leaving, a violent home is one of the named
#: circumstances in the Consumer Care Obligations, and almost everything the assistant
#: would otherwise do is wrong: the account may be in the other person's name, the address
#: may need suppressing, and a payment plan is not the conversation. It goes to a person
#: every time, and the assistant does not ask a follow-up question about it.
_SAFETY = (
    r"family violence", r"domestic violence", r"protection order",
    r"restraining order", r"women'?s refuge", r"\brefuge\b", r"safe house",
    r"fled (?:the|my|our) (?:house|home|relationship)",
    r"escaping (?:a|an|my) ", r"(?:he|she|they) won'?t let me",
    r"abusive (?:partner|relationship|ex)",
)

#: Medical dependence, disclosed in conversation rather than read off the register.
#:
#: The register flag is a property of the account; this is the customer telling us. Under
#: the Consumer Care Obligations the duty attaches to the retailer being *on notice*, and
#: a household that has never been registered but says "I'm on an oxygen concentrator" has
#: just put us on notice. Treated as a disclosure in `assess` — see
#: `HardshipAssessment.disclosed_medical_dependence` — rather than only as a score
#: contribution, because the obligation is not a matter of how high the total came out.
_MEDICAL_DEPENDENCE = (
    r"medically dependent", r"oxygen (?:concentrator|machine)", r"on oxygen",
    r"dialysis", r"\bcpap\b", r"ventilator", r"nebuli[sz]er",
    r"life support", r"feeding pump", r"electric (?:wheelchair|hoist|bed)",
    r"(?:my|our) (?:medication|insulin) (?:needs|has) to (?:be )?(?:stay|kept|refrigerat)",
    r"can'?t (?:lose|be without) power (?:for|because)",
)

#: Housing insecurity. Not about power, and it is why the power bill cannot be paid.
_HOUSING_INSECURITY = (
    r"evict(?:ed|ion)?", r"served notice", r"90[- ]day notice",
    r"landlord (?:is )?(?:selling|kicking|evicting)", r"have to move out",
    r"emergency housing", r"transitional housing", r"boarding house",
    r"living in (?:my|the) car", r"sleeping in (?:my|the) car",
    r"couch ?surf", r"(?:in|at) a motel", r"nowhere to (?:live|go)",
    r"about to be homeless", r"\bhomeless\b",
)

#: A cold or damp home. The specifically *energy* form of hardship, and the one this
#: product is closest to.
#:
#: Deliberately not the word "cold" on its own — "was that just the cold snap?" is the
#: single most common question this assistant answers and it is not a disclosure. These
#: match the house, not the weather: the Healthy Homes Standards exist because damp,
#: mould and an unheatable house are the measurable form of energy hardship in New
#: Zealand, and a household describing one is describing a home they cannot afford to run.
_COLD_HOME = (
    r"\bdamp\b", r"\bmould\b", r"\bmold\b", r"condensation",
    r"mushrooms? (?:growing|on the)", r"black spots? on the (?:wall|ceiling)",
    r"no insulation", r"not insulated", r"single glaz",
    r"house is (?:freezing|always cold|so cold|impossible to heat)",
    r"(?:impossible|can'?t afford) to heat (?:this|the|our|my) (?:house|place|home)",
    r"windows? (?:run|running|streaming) with water",
)

#: Prepay and top-up behaviour. Self-rationing with a meter in front of it: a household
#: that runs out of credit has already self-disconnected, whatever the account says.
_PREPAY_STRESS = (
    r"prepay", r"pre[- ]?pay", r"top(?:ping)? up (?:the|my|our) (?:power|meter|account)",
    r"ran out of (?:credit|power|units)", r"out of credit",
    r"only (?:put|putting) \$?\d+ on", r"\$?\d+ at a time",
    r"emergency credit",
)

#: Bereavement. A specific cause of both an income shock and a usage change, and the one
#: circumstance where getting the tone wrong is least forgivable.
_BEREAVEMENT = (
    r"passed away", r"(?:my|our) (?:husband|wife|partner|mum|mother|dad|father|son|"
    r"daughter|child) (?:died|passed)", r"recently (?:died|passed)",
    r"\bfuneral\b", r"\bbereave", r"(?:since|after) (?:the|his|her|their) (?:death|funeral)",
    r"lost (?:my|our) (?:husband|wife|partner|mum|mother|dad|father|son|daughter)",
)

#: Health pressure short of medical dependence. Competing for the same money.
_HEALTH_PRESSURE = (
    r"medical bills?", r"hospital bills?", r"specialist(?:'s)? fees?",
    r"(?:in|out of) hospital", r"surgery", r"chemo", r"cancer",
    r"long covid", r"chronic(?:ally)? (?:ill|pain|fatigue)",
    r"(?:on a )?disability (?:benefit|allowance|support)", r"\bdisabled\b",
    r"carer'?s? (?:allowance|benefit|support)",
)

#: Caregiving load. Not distress on its own, and it never reaches a threshold alone —
#: 0.3 is below `MONITORED_THRESHOLD` by design. It is here because it *corroborates*:
#: "there's a newborn in the house and I lost my hours" is a different case from either
#: half, and the score formula is built to combine exactly that.
_CAREGIVING = (
    r"new ?born", r"new baby", r"baby at home", r"premature baby",
    r"sole parent", r"single (?:mum|mother|dad|father|parent)",
    r"looking after (?:my|our) (?:mum|mother|dad|father|nan|koro|kuia|parents)",
    r"caring for (?:my|our|a)", r"full[- ]time carer",
    r"(?:kids|children) (?:are )?home (?:all day|from school)",
)

_LINGUISTIC: tuple[tuple[str, tuple[str, ...], float, str], ...] = (
    ("crisis", _CRISIS, 1.0, "acute personal distress"),
    ("cannot_pay", _CANNOT_PAY, 0.85, "explicit difficulty paying"),
    ("safety", _SAFETY, 0.85, "the household's safety is at stake"),
    ("disconnection", _DISCONNECTION, 0.8, "disconnection is threatened or imminent"),
    ("rationing", _RATIONING, 0.7, "going without an essential service"),
    ("housing_insecurity", _HOUSING_INSECURITY, 0.6, "insecure or emergency housing"),
    ("prepay_stress", _PREPAY_STRESS, 0.6, "buying power in small amounts, or running out"),
    ("debt_pressure", _DEBT_PRESSURE, 0.55, "assistance services or a payment arrangement"),
    ("medical_dependence", _MEDICAL_DEPENDENCE, 0.5,
     "the household told us it depends on electricity for health reasons"),
    ("income_shock", _INCOME_SHOCK, 0.5, "a change in income"),
    ("bereavement", _BEREAVEMENT, 0.5, "a recent bereavement"),
    ("cold_home", _COLD_HOME, 0.45, "a cold or damp home they cannot afford to heat"),
    ("health_pressure", _HEALTH_PRESSURE, 0.45, "health costs competing for the same money"),
    ("caregiving", _CAREGIVING, 0.3, "caring for someone at home"),
)

_COMPILED = tuple(
    (key, re.compile("|".join(patterns), re.IGNORECASE), weight, detail)
    for key, patterns, weight, detail in _LINGUISTIC
)

# ---------------------------------------------------------------------------
# Account thresholds
# ---------------------------------------------------------------------------
#
# Named rather than inline, because these are the numbers a support lead would want to
# argue with and they should not have to read a comprehension to find them. Each is a
# judgement about when a pattern stops being normal, not a fact about the data.

#: A balance this far past one bill is money unpaid across more than one cycle. One bill
#: outstanding mid-cycle is ordinary and says nothing.
BALANCE_BEHIND_MULTIPLE = 1.5

#: A bill this much larger than the last one is the shock the product exists to catch.
#: Deliberately generous — 1.6x is a genuine jump, not a cold week.
BILL_SHOCK_MULTIPLE = 1.6

#: Days needed before the usage-collapse comparison means anything. Two full weeks, so
#: the two halves are like-for-like on weekends.
COLLAPSE_MIN_DAYS = 14
COLLAPSE_WINDOW_DAYS = 7

#: A drop this large in a week is the shape of a household self-disconnecting rather than
#: one that went away — a holiday usually shows as a fall to near zero, not to half.
COLLAPSE_DROP_SHARE = 0.45

#: How far below the peer cohort a household has to sit before under-use is a signal.
#:
#: 45% is deliberately far. Homes differ enormously in size and occupancy, so being under
#: the cohort is ordinary and means nothing on its own — a single person in a flat is not
#: in hardship for using half what a family of five uses. What makes this informative is
#: the second condition below: being this far under **while it is cold**.
UNDER_USE_SHARE = 0.55

#: Mean heating degree days per day above which the period counts as a cold one. 6 HDD/day
#: is roughly a 12°C mean — a New Zealand winter month rather than a mild shoulder season.
#: Below this, using less than the cohort says nothing about heating at all.
COLD_PERIOD_HDD = 6.0

#: Minimum days before either cold-weather comparison is allowed to fire. A fortnight, so
#: one cold week cannot carry it.
COLD_MIN_DAYS = 14

#: Heating response below this is a house that barely warms up when the weather turns.
#:
#: Read carefully: a low slope is NOT proof of hardship. A well-insulated home, a wood
#: burner or gas heating all produce one honestly, which is why this signal is weighted
#: below the threshold and never fires alone. It is here because the *combination* — cold
#: month, well under the cohort, and almost no heating response — is the measurable shape
#: of a household that has stopped heating, and that household usually says nothing.
FLAT_HEATING_KWH_PER_HDD = 0.15

#: Phrases that look like a disclosure and are not.
#:
#: "I can't pay online" is a website problem. "I couldn't pay last year but I'm fine now"
#: is history. Without these the assistant escalates a broken payment page to a hardship
#: team, which wastes the customer's time and trains everyone to ignore the flag.
_NEGATED = re.compile(
    # Every way of saying "I am unable to pay", followed by the thing that makes it a
    # website complaint. Widened alongside `_CANNOT_PAY`: adding "won't be able to pay"
    # to the disclosure bank without adding it here would have escalated "I won't be able
    # to pay online until you fix the card form".
    r"(?:can'?t|cannot|won'?t be able to|unable to|couldn'?t) pay "
    r"(?:online|by card|with (?:my|the) card|on the (?:app|site|website))"
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

    disclosed_medical_dependence: bool = False
    """The customer said so themselves, on an account with no register flag.

    Separate from `on_care_register` because the two fail in opposite directions and the
    obligation attaches to both. The register is what we already knew; this is the moment
    we were told. A household that has never been registered — which is most of them, since
    registration is a form somebody has to fill in — puts the retailer on notice the
    instant they mention the oxygen concentrator, and `tiers.decide` treats it the same way
    from that turn on.
    """

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
    if balance and last_bill and last_bill > 0 and balance > last_bill * BALANCE_BEHIND_MULTIPLE:
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
        if before > 0 and now >= before * BILL_SHOCK_MULTIPLE:
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
    if len(days) >= COLLAPSE_MIN_DAYS:
        recent = [d.import_kwh for d in days[-COLLAPSE_WINDOW_DAYS:]]
        earlier = [d.import_kwh for d in days[-COLLAPSE_MIN_DAYS:-COLLAPSE_WINDOW_DAYS]]
        if earlier and recent and sum(earlier) > 0:
            drop = 1.0 - (sum(recent) / sum(earlier))
            if drop >= COLLAPSE_DROP_SHARE:
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

    found += _cold_weather_signals(account, days)

    # Paying for power in small amounts. The account-side twin of `_PREPAY_STRESS`, and
    # the one that works when the customer says nothing — which is the usual case, because
    # nobody volunteers that they are buying electricity forty dollars at a time.
    method = (getattr(billing, "payment_method", None) or "").lower() if billing else ""
    if any(token in method for token in ("prepay", "pre-pay", "top up", "topup")):
        found.append(
            Signal(
                key="prepay_meter",
                source=Source.ACCOUNT,
                weight=0.45,
                detail=(
                    "this account buys power in advance, so running out shows up as the "
                    "power going off rather than as a late bill"
                ),
                evidence=method,
            )
        )

    return found


def _cold_weather_signals(account: object, days: list) -> list[Signal]:
    """Under-heating, read off the meter rather than out of a sentence.

    The two signals here are the only ones in this module that can find a household nobody
    has heard from. Everything else needs the customer to say something or the billing
    record to already show damage; these read a household that has quietly stopped heating,
    which is the state the Winter Energy Payment and the Healthy Homes Standards exist for
    and the one people are least likely to mention.

    Both are **conditional on the weather**, and that is what keeps them honest. Using less
    than comparable homes is unremarkable — half of every cohort does, by construction. It
    only becomes evidence when the month was cold enough that heating should be visible and
    it is not.

    Neither is weighted to fire alone. See the constants above for why a flat heating slope
    has innocent explanations, and `HardshipAssessment.score` for how corroboration is what
    actually promotes these.
    """
    found: list[Signal] = []
    if len(days) < COLD_MIN_DAYS:
        return found

    hdds = [d.heating_degree_days for d in days if d.heating_degree_days is not None]
    if len(hdds) < COLD_MIN_DAYS:
        return found
    mean_hdd = sum(hdds) / len(hdds)
    if mean_hdd < COLD_PERIOD_HDD:
        # A mild period. Nothing about heating can be concluded either way, and saying so
        # by returning early is better than a threshold that quietly never fires in summer.
        return found

    totals = [d.import_kwh for d in days]
    mine = sum(totals) / len(totals)
    peers = getattr(account, "peer_baseline_kwh_per_day", None)

    if peers and peers > 0 and mine <= peers * UNDER_USE_SHARE:
        found.append(
            Signal(
                key="cold_weather_under_use",
                source=Source.ACCOUNT,
                weight=0.35,
                detail=(
                    "the household used far less than comparable homes through a cold "
                    "period, which can mean heating is being rationed"
                ),
                evidence=(
                    f"{mine:.1f} kWh/day against {peers:.1f} for comparable homes, "
                    f"averaging {mean_hdd:.1f} heating degree days"
                ),
            )
        )

    slope = getattr(account, "heating_sensitivity_kwh_per_hdd", None)
    if slope is not None and 0 <= slope < FLAT_HEATING_KWH_PER_HDD:
        found.append(
            Signal(
                key="no_heating_response",
                source=Source.ACCOUNT,
                weight=0.3,
                detail=(
                    "usage barely rose when the temperature fell, so the house may not be "
                    "being heated — though good insulation or a wood burner look the same"
                ),
                evidence=f"{slope:.2f} kWh per heating degree day",
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
    disclosed_md = any(s.key == "medical_dependence" for s in signals)
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
        signals=signals,
        crisis=crisis,
        on_care_register=on_register,
        disclosed_medical_dependence=disclosed_md,
    )
