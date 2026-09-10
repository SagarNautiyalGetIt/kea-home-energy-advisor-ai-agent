"""The contract every layer speaks.

The FactBundle is the spine of the whole system. Layer 1 (analytics) produces it,
layer 2 (narration) is given nothing else, and layer 3 (verification) checks the
model's prose against it. If a number is not in here, it must not reach the user.
"""

from __future__ import annotations

import datetime as dt
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

# clarify.schemas imports nothing from the app — see app/clarify/schemas.py and
# tests/test_import_graph.py. That is what lets the question be typed here rather than
# being smuggled through as `object`.
from app.clarify.schemas import ClarifyingQuestion


class Intent(StrEnum):
    """A closed set of pre-computable questions. **Offline and bill-shock only now.**

    This was the spine of the request path: a keyword router mapped free text onto one
    of these, and the intent chose the analytics, the prompt and the caveats. It no
    longer does — the agent reads the question and the data, and nothing classifies a
    customer's message into a bucket before it is understood. See `app/pipeline.py`.

    Two things still use it, both legitimately:

    * `app/offline.py` pre-computes a pack of answers for a device with no connection.
      It has to guess what will be asked, so a fixed list is the only option available.
    * `app/analytics/billshock.py` labels a proactive warning, which nobody asked a
      question to receive.

    Neither is a classifier over customer text.

    ## Two families, and why the second one exists

    The **usage** intents below the divider are the original ten: they all answer a
    question about consumption, and every one of them needs analytics to run first.

    The **account** intents are facts about the customer's own account — balance, plan,
    rates, connection, payment method. They were unroutable before, which meant "what
    plan am I on?" and "when is my bill due?" returned `OUT_OF_SCOPE`. That is a bad
    answer to a question the service can answer perfectly from one mart row, and it is
    a large share of what a real energy assistant is asked.

    They are a separate family rather than more of the same because the layer-3
    contract differs: an account fact is a *lookup*, so its bundle is a copy of stored
    values rather than the output of a computation. Nothing is derived, so nothing can
    be derived wrongly.
    """

    # ── usage: needs analytics ──
    WHY_HIGH = "why_bill_high"
    WHAT_WILL_I_PAY = "what_will_i_pay"
    USING_MORE_THAN_USUAL = "using_more_than_usual"
    WHAT_COSTS_MOST = "what_costs_most"
    PEAK_USAGE = "peak_usage"
    TIME_OF_DAY = "time_of_day"
    COMPARE_TO_LAST_YEAR = "compare_to_last_year"
    TARIFF_CHECK = "tariff_check"
    HARDSHIP = "hardship"
    OUT_OF_SCOPE = "out_of_scope"

    # ── usage: added with the driver decomposition ──
    USAGE_TOTAL = "usage_total"
    """'How much did I use in July?' — a total, not an explanation."""

    COMPARE_TO_SIMILAR = "compare_to_similar"
    """'Am I using more than other people?' — against the peer cohort, explicitly."""

    BILL_BREAKDOWN = "bill_breakdown"
    """'What are all these charges?' — the bill's own lines, itemised."""

    HOW_TO_REDUCE = "how_to_reduce"
    """'What can I do about it?' — advice grounded in this household's own drivers."""

    SOLAR_EXPORT = "solar_export"
    SUPPLY_QUALITY = "supply_quality"
    """'Is this an estimate?' — read quality, gaps and freshness, said out loud."""

    # ── account: a lookup, not a computation ──
    ACCOUNT_BALANCE = "account_balance"
    BILL_DUE = "bill_due"
    PLAN_DETAILS = "plan_details"
    RATE_DETAILS = "rate_details"
    PAYMENT_METHOD = "payment_method"
    ACCOUNT_IDENTITY = "account_identity"
    BILLING_CYCLE = "billing_cycle"

    # ── neither: the answer is a person ──
    DISPUTE = "dispute"
    """'This bill is wrong.' Routes to a human like HARDSHIP does. An AI must not
    adjudicate a billing dispute, and a customer who says the meter is wrong is
    making a claim about the world that no amount of our own data can settle."""

    @property
    def is_account_lookup(self) -> bool:
        return self in _ACCOUNT_LOOKUPS

    @property
    def needs_human(self) -> bool:
        """Escalates regardless of how well we could answer it."""
        return self in (Intent.HARDSHIP, Intent.DISPUTE)


_ACCOUNT_LOOKUPS = frozenset(
    {
        Intent.ACCOUNT_BALANCE,
        Intent.BILL_DUE,
        Intent.PLAN_DETAILS,
        Intent.RATE_DETAILS,
        Intent.PAYMENT_METHOD,
        Intent.ACCOUNT_IDENTITY,
        Intent.BILLING_CYCLE,
    }
)


class Fact(BaseModel):
    """One computed value. Every number the customer ever sees starts life here.

    `display` is the canonical rendering. The narration prompt tells the model to
    copy these strings verbatim rather than formatting numbers itself, which both
    raises pass rate on small models and gives the verifier an exact string to match.
    """

    key: str = Field(description="stable identifier, e.g. 'standing_load_kwh_per_day'")
    value: float
    unit: str = Field(description="kWh | kWh/day | NZD | NZD/year | % | x | days")
    label: str = Field(description="human-readable name for the narrator's benefit")
    display: str = Field(description="pre-formatted string, e.g. '$290' or '2.4 kWh a day'")

    @classmethod
    def money(cls, key: str, value: float, label: str, *, per_year: bool = False) -> Fact:
        whole = abs(value) >= 100
        rendered = f"${value:,.0f}" if whole else f"${value:,.2f}"
        return cls(
            key=key,
            value=round(value, 2),
            unit="NZD/year" if per_year else "NZD",
            label=label,
            display=f"{rendered} a year" if per_year else rendered,
        )

    @classmethod
    def energy(cls, key: str, value: float, label: str, *, per_day: bool = False) -> Fact:
        return cls(
            key=key,
            value=round(value, 2),
            unit="kWh/day" if per_day else "kWh",
            label=label,
            display=f"{value:,.1f} kWh a day" if per_day else f"{value:,.1f} kWh",
        )

    @classmethod
    def ratio(cls, key: str, value: float, label: str) -> Fact:
        return cls(key=key, value=round(value, 2), unit="x", label=label, display=f"{value:.2f}×")

    @classmethod
    def percent(cls, key: str, value: float, label: str) -> Fact:
        return cls(key=key, value=round(value, 1), unit="%", label=label, display=f"{value:.0f}%")

    @classmethod
    def reference(cls, key: str, text: str, label: str) -> Fact:
        """A stored value that is not a quantity — a plan name, an ICP, an address.

        The account-lookup intents are the reason this exists. "Your ICP is
        0160647002LCFCF" and "your bill is due on 15 October 2026" are correct answers
        containing digits that are not *measurements*, and layer 3 rejects them: the
        token pass pulls `0160647002` out of the ICP, finds no fact with that value, and
        marks a verbatim copy of the customer's own connection number as a fabrication.

        `unit="text"` is what tells the verifier to check this fact by **string
        containment against `display` instead of by numeric tolerance**. That is a
        narrower licence than it sounds, and deliberately so: it permits only characters
        the model was handed, so it can copy the ICP and cannot assemble a different one.
        `value` stays 0.0 and never enters `allowed_values()`, so a reference fact can
        never license an unrelated *number* elsewhere in the sentence.
        """
        return cls(key=key, value=0.0, unit="text", label=label, display=text)

    @classmethod
    def on_date(cls, key: str, value: dt.date, label: str) -> Fact:
        """A date, rendered the way a New Zealand bill prints it."""
        return cls.reference(key, f"{value:%-d %B %Y}", label)

    @classmethod
    def duration(cls, key: str, value: int, label: str) -> Fact:
        """A count of days — "21 days", not "day 21".

        Distinct from `day_of_period` because the two read as the same integer and mean
        opposite things: "day 21" points at a date in a period, "21 days" measures a
        span until one. Rendering a countdown with `day_of_period` produced "your bill is
        due in day 21", which is the kind of wrongness that survives review because every
        figure in it is correct.
        """
        n = int(value)
        return cls(
            key=key,
            value=n,
            unit="days",
            label=label,
            display=f"{n} day" if n == 1 else f"{n} days",
        )

    @classmethod
    def day_of_period(cls, key: str, value: int, label: str) -> Fact:
        """A 1-based day number within the period — "day 18 of July 2026".

        Carries the `days` unit rather than being a bare integer so layer 3 treats it as
        a claim. It is one: a wrong day is a wrong answer even though the arithmetic
        around it is right, and `STRUCTURAL_INT_MAX` would otherwise wave through any
        day from 1 to 12 unchecked.
        """
        return cls(key=key, value=int(value), unit="days", label=label, display=f"day {int(value)}")


class FactBundle(BaseModel):
    """Everything layer 2 is allowed to know, and nothing else.

    Deliberately does NOT carry raw meter readings, name, address or account number.
    Layer 1 computes; the model narrates. Keeping PII out of here is both the privacy
    control and — once we move to a hosted model — the prompt-cache boundary.
    """

    customer_id: str
    intent: Intent
    period: str = Field(description="human phrase for the window, e.g. 'July 2026'")
    facts: list[Fact] = Field(default_factory=list)
    caveats: list[str] = Field(
        default_factory=list,
        description=(
            "Claims the narrator must NOT make. Half-hourly data cannot identify an "
            "appliance, so 'do not name an appliance' belongs here on most bundles."
        ),
    )

    def value_index(self) -> dict[str, float]:
        return {f.key: f.value for f in self.facts}

    def allowed_values(self) -> list[float]:
        """Numeric claims the narration may make.

        Reference facts are excluded: their `value` is a placeholder 0.0, and letting it
        into this list would license a bare "0" anywhere in the answer for every bundle
        that happens to carry a plan name.
        """
        return [f.value for f in self.facts if f.unit != "text"]

    def allowed_literals(self) -> list[str]:
        """Verbatim strings the narration was given and may copy — ICPs, plan names,
        dates. Checked by containment rather than by value; see `Fact.reference`."""
        return [f.display for f in self.facts if f.unit == "text"]

    def allowed_displays(self) -> list[str]:
        return [f.display for f in self.facts]

    narration_limit: int | None = Field(
        default=None,
        description=(
            "How many facts the *model* is shown, when that should be fewer than the API "
            "returns. Null means all of them, which is the right default for every bundle "
            "small enough to narrate whole."
        ),
    )
    """Why a bundle would hand the model less than it carries.

    Layer 3 rejects a **whole draft** if any single figure in it is wrong, so the chance
    of a rejection grows with the number of figures on offer, not with their usefulness.
    The driver decomposition made that concrete: it produces up to ten facts where the
    old bill explanation produced five, against a system prompt that asks for two to four
    sentences. A small model handed ten figures and room for four sentences has twice the
    surface area to garble one and lose the entire answer to the template fallback.

    The facts are already ordered by size, so the cheap fix is to show the model the ones
    that carry the answer and keep the rest for the response body — the dashboard wants
    every driver to draw a chart, the sentence does not.

    Note this only ever *narrows* what the model sees. `allowed_values()` stays complete,
    so a figure omitted from the prompt is still accepted if the model somehow produces
    it. That asymmetry is deliberate and safe: withholding an operand cannot cause a
    fabrication, and layer 3's job is to catch invented numbers rather than to police
    which real ones got used.
    """

    def narration_facts(self) -> list[Fact]:
        """The facts the model is shown — the leading `narration_limit`, or all of them."""
        return self.facts if self.narration_limit is None else self.facts[: self.narration_limit]

    def render_for_prompt(self) -> str:
        """The only representation of data the model ever sees."""
        lines = [f"Period: {self.period}"]
        lines += [f"- {f.label}: {f.display}" for f in self.narration_facts()]
        if self.caveats:
            lines.append("You must NOT claim any of the following:")
            lines += [f"- {c}" for c in self.caveats]
        return "\n".join(lines)


# ---------- API surface ----------


class ChatRequest(BaseModel):
    customer_id: str
    message: str
    conversation_id: int | None = Field(
        default=None,
        description=(
            "Continue an existing conversation. Omit on the first message; send back "
            "whatever the previous response returned. Ignored when persistence is off, "
            "and ignored if it belongs to a different customer."
        ),
    )


class VerificationReport(BaseModel):
    """The number-checker's verdict. **Offline only** — see `app/analytics/bundles.py`.

    On-device narration still works the old way: a pre-computed bundle, a small local
    model, and a token-by-token check that every figure in the prose came from the
    bundle. That check is meaningful there because the model was handed a fixed list and
    nothing else, so a figure outside it can only have been invented.

    It is not meaningful for the agent, and this is not a relaxation of standards. The
    agent reads the data itself and is expected to work things out — a bill up 14%, a
    daily load annualised to $263 — so a checker that rejected every figure absent from
    a bundle would reject the arithmetic that makes an explanation an explanation. What
    replaces it is stronger, not weaker: `app.agent_tool_call` records the rows the model
    actually read, so a disputed figure is traced to its source rather than matched
    against a list of permitted values.
    """

    passed: bool
    checked: list[str] = Field(default_factory=list, description="numeric tokens in the draft")
    unverified: list[str] = Field(default_factory=list, description="tokens with no matching fact")
    derived: list[str] = Field(
        default_factory=list,
        description=(
            "Computed *relationships* stated without a number — 'twice as much', 'half "
            "your bill'. These contain no numeric token, so a token-by-token check "
            "passes them, but each one is a division the model performed."
        ),
    )
    regenerated: bool = False
    fell_back_to_template: bool = False
    provider_error: bool = Field(
        default=False,
        description="True when the template was served because the model was unreachable.",
    )


class SourceRef(BaseModel):
    """One lookup the assistant made, for the transparency panel.

    This replaced `facts` on the chat response. The two answer different questions and
    the new one is the question customers were actually asking: `facts` listed the
    figures Python computed *before* the model saw the message, which was the same list
    for everyone who tripped the same keyword. This says what was consulted for *this*
    answer and where each result came from — which is checkable, and is what makes
    "every number traces to a source" a claim rather than a slogan.
    """

    tool: str = Field(description="Which lookup — e.g. 'get_bill_comparison'.")
    arguments: dict | None = Field(
        default=None, description="What it was asked for, when that narrows the result."
    )
    source: str | None = Field(
        default=None,
        description="The table or computation behind it, in words a customer can read.",
    )
    ok: bool = Field(
        default=True,
        description=(
            "False when the lookup failed or the data was not available for this "
            "account. Shown rather than hidden: 'I could not check that' is a different "
            "answer from 'I did not look', and only one of them is honest about a gap."
        ),
    )


class EnergyCategory(BaseModel):
    """One slice of the bill, split by behaviour rather than by appliance.

    `confidence` is the field that decides how this may be presented, and the frontend has
    to honour it as much as the assistant does. `measured` came off a meter. `fitted` came
    off this household's own regression and is an estimate — a chart that renders it
    identically to a measured slice is a chart that overstates what is known. `residual` is
    what is left after the others, so it carries their error and must be labelled as
    everything else rather than as a finding.
    """

    key: str
    label: str
    kwh: float
    cost_nzd: float
    share_pct: float
    confidence: str = Field(description="measured | fitted | residual")
    basis: str = Field(description="How this figure was arrived at, in one clause.")
    caveat: str | None = None


class EnergyBreakdown(BaseModel):
    """Where a household's power goes. See app/analytics/disaggregation.py.

    **This does not identify appliances**, and no surface rendering it may imply otherwise.
    A whole-house meter reads one number for the whole house; the categories here are
    behaviours that are each separately measurable, which is a different claim and the only
    honest one available.
    """

    customer_id: str
    available: bool
    reason: str | None = Field(
        default=None,
        description=(
            "Why there is no breakdown. Null when `available`. A real response the UI must "
            "render — an account with no half-hourly data cannot have its standing load "
            "separated, and the honest screen says so rather than drawing one slice."
        ),
    )

    period: str = ""
    days: int = 0
    total_kwh: float = 0.0
    total_cost_nzd: float = 0.0
    categories: list[EnergyCategory] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)

    heating_fit_r_squared: float | None = Field(
        default=None,
        description=(
            "How much of daily variation the weather explains for this household. Null "
            "when heating was not broken out at all."
        ),
    )
    heating_not_reported_because: str | None = None
    always_on_not_reported_because: str | None = None


class ChatResponse(BaseModel):
    customer_id: str
    text: str
    sources: list[SourceRef] = Field(
        default_factory=list,
        description="Every lookup behind this answer, in the order it was made.",
    )
    escalate_to_human: bool = False
    escalation_reason: str | None = Field(
        default=None,
        description=(
            "Why, in the assistant's own words. Null unless `escalate_to_human`. The "
            "UI should show the handoff, not this string — it is for the transcript and "
            "the escalation row."
        ),
    )
    conversation_id: int | None = Field(
        default=None,
        description=(
            "Send this back on the next message to keep the thread together. Null when "
            "persistence is off — there is no conversation to continue."
        ),
    )
    latency_ms: int = 0

    tier: int = Field(
        default=1,
        description=(
            "Who handled this turn. 1 the assistant alone, 2 the assistant with a Kea "
            "agent watching and able to step in, 3 a person only — the assistant "
            "acknowledges and stops. Decided in Python from the message and the account "
            "on every channel, never by the model; see app/hardship/. The model can "
            "raise it by calling handoff_to_human and can never lower it."
        ),
    )
    tier_reason: str | None = Field(
        default=None,
        description="Why this tier, in words a support lead would use.",
    )

    emotion: str | None = Field(
        default=None,
        description=(
            "How the customer's message read: frustration, anxiety, confusion, distrust, "
            "shame, resignation, urgency or gratitude. Null when nothing was detected, "
            "which is the common case. It changed how the reply was WRITTEN and nothing "
            "else — it is not a tier input and carries no score; see app/hardship/"
            "emotions.py. Intended for the agent console, not for showing back to the "
            "customer: telling somebody 'we detected that you are frustrated' is worse "
            "than simply answering them properly."
        ),
    )
    emotion_intensity: str | None = Field(
        default=None,
        description="mild | moderate | strong. Null whenever `emotion` is.",
    )


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    """Who signed in, and which household to show them.

    Carries no token: the prototype session is `localStorage['kea-demo-session']` and
    there is nothing to sign. `customer_id` is the whole point — it is what every
    subsequent request scopes to, and what made one login show fourteen different
    customers instead of the same one fourteen times.
    """

    customer_id: str
    display_name: str
    scenario: str


class DemoAccountCard(BaseModel):
    """A sign-in the credentials panel can offer. Includes the password, which is only
    acceptable because every account behind it is synthetic — see app/auth.py."""

    email: str
    password: str
    customer_id: str
    display_name: str
    scenario: str


class AlertSummary(BaseModel):
    """What the warning escalated to, reported alongside the warning itself.

    On the response rather than behind its own endpoint because the UI has to show the
    tier next to the figures that produced it, and a second request could return a
    different assessment.

    `sent` is what actually went out — today only `email` can appear in it. `channels`
    is what the tier calls for, so the UI can show the full ladder with the
    not-yet-wired rungs greyed rather than pretending tier 3 does not exist.
    """

    tier: int = Field(description="1 email · 2 sms · 3 voice. 0 when nothing triggered.")
    channels: list[str] = Field(
        default_factory=list, description="Every channel this tier calls for, lowest first."
    )
    sent: list[str] = Field(
        default_factory=list, description="Channels that actually delivered."
    )
    deferred: list[str] = Field(
        default_factory=list,
        description="Eligible, but held until the customer's quiet hours end.",
    )
    confidence: float = Field(
        default=0.0,
        description=(
            "P(the cycle lands above the threshold this tier fired at), 0-1. Shown next "
            "to the warning because it is the honest answer to 'how sure are you' — and "
            "because the tier ladder now escalates on confidence as well as severity."
        ),
    )
    suppressed: bool = False
    detail: str | None = None
    destination: str | None = Field(
        default=None,
        description="Where tier 1 landed — an .eml path under the file backend.",
    )
    already_sent: bool = Field(
        default=False,
        description="True when this cycle and tier were already alerted. The dashboard "
        "polls, so this is the normal steady state, not an error.",
    )


class ForecastSummary(BaseModel):
    """How the projection was produced. On the response because a figure that does not
    carry its method is a figure nobody can check — the weather-normalised and
    straight-line projections disagree by real money on a cold cycle."""

    method: str = Field(description="weather_normalised | straight_line")
    detail: str | None = Field(
        default=None,
        description="The fitted relationship, or why the fit was not usable.",
    )
    cost_p10_nzd: float = Field(description="Low end of the 80% prediction interval.")
    cost_p90_nzd: float = Field(description="High end of the 80% prediction interval.")
    confidence_width_pct: float = Field(
        description="Interval width as a percent of the point estimate. Narrows as the "
        "cycle progresses; this is what stops a phone call on day four."
    )
    base_load_kwh_per_day: float | None = Field(
        default=None, description="Fitted temperature-independent load. Null if not fitted."
    )
    heating_kwh_per_hdd: float | None = Field(
        default=None, description="Fitted kWh per heating degree day. Null if not fitted."
    )
    r_squared: float | None = None


class CauseBreakdown(BaseModel):
    """Where the overshoot came from, in dollars that sum to it exactly.

    `explained` false means the weather regression was not usable and the whole overshoot
    sits in `everyday_load_nzd` unattributed. The UI must not draw a cause chart in that
    state — an unexplained overshoot shown with a confident breakdown is worse than one
    shown with none.
    """

    explained: bool
    weather_nzd: float = 0.0
    higher_use_nzd: float = 0.0
    everyday_load_nzd: float = 0.0
    dominant: str | None = Field(
        default=None,
        description=(
            "weather | behaviour | everyday_load, or null when no single cause accounts "
            "for at least 35% of the overshoot. Null is a real answer: '31/34/35' is a "
            "pie chart pretending to be advice."
        ),
    )


class BillShockWarning(BaseModel):
    """The proactive half of the product.

    Everything else in this API answers a question the customer asked. This one has to
    reach them *before* the bill does, so it is a GET the dashboard polls rather than a
    chat intent — a warning that only appears if you think to ask for it is not a
    warning.

    `triggered` is the only field the UI should branch on. The figures are present either
    way so the dashboard can show a calm "on track" state without a second request.
    """

    customer_id: str
    period: str
    triggered: bool
    reasons: list[str] = Field(
        default_factory=list,
        description=(
            "above_expectation | colder_than_normal | higher_daily_use. Empty when "
            "nothing triggered."
        ),
    )

    days_elapsed: int
    days_in_cycle: int
    days_remaining: int = Field(
        description="What makes this actionable rather than just bad news."
    )

    usage_so_far_kwh: float
    cost_so_far_nzd: float
    projected_cycle_cost_nzd: float
    expected_cost_nzd: float = Field(
        description="What this customer would not be surprised by. See `expectation_basis`."
    )
    expectation_basis: str = Field(
        description=(
            "own_same_period_last_year | own_recent_cycles | comparable_homes. The "
            "honesty control for the whole feature: only the first two license 'more "
            "than you usually pay'. The seeded demo households are on the third, and "
            "the UI must word the comparison accordingly."
        )
    )
    overshoot_nzd: float
    overshoot_pct: float
    recent_trend_pct: float = Field(
        description=(
            "Opening third of the cycle against the closing third. Shown beside the usage "
            "chart. Deliberately NOT a trigger: a rising trend says the cycle is getting "
            "worse, not that it is already expensive."
        )
    )

    forecast: ForecastSummary
    causes: CauseBreakdown

    thresholds_pct: dict[str, float] = Field(
        default_factory=dict,
        description="The customer's own tier thresholds, echoed so the UI can show the "
        "warning against the level they set rather than a hard-coded one.",
    )
    tier_probabilities: dict[str, float] = Field(
        default_factory=dict,
        description="P(the cycle clears each tier's threshold), 0-1, keyed by tier.",
    )

    facts: list[Fact] = Field(
        default_factory=list,
        description="The same computed facts the narration is limited to, so the UI and "
        "the assistant can never disagree about a figure.",
    )
    caveats: list[str] = Field(default_factory=list)

    question: ClarifyingQuestion | None = Field(
        default=None,
        description=(
            "A clarifying question, when layer 1 found a quantified gap it cannot close "
            "on its own — an unexplained step in everyday load, or a weather fit that "
            "would not converge. Null is the common case and the correct default: a "
            "household whose bill is fully explained has nothing to be asked. Answer it "
            "at POST /households/{id}/context/answers. See app/clarify/ for how it is chosen."
        ),
    )

    alert: AlertSummary | None = Field(
        default=None,
        description="What was escalated, if anything. Null when the warning did not trigger.",
    )


class HouseholdSummary(BaseModel):
    """Shape the frontend charts against. Fixture-backed until Day 2."""

    customer_id: str
    label: str
    period: str
    daily_kwh: list[float]
    total_kwh: float
    estimated_cost_nzd: float


class BillAnalysis(BaseModel):
    """A photographed bill, read and priced against Kea.

    Two objects rather than one flattened result, because they have different standings
    and the client must be able to show that. `reading` is what a model saw on a
    photograph — checkable by the person holding it, and wrong in ways our own data
    never is. `comparison` is arithmetic over those numbers, and is exactly as reliable
    as they are.

    Left as free-form dicts on purpose: the shapes are defined and documented by
    `app/bills/`, and restating them here as Pydantic models would be a second
    definition to keep in step for no gain — nothing in this service validates against
    them, and the client renders whichever fields are non-null.
    """

    reading: dict[str, Any]
    comparison: dict[str, Any]


class CustomerProfile(BaseModel):
    """Who the signed-in customer is, for the profile screen.

    Every field below `customer_id` is optional, and the screen shows "Not on file"
    rather than a placeholder for the ones that are missing. That is not defensive
    coding — the seeded `public.*` households genuinely have no address or plan, and a
    profile page that invented one would be showing somebody a detail about themselves
    that nobody holds.

    The page it replaces was hardcoded to "Adela Parkson", so every one of the sixteen
    logins saw the same person's name, address and phone number.
    """

    customer_id: str
    name: str | None = None
    account_number: str | None = None
    address: str | None = None
    email: str | None = None
    phone: str | None = None
    plan_name: str | None = None
    #: `low_user` | `standard`, when the account carries one.
    user_type: str | None = None
    icp_number: str | None = None
    network_name: str | None = None
