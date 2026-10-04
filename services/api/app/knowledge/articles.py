"""The account help corpus — what Sparky can answer about the *service* rather than the meter.

Every other tool in this system reads a row of the customer's data. This one reads
reference material, and that difference creates the one risk worth designing against:
reference material is where a model's own training would happily fill any gap, fluently and
plausibly, about a company whose policies it has never seen. "Kea gives you 14 days to pay"
is the sort of sentence that costs a customer money and would pass every check in this
repository, because it contains no figure derived from meter data.

So the corpus is built to make that failure hard rather than to be told not to happen:

## Every fact is labelled with what kind of claim it is

`Basis` is on the fact, not on the article, because a single answer usually mixes them —
"a retailer must give you notice before disconnecting, and Kea's own notice period is X" is
one regulated fact and one company fact and they carry different weight. The four:

* `REGULATION` — New Zealand law or the Electricity Authority's rules. True regardless of
  retailer, and the customer can check it with the named body.
* `INDUSTRY` — how the New Zealand market works: ICPs, the registry, switching, GST. Not
  law exactly, but not Kea's choice either.
* `PRODUCT` — how *this system* behaves. We built it, so we know it, and it is the most
  reliable category here.
* `KEA_ILLUSTRATIVE` — a plausible retailer policy standing in for one we do not have.
  Every one of these is worded so the model must attribute it as an example, and the
  guidance says so on every retrieval. This is the category that would otherwise be
  invented, so it is the category that is explicitly fenced.

## Nothing here is an answer

`Article.facts` are statements to reason from, not prose to send. There is no `answer`
field anywhere in this module, and that is deliberate — the frontend Help page has one
because a static page is a static page, but an assistant that pastes a stored paragraph is
an assistant answering a question the customer did not ask. It is the same defect the
twenty-six-intent router had, rebuilt in a new place: one canned response per topic,
regardless of what was actually asked.

The tool therefore hands the model the material and the customer's own question, and the
model writes the answer. Asserted in `test_knowledge.py::test_no_article_carries_prose`.

## Where `verify` comes in

New Zealand's regulated details move — the low-fixed-charge cap has been rising annually
under a phase-out, the Consumer Care Obligations changed status recently. A fact marked
`verify=True` is one whose *shape* is stable and whose *number or date* should be checked
against the named body before anyone relies on it. The model is told which facts carry it,
so it hedges those specifically rather than hedging everything or nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Basis(StrEnum):
    REGULATION = "regulation"
    INDUSTRY = "industry"
    PRODUCT = "product"
    KEA_ILLUSTRATIVE = "kea_illustrative"

    @property
    def how_to_say_it(self) -> str:
        """How a fact of this kind must be attributed when it reaches a customer."""
        return {
            Basis.REGULATION: (
                "New Zealand rules that apply to every retailer. State it plainly and name "
                "the body the customer can check it with."
            ),
            Basis.INDUSTRY: (
                "How the New Zealand market works. State it plainly; it is not specific to "
                "Kea."
            ),
            Basis.PRODUCT: (
                "How this system actually behaves. We built it, so you may state it "
                "directly."
            ),
            Basis.KEA_ILLUSTRATIVE: (
                "An ILLUSTRATIVE example of a retailer policy, NOT Kea's actual terms — "
                "this prototype does not have them. Say it is an example of how this "
                "normally works and tell them to check their own terms or ask the team. "
                "Never state it as Kea's policy."
            ),
        }[self]


@dataclass(frozen=True)
class Fact:
    text: str
    basis: Basis
    source: str = ""
    """Who the customer can check this with. Empty for PRODUCT facts, where the answer is
    'this system', and required in spirit for everything else."""

    verify: bool = False
    """The shape is stable, the number or date is not. See the module docstring."""


@dataclass(frozen=True)
class Article:
    id: str
    topic: str
    title: str
    asks: tuple[str, ...]
    """Ways a customer actually phrases this. The retrieval index, and the reason a
    question about "why is there a charge when I was away" finds the daily-charge article
    without the word 'fixed' appearing anywhere in it."""

    facts: tuple[Fact, ...]
    not_covered: str = ""
    """What this article does NOT answer, so the model says so rather than stretching it.
    The single most useful field here: an article about payment arrangements that does not
    say "this does not tell you whether YOU qualify" is an article that will be used to
    tell somebody they qualify."""

    see_also: tuple[str, ...] = ()
    action: str = ""
    """What the customer can actually do next, where there is something. Named as a
    capability rather than a script — 'the assistant can change this for them with
    update_alert_settings' — so the model routes to the tool instead of describing a
    settings screen the customer then has to find."""


# ---------------------------------------------------------------------------
# The corpus
# ---------------------------------------------------------------------------

TOPICS = (
    "billing",
    "payments",
    "hardship",
    "plans",
    "meters",
    "moving",
    "solar",
    "alerts",
    "privacy",
    "assistant",
    "account",
)


ARTICLES: tuple[Article, ...] = (
    # ---------------- billing ----------------
    Article(
        id="daily-fixed-charge",
        topic="billing",
        title="The daily charge, and why a bill is never zero",
        asks=(
            "why am I charged when I was away",
            "what is the daily charge",
            "what is the fixed charge",
            "why is there a charge when I used no power",
            "empty house still has a bill",
            "holiday bill",
            "supply charge",
        ),
        facts=(
            Fact(
                "Every connection is billed a daily charge for being connected to the "
                "network at all, separately from the power used. An empty house is still "
                "connected, so it still has a bill.",
                Basis.INDUSTRY,
            ),
            Fact(
                "The daily charge covers the lines company's cost of maintaining the "
                "connection and the meter, and is passed through by the retailer.",
                Basis.INDUSTRY,
            ),
            Fact(
                "New Zealand retailers must offer a low-user plan with a capped daily "
                "charge to households below a set annual usage. The cap has been rising "
                "each year under a scheduled phase-out of the low fixed charge "
                "regulations.",
                Basis.REGULATION,
                source="Electricity Authority",
                verify=True,
            ),
            Fact(
                "The assistant can price this household's own usage against each plan and "
                "show how much of each bill is daily charges versus units.",
                Basis.PRODUCT,
            ),
        ),
        not_covered=(
            "This does not say what Kea's own daily charge is — read it off the account "
            "summary, which carries the plan's real daily charge when the account has one."
        ),
        see_also=("low-user-vs-standard", "reading-your-bill"),
    ),
    Article(
        id="reading-your-bill",
        topic="billing",
        title="What the lines on a bill mean",
        asks=(
            "what does this line on my bill mean",
            "explain my bill",
            "what are the charges on my bill",
            "what is the EA levy",
            "why is there GST on my power",
            "what is a metering charge",
        ),
        facts=(
            Fact(
                "A residential bill is normally the daily charge times the days in the "
                "period, plus each unit of electricity used times the unit rate, plus GST.",
                Basis.INDUSTRY,
            ),
            Fact("GST in New Zealand is 15%.", Basis.INDUSTRY, source="Inland Revenue"),
            Fact(
                "A small Electricity Authority levy is charged per unit and appears on "
                "most bills as its own line.",
                Basis.INDUSTRY,
                source="Electricity Authority",
                verify=True,
            ),
            Fact(
                "Electricity lost as heat between the grid and the house is billed to the "
                "customer, so the units charged can be slightly above the units the meter "
                "recorded.",
                Basis.INDUSTRY,
            ),
            Fact(
                "The assistant can break this account's bill change into its drivers — "
                "period length, weather, standing load, price — with the dollars attached "
                "to each.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("daily-fixed-charge", "estimated-reads"),
    ),
    Article(
        id="billing-cycle",
        topic="billing",
        title="Billing periods and why they are not calendar months",
        asks=(
            "when is my bill due",
            "why is my bill for a different number of days",
            "what is my billing period",
            "why was this bill for 34 days",
            "when does my billing cycle start",
        ),
        facts=(
            Fact(
                "Retailers stagger billing cycle days across the month, so a household's "
                "period usually runs from a fixed day to the same day next month rather "
                "than from the 1st.",
                Basis.INDUSTRY,
            ),
            Fact(
                "Periods therefore vary between about 28 and 34 days, and a longer period "
                "is a larger bill for identical daily usage — this is one of the "
                "commonest causes of an unexplained increase.",
                Basis.INDUSTRY,
            ),
            Fact(
                "The account summary carries this household's own period start, period "
                "end, days elapsed, and due date. Use those rather than assuming a month.",
                Basis.PRODUCT,
            ),
        ),
        not_covered="This does not change a due date. Only the team can do that.",
        see_also=("payment-difficulty",),
    ),
    Article(
        id="estimated-reads",
        topic="meters",
        title="Estimated readings and what they do to a bill",
        asks=(
            "what is an estimated read",
            "why does my bill say estimated",
            "is my meter being read",
            "my bill is based on an estimate",
            "why did my bill jump after a real reading",
        ),
        facts=(
            Fact(
                "When a meter cannot be read, the retailer estimates the reading from the "
                "household's own history. The next actual reading corrects the difference, "
                "which is why a catch-up bill can arrive after a run of estimates.",
                Basis.INDUSTRY,
            ),
            Fact(
                "A smart meter normally reports remotely, so estimates on a smart-metered "
                "connection usually mean a communications fault rather than a missed visit.",
                Basis.INDUSTRY,
            ),
            Fact(
                "The account summary reports what percentage of this period was estimated "
                "rather than actually read, and the assistant is required to say so when "
                "quoting a figure derived from estimated data.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("meter-disputes", "reading-your-bill"),
    ),
    Article(
        id="meter-disputes",
        topic="meters",
        title="Challenging a meter reading or a bill",
        asks=(
            "my meter is wrong",
            "I think my bill is wrong",
            "can I dispute my bill",
            "how do I get my meter tested",
            "who do I complain to about my power company",
        ),
        facts=(
            Fact(
                "A customer can ask their retailer to check a reading or test the meter. "
                "The retailer is required to have a complaints process and to tell "
                "customers about it.",
                Basis.REGULATION,
                source="Electricity Authority",
            ),
            Fact(
                "If a complaint cannot be resolved with the retailer, Utilities Disputes "
                "is New Zealand's free, independent dispute resolution scheme for "
                "electricity and gas. Retailers must be members.",
                Basis.REGULATION,
                source="Utilities Disputes Ltd",
            ),
            Fact(
                "The assistant cannot adjudicate a claim about whether a reading is "
                "correct — that is a claim about the world, not about the data — and a "
                "dispute is one of the cases it must hand to a person.",
                Basis.PRODUCT,
            ),
        ),
        not_covered=(
            "This does not tell the customer whether their meter IS wrong. Show them what "
            "the data shows, then hand over."
        ),
        see_also=("estimated-reads", "talk-to-a-person"),
    ),
    # ---------------- payments and hardship ----------------
    Article(
        id="ways-to-pay",
        topic="payments",
        title="Ways to pay, and what each one changes",
        asks=(
            "how do I pay my bill",
            "can I pay weekly",
            "can I pay fortnightly",
            "direct debit",
            "smooth pay",
            "can I pay in instalments",
            "how do I change my payment method",
        ),
        facts=(
            Fact(
                "Retailers commonly offer direct debit, internet banking, card payment, "
                "and a smoothed option that charges an even amount each week or fortnight "
                "and squares up over the year.",
                Basis.INDUSTRY,
            ),
            Fact(
                "Smoothing does not reduce what a household pays over a year — it moves "
                "the winter peak into the summer months. That is often exactly what "
                "somebody wants, and it should be described as what it is.",
                Basis.INDUSTRY,
            ),
            Fact(
                "A prompt-payment discount is applied only when the bill is paid by its "
                "due date, so losing it is a real cost of paying late.",
                Basis.KEA_ILLUSTRATIVE,
            ),
            Fact(
                "The account summary carries this household's current payment method and "
                "balance.",
                Basis.PRODUCT,
            ),
        ),
        not_covered=(
            "The assistant cannot take a payment, set up a direct debit, or change bank "
            "details. Those need the customer's own banking credentials and go through the "
            "team or the payment screen."
        ),
        see_also=("payment-difficulty", "billing-cycle"),
    ),
    Article(
        id="payment-difficulty",
        topic="hardship",
        title="When a bill cannot be paid",
        asks=(
            "I can't pay my bill",
            "can I get an extension",
            "payment arrangement",
            "what help is there with power bills",
            "I'm behind on my power bill",
            "will I get cut off",
        ),
        facts=(
            Fact(
                "Under the Consumer Care Obligations, a retailer that is on notice a "
                "household is having trouble paying has duties towards them — including "
                "working with them on the debt and taking particular care before any "
                "disconnection.",
                Basis.REGULATION,
                source="Electricity Authority",
                verify=True,
            ),
            Fact(
                "Disconnection for non-payment is a last resort with notice requirements "
                "attached, and there are additional protections for medically dependent "
                "consumers.",
                Basis.REGULATION,
                source="Electricity Authority",
                verify=True,
            ),
            Fact(
                "Work and Income may be able to help with an unpaid power bill, and the "
                "Winter Energy Payment is paid automatically to people on certain "
                "benefits and to superannuitants over the colder months.",
                Basis.REGULATION,
                source="Work and Income (MSD)",
                verify=True,
            ),
            Fact(
                "Free budgeting services are available nationally, including through "
                "MoneyTalks and Citizens Advice Bureau.",
                Basis.INDUSTRY,
                source="MoneyTalks / Citizens Advice Bureau",
            ),
            Fact(
                "This conversation is assessed on every turn, and a customer who discloses "
                "difficulty paying is routed to a person rather than answered by the "
                "assistant — the assistant does not negotiate arrangements or give "
                "financial advice.",
                Basis.PRODUCT,
            ),
        ),
        not_covered=(
            "The assistant must NOT quote specific arrangement terms, promise an extension, "
            "or tell a customer they qualify for anything. If somebody says they cannot "
            "pay, that is a handoff — answer any factual question they asked and let the "
            "tier ladder do the rest."
        ),
        see_also=("medically-dependent", "talk-to-a-person"),
    ),
    Article(
        id="medically-dependent",
        topic="hardship",
        title="Medically dependent and vulnerable consumers",
        asks=(
            "I need power for medical equipment",
            "medically dependent",
            "what happens if the power goes off and I need it",
            "am I on the vulnerable register",
            "oxygen concentrator power",
        ),
        facts=(
            Fact(
                "A medically dependent consumer is someone for whom loss of electricity "
                "presents a risk of serious harm. Registration requires supporting "
                "confirmation from a health practitioner and is arranged through the "
                "retailer.",
                Basis.REGULATION,
                source="Electricity Authority",
                verify=True,
            ),
            Fact(
                "Retailers have specific obligations towards medically dependent "
                "consumers, including around disconnection and around keeping contact "
                "details current.",
                Basis.REGULATION,
                source="Electricity Authority",
                verify=True,
            ),
            Fact(
                "Being registered does not guarantee supply — outages and faults still "
                "happen — so a household that depends on electricity is advised to have a "
                "backup plan.",
                Basis.REGULATION,
                source="Electricity Authority",
            ),
            Fact(
                "When an account carries a medical-dependency or vulnerability flag, any "
                "conversation touching payment or supply is watched by a person. A "
                "customer who mentions medical dependence on an account with no flag "
                "raises the same watch, because the duty attaches to being told.",
                Basis.PRODUCT,
            ),
        ),
        not_covered=(
            "The assistant cannot register anybody. Registration needs a health "
            "practitioner's confirmation and goes through the team."
        ),
        see_also=("payment-difficulty", "talk-to-a-person"),
    ),
    # ---------------- plans ----------------
    Article(
        id="low-user-vs-standard",
        topic="plans",
        title="Low user and standard: the two regulated categories",
        asks=(
            "what is a low user plan",
            "should I be on low fixed charge",
            "low user or standard",
            "what is the difference between low user and standard",
            "am I on the right plan",
        ),
        facts=(
            Fact(
                "New Zealand has two regulated residential categories. A low-user plan has "
                "a capped daily charge and a higher unit rate; a standard plan has a higher "
                "daily charge and a lower unit rate.",
                Basis.REGULATION,
                source="Electricity Authority",
            ),
            Fact(
                "Which one is cheaper depends only on how much the household uses. There "
                "is a crossing point in kWh per day: below it the low-user plan wins, above "
                "it the standard plan does.",
                Basis.INDUSTRY,
            ),
            Fact(
                "The low fixed charge regulations are being phased out on a published "
                "schedule, with the capped daily charge rising each year, so the crossing "
                "point moves.",
                Basis.REGULATION,
                source="Electricity Authority",
                verify=True,
            ),
            Fact(
                "The assistant computes the crossing point from the plan rates and "
                "compares it against this household's own average daily usage, and reports "
                "how far from the line they sit.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("switching-plans", "daily-fixed-charge"),
        action=(
            "Call get_plan_options for the real comparison on this household's usage rather "
            "than describing the trade-off in the abstract."
        ),
    ),
    Article(
        id="switching-plans",
        topic="plans",
        title="Changing plan or retailer",
        asks=(
            "how do I change my plan",
            "can I switch plan",
            "how long does switching take",
            "is there a fee to switch",
            "can I compare other power companies",
            "switch retailer",
        ),
        facts=(
            Fact(
                "Switching between retailers in New Zealand runs through the industry "
                "registry and normally completes within a few business days, with no "
                "interruption to supply.",
                Basis.INDUSTRY,
                source="Electricity Authority",
                verify=True,
            ),
            Fact(
                "A fixed-term contract can carry an early termination fee. An open-term "
                "plan normally does not.",
                Basis.INDUSTRY,
            ),
            Fact(
                "Powerswitch, run by Consumer NZ, is a free independent comparison of "
                "retailers across the whole market.",
                Basis.INDUSTRY,
                source="Powerswitch (Consumer NZ)",
            ),
            Fact(
                "Changing plan within the same retailer is usually immediate or takes "
                "effect from the next billing period, and does not involve the registry.",
                Basis.KEA_ILLUSTRATIVE,
            ),
            Fact(
                "The assistant can request a plan change on this account, which is staged "
                "for confirmation rather than applied silently. It compares only the plans "
                "in Kea's own catalogue, not the whole market.",
                Basis.PRODUCT,
            ),
        ),
        not_covered=(
            "The assistant cannot switch a customer to a different RETAILER, and must not "
            "imply it compared the whole market."
        ),
        see_also=("low-user-vs-standard",),
        action="request_plan_change stages a switch between Kea plans for confirmation.",
    ),
    Article(
        id="time-of-use",
        topic="plans",
        title="Time-of-use plans and free-power windows",
        asks=(
            "what is a time of use plan",
            "peak and off peak rates",
            "free power hour",
            "should I run things at night",
            "night rate",
        ),
        facts=(
            Fact(
                "A time-of-use plan charges different rates at different times of day, "
                "typically a high evening peak and a cheaper overnight rate.",
                Basis.INDUSTRY,
            ),
            Fact(
                "It only saves money for a household that can actually move heavy use — "
                "hot water, laundry, an EV — out of the peak. A household that cannot pays "
                "more than it would on a flat rate.",
                Basis.INDUSTRY,
            ),
            Fact(
                "A time-of-use plan cannot be priced honestly from a monthly total; it "
                "needs the household's own peak and off-peak split. Where that split is "
                "not available the assistant reports the plan as unpriceable rather than "
                "estimating it.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("switching-plans", "controlled-load"),
    ),
    Article(
        id="controlled-load",
        topic="meters",
        title="The controlled or ripple circuit",
        asks=(
            "what is controlled load",
            "why is there a second meter reading",
            "ripple control",
            "why does my hot water go off",
            "night store heating",
        ),
        facts=(
            Fact(
                "A controlled circuit is metered separately and can be switched off by the "
                "lines company at times of high demand, in exchange for a lower rate.",
                Basis.INDUSTRY,
            ),
            Fact(
                "In New Zealand that circuit usually carries the hot water cylinder — "
                "usually, not certainly. It can also be night-store heating or an "
                "underfloor system.",
                Basis.INDUSTRY,
            ),
            Fact(
                "Because it is metered separately, the assistant CAN talk about what that "
                "circuit used, unlike the rest of the house. It still may not assert which "
                "appliance is on it.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("appliance-attribution", "time-of-use"),
    ),
    # ---------------- moving, solar ----------------
    Article(
        id="moving-house",
        topic="moving",
        title="Moving in, moving out, closing an account",
        asks=(
            # The bare phrase as well as the sentence: a phrase hit only fires on an exact
            # substring, so "I'm moving house" misses "I am moving house next week" — which
            # then scored level with the daily-charge article on the word "house" alone.
            "moving house",
            "I'm moving house",
            "how do I close my account",
            "how do I transfer my power",
            "final bill",
            "moving out what do I do",
            "how much notice do I need to give",
        ),
        facts=(
            Fact(
                "Moving requires a final reading at the old address and a start reading at "
                "the new one. Retailers normally ask for several working days' notice.",
                Basis.INDUSTRY,
                verify=True,
            ),
            Fact(
                "A property's connection is identified by an ICP number, which appears on "
                "the bill. Quoting it when moving avoids the wrong property being "
                "connected.",
                Basis.INDUSTRY,
            ),
            Fact(
                "A final bill arrives after the move because it needs the closing reading, "
                "so it is normally for a short period and can look unusual.",
                Basis.INDUSTRY,
            ),
            Fact(
                "The account summary carries this connection's ICP number and address.",
                Basis.PRODUCT,
            ),
        ),
        not_covered=(
            "The assistant cannot open, close, or transfer an account. Those change who is "
            "liable for a supply and go through the team."
        ),
        see_also=("talk-to-a-person",),
    ),
    Article(
        id="solar-export",
        topic="solar",
        title="Solar, export and buy-back rates",
        asks=(
            "what do I get paid for solar",
            "buy back rate",
            "why is my export credit low",
            "is solar worth it",
            "do I get paid for the power I generate",
        ),
        facts=(
            Fact(
                "Power exported to the grid earns a buy-back rate set by the retailer, "
                "which is normally well below the rate charged for imported power. "
                "Self-consuming generation is therefore worth more than exporting it.",
                Basis.INDUSTRY,
            ),
            Fact(
                "Buy-back rates vary between retailers and some are time-dependent, so the "
                "best plan for a solar household is not always the one with the highest "
                "headline buy-back.",
                Basis.INDUSTRY,
            ),
            Fact(
                "Export shows on this account's daily rows where the connection has solar, "
                "and the plan comparison prices a solar plan only for a household actually "
                "exporting a meaningful amount.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("switching-plans",),
    ),
    # ---------------- alerts and settings ----------------
    Article(
        id="bill-shock-alerts",
        topic="alerts",
        title="Bill-shock warnings and how they are tuned",
        asks=(
            "how often will kea send warnings",
            "why didn't I get a text",
            "what is a bill shock warning",
            "how do I change my alert threshold",
            "stop texting me",
            "can I get alerts by email",
            "set my warning to 20 percent",
            "turn off notifications",
            "quiet hours",
        ),
        facts=(
            Fact(
                "A bill-shock warning fires when the projected cost of the current cycle "
                "runs far enough over what this household normally spends, on a ladder: "
                "email first, then a text, then a call.",
                Basis.PRODUCT,
            ),
            Fact(
                "The customer sets how far over each channel fires at, and a dollar floor "
                "underneath them all — a percentage alone fires constantly on small bills.",
                Basis.PRODUCT,
            ),
            Fact(
                "How confident the forecast must be before a channel fires is NOT a "
                "customer setting. That floor rises with the tier and is a property of the "
                "model, because a customer who set 'ring me at 10% confidence' would be "
                "rung about bills that never arrive.",
                Basis.PRODUCT,
            ),
            Fact(
                "Voice calls are opt-in rather than opt-out, because an automated call is "
                "the most intrusive thing this product does and the most easily mistaken "
                "for a scam.",
                Basis.PRODUCT,
            ),
            Fact(
                "Quiet hours apply to texts and calls but not to email, which makes no "
                "noise at 3am and forms the written record.",
                Basis.PRODUCT,
            ),
            Fact(
                "The delivery service deduplicates cycle/tier warnings and may send a "
                "later warning when risk qualifies for another tier. An increase "
                "within the same cycle/tier does not resend that warning. "
                "Delivery still needs enabled gateways, destinations and confidence "
                "thresholds. A setting or forecast alone is not evidence of a sent message.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("what-sparky-can-change",),
        action=(
            "update_alert_settings changes any of these on the spot — thresholds per "
            "channel, which channels are on, quiet hours. Do it rather than describing "
            "where the settings screen is."
        ),
    ),
    Article(
        id="what-sparky-can-change",
        topic="account",
        title="What the assistant can change, and what it cannot",
        asks=(
            "can you change my settings",
            "what can you do for me",
            "can you update my account",
            "can you change my plan",
            "can you pay my bill",
        ),
        facts=(
            Fact(
                "The assistant can change alerting: the percentage each channel fires at, "
                "the dollar floor, which channels are on, and quiet hours. These are "
                "reversible preferences and take effect immediately.",
                Basis.PRODUCT,
            ),
            Fact(
                "It can stage a plan change, which is held for the customer to confirm in "
                "the same conversation rather than applied on the strength of one sentence.",
                Basis.PRODUCT,
            ),
            Fact(
                "It cannot take payments, change bank or card details, open or close an "
                "account, transfer a supply, change a due date, register a medical "
                "dependency, or adjust a bill. Every one of those either needs credentials "
                "it must never handle or changes who is liable for something.",
                Basis.PRODUCT,
            ),
            Fact(
                "Anything it changes is scoped to the signed-in household. There is no "
                "argument the model can pass that reaches another account's settings.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("bill-shock-alerts", "switching-plans", "talk-to-a-person"),
    ),
    # ---------------- privacy and the assistant itself ----------------
    Article(
        id="privacy-and-data",
        topic="privacy",
        title="What data is held and what it is used for",
        asks=(
            "what information does sparky use",
            "how does kea protect my information",
            "are my conversations with sparky stored",
            "what data do you have on me",
            "is my data safe",
            "do you train on my conversations",
            "who can see my usage",
            "can I delete my data",
            "privacy",
        ),
        facts=(
            Fact(
                "The Privacy Act gives New Zealanders the right to ask what personal "
                "information an organisation holds about them and to ask for corrections.",
                Basis.REGULATION,
                source="Office of the Privacy Commissioner",
            ),
            Fact(
                "This system reads the signed-in household's meter data, plan, bills and "
                "connection details. Tools use the server's request context; the model "
                "cannot choose a different household. Configured production authentication "
                "checks request ownership. The local prototype is a synthetic demo, "
                "not evidence that a production identity service has been deployed.",
                Basis.PRODUCT,
            ),
            Fact(
                "When database persistence is enabled, conversations and the lookups "
                "behind each answer are recorded for audit. Runtime configuration may "
                "disable persistence. No fixed retention/deletion period is established "
                "by this help corpus; do not promise one or that data is never stored.",
                Basis.PRODUCT,
            ),
            Fact(
                "Account records may hold name, connection address, email and phone. "
                "The assistant's tools deliberately exclude contact email/phone; use "
                "Profile to view them. Do not promise that no personal data is stored.",
                Basis.PRODUCT,
            ),
            Fact(
                "Connected-device energy tools read stored daily observations. Network "
                "discovery is separate and exposes names, not measured consumption. "
                "Do not promise that all device traffic remains on the phone.",
                Basis.PRODUCT,
            ),
        ),
        not_covered=(
            "A formal request to access or delete personal information goes to the team, "
            "not through the assistant."
        ),
        see_also=("talk-to-a-person", "smart-home"),
    ),
    Article(
        id="appliance-attribution",
        topic="assistant",
        title="Why the assistant will not name an appliance",
        asks=(
            "which appliance is using the power",
            "is it my heat pump",
            "what is costing me the most",
            "can you tell what is using my power",
            "is my fridge using too much",
        ),
        facts=(
            Fact(
                "A whole-house meter reads one number for the entire house. Attributing a "
                "change to a particular heat pump, dryer or fridge is invention, however "
                "plausible — this is a property of the data, not a policy.",
                Basis.PRODUCT,
            ),
            Fact(
                "What the meter CAN support is a split by behaviour: the always-on "
                "overnight floor, the part of usage that moves with temperature, the "
                "separately metered controlled circuit, and everything else. The assistant "
                "can give that breakdown with its uncertainty attached.",
                Basis.PRODUCT,
            ),
            Fact(
                "A connected smart device changes this for that device only. If a heat pump "
                "reports its own energy, naming it is reading a label off a measurement "
                "rather than a guess — and everything else in the house stays "
                "unidentifiable.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("smart-home", "controlled-load"),
        action=(
            "get_energy_breakdown gives the honest category split for this household. Use "
            "it instead of refusing outright — 'I can't name the appliance, but here is "
            "where the load actually sits' is the useful answer."
        ),
    ),
    Article(
        id="smart-home",
        topic="assistant",
        title="Connecting smart-home devices",
        asks=(
            "can you see my smart devices",
            "connect google home",
            "apple home kit",
            "can you find my smart plugs",
            "home assistant",
            "matter devices",
        ),
        facts=(
            Fact(
                "Google Home and SmartThings connect through ordinary cloud OAuth. Matter "
                "connects through a local controller the household already owns.",
                Basis.PRODUCT,
            ),
            Fact(
                "Apple HomeKit has no cloud API by design, so it cannot be connected from "
                "a browser. The iOS app reads HomeKit on the phone and sends daily totals; "
                "the raw device stream never leaves the device.",
                Basis.PRODUCT,
            ),
            Fact(
                "The assistant can scan the local network for devices that advertise "
                "themselves, which finds what is there without any account being connected. "
                "Discovery names a device; it does not read its energy.",
                Basis.PRODUCT,
            ),
            Fact(
                "A device that reports its own energy meter is quoted as measured. A device "
                "that reports only runtime is estimated from its nameplate rating and is "
                "always worded as an estimate, because nameplate power is a maximum.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("appliance-attribution", "privacy-and-data"),
        action="discover_smart_devices scans the local network; get_connected_devices reads "
        "what is already linked.",
    ),
    Article(
        id="how-sparky-answers",
        topic="assistant",
        title="How the assistant produces an answer, and when it is wrong",
        asks=(
            "what is sparky ai",
            "what can sparky help me with",
            "how does sparky work",
            "where do sparky's numbers come from",
            "can sparky make mistakes",
            "how do you know that",
            "are you making this up",
            "how accurate are you",
            "can I trust these numbers",
            "where did that number come from",
            "are you a real person",
        ),
        facts=(
            Fact(
                "Every figure comes from a lookup against this household's own data, and "
                "each lookup is recorded alongside the answer with the source it read.",
                Basis.PRODUCT,
            ),
            Fact(
                "Projections are projections. They carry a prediction interval, and the "
                "assistant is required to quote the range rather than the single figure "
                "when the interval is wide.",
                Basis.PRODUCT,
            ),
            Fact(
                "Where a lookup returns nothing, that is the answer. The assistant says "
                "what is missing rather than filling the gap with a typical household or a "
                "national average.",
                Basis.PRODUCT,
            ),
            Fact(
                "It is an AI assistant, not a person, and it says so when asked. A customer "
                "can ask for a person at any point.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("talk-to-a-person", "meter-disputes"),
    ),
    Article(
        id="talk-to-a-person",
        topic="account",
        title="Getting a person",
        asks=(
            "I want to speak to someone",
            "can I talk to a human",
            "put me through",
            "customer service",
            "this isn't helping",
        ),
        facts=(
            Fact(
                "A customer can ask for a person at any time. Sparky flags or records "
                "the concern, but this prototype does not deliver the chat to live staff. "
                "Use verified provider contacts on the customer's bill; do not invent "
                "a support address, claim staff received it or promise a callback.",
                Basis.PRODUCT,
            ),
            Fact(
                "Some conversations require human support whether or not they ask: difficulty "
                "paying, a dispute about the bill or the meter, and anything touching "
                "payment or supply on a medically dependent account.",
                Basis.PRODUCT,
            ),
            Fact(
                "A hard question is not a reason to hand over. Where part of a question can "
                "be answered, the assistant answers that part and says plainly which part "
                "it cannot.",
                Basis.PRODUCT,
            ),
        ),
        see_also=("payment-difficulty", "meter-disputes"),
    ),
    Article(
        id="saving-power",
        topic="account",
        title="Reducing a power bill, in order of what actually moves it",
        asks=(
            "how do I lower my bill",
            "how can I save power",
            "what uses the most electricity",
            "tips to reduce my power bill",
            "how do I use less electricity",
        ),
        facts=(
            Fact(
                "In a New Zealand home the largest loads are normally space heating, hot "
                "water, and the always-on background draw. Lighting and standby are real "
                "but small by comparison, so leading with them wastes the customer's "
                "attention.",
                Basis.INDUSTRY,
            ),
            Fact(
                "The always-on overnight floor is the one figure a household can usually "
                "move without noticing, because by definition nobody is using it.",
                Basis.PRODUCT,
            ),
            Fact(
                "Where an increase came from fixed charges or a price change rather than "
                "usage, using less power will not undo it, and saying so is more useful "
                "than a list of tips.",
                Basis.PRODUCT,
            ),
            Fact(
                "EECA's Warmer Kiwi Homes programme offers grants towards insulation and "
                "efficient heaters for eligible households.",
                Basis.REGULATION,
                source="EECA / Warmer Kiwi Homes",
                verify=True,
            ),
        ),
        not_covered=(
            "Generic advice is not the product. Ground every suggestion in this "
            "household's own figures — which day, which load, how many dollars."
        ),
        see_also=("appliance-attribution", "low-user-vs-standard"),
        action=(
            "get_energy_breakdown shows where this household's load actually sits, so the "
            "advice can be about their house rather than about houses."
        ),
    ),
    Article(
        id="outages",
        topic="account",
        title="Power cuts",
        asks=(
            "my power is out",
            "why is my power off",
            "when will the power be back",
            "is there an outage",
            "power cut",
        ),
        facts=(
            Fact(
                "Unplanned outages are handled by the local lines company, not the "
                "retailer. The retailer bills for power; the lines company owns the wires.",
                Basis.INDUSTRY,
            ),
            Fact(
                "A household that depends on electricity for health reasons should have a "
                "backup plan, because registration does not prevent faults.",
                Basis.REGULATION,
                source="Electricity Authority",
            ),
            Fact(
                "get_scheduled_outages reads a linked distributor's source-dated scheduled "
                "notices, with revisions, cancellations and expiry. Missing/stale notices "
                "do not prove there are no outages. The assistant has no live fault feed "
                "and cannot tell whether power is on right now.",
                Basis.PRODUCT,
            ),
        ),
        not_covered=(
            "Do not guess at an outage or a restoration time. Say plainly that this is the "
            "lines company's information and point them to the team or the network's own "
            "outage page."
        ),
        see_also=("medically-dependent", "talk-to-a-person"),
    ),
    Article(
        id="bill-uploads", topic="assistant", title="Bill Explainer uploads and estimates",
        asks=(
            "how does the bill explainer work", "what can I upload to the bill explainer",
            "can you read my bill photo", "upload pdf jpg png",
            "is my projected bill the same as my final bill",
        ),
        facts=(
            Fact("The Bill Explainer accepts a readable electricity bill as PDF, JPG or PNG. "
                 "A text chat does not automatically receive an attachment or read a file "
                 "from the user's device; use the app's Bill Explainer upload flow.",
                 Basis.PRODUCT),
            Fact("Uploaded bill extraction can be incomplete. Verify the extracted period, "
                 "charges and total against the original document before relying on them. "
                 "Do not invent an unreadable charge or attribute it to an appliance.",
                 Basis.PRODUCT),
            Fact("Forecasts estimate the remaining period from available usage and pricing. "
                 "The issued invoice remains the record of what is owed; forecasts and "
                 "plan comparisons do not replace it.", Basis.PRODUCT),
        ),
        not_covered="No tool reads plain-chat attachments or retrieves a downloadable invoice.",
        see_also=("reading-your-bill", "how-sparky-answers"),
    ),
    Article(
        id="power-clash", topic="assistant", title="Power Clash missions and reward evidence",
        asks=(
            "how do I earn xp", "what are my points", "power clash", "complete my quest",
            "why didn't I get points", "are rewards money",
            "which flexible energy task could I move off peak",
        ),
        facts=(
            Fact("get_power_clash_progress reads the household's mission list and action ledger. "
                 "Planning a mission in the app earns planning XP; verified XP requires an "
                 "accepted device-provider receipt. Asking Sparky is not a verified action.",
                 Basis.PRODUCT),
            Fact("XP has no cash value. Estimated shift savings use measured shifted kWh and "
                 "the receipt's peak/off-peak rate difference; they are not causal evidence "
                 "that the total bill fell. Sparky cannot mint points or redeem them.",
                 Basis.PRODUCT),
            Fact("Choose a flexible task the customer can safely delay, such as a dishwasher "
                 "cycle or EV charge. Ask about their routine and actual tariff. Do not "
                 "delay essential medical equipment, compromise comfort or claim an "
                 "unmetered task has a measured saving.", Basis.PRODUCT),
        ),
        see_also=("time-of-use", "saving-power", "smart-home"),
    ),
    Article(
        id="ev-solar-battery", topic="assistant", title="EV charging, solar and battery evidence",
        asks=(
            "help me plan ev charging", "is my car charging", "charge before I leave",
            "my battery target", "how much solar did I generate", "is the battery full",
            "why is the energy flow moving", "what is grid import export",
        ),
        facts=(
            Fact("The API's home-energy view contains dated import/export and connected-device "
                 "observations, not live household power. Daily kWh is not current kW. "
                 "No Sparky tool starts/stops a charger or changes a battery controller.",
                 Basis.PRODUCT),
            Fact("An export meter measures energy sent to the grid, not all solar generation. "
                 "A mapped generation sensor is needed for generation, a battery sensor "
                 "for charge level and fresh charger telemetry for charging status.",
                 Basis.PRODUCT),
            Fact("A personal charging schedule needs the actual contracted time windows/rates, "
                 "departure time, current/target charge and usable capacity/charger power. "
                 "Catalogue rates are offers, not proof of those contracted values. "
                 "A planning suggestion must label unknown constraints.", Basis.PRODUCT),
        ),
        see_also=("solar-export", "time-of-use", "smart-home", "power-clash"),
    ),
)


BY_ID: dict[str, Article] = {a.id: a for a in ARTICLES}
