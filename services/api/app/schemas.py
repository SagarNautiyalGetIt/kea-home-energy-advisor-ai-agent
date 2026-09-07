"""The contract every layer speaks.

The FactBundle is the spine of the whole system. Layer 1 (analytics) produces it,
layer 2 (narration) is given nothing else, and layer 3 (verification) checks the
model's prose against it. If a number is not in here, it must not reach the user.
"""

from __future__ import annotations

import datetime as dt
from enum import StrEnum

from pydantic import BaseModel, Field

# clarify.schemas imports nothing from the app — see app/clarify/schemas.py and
# tests/test_import_graph.py. That is what lets the question be typed here rather than
# being smuggled through as `object`.
from app.clarify.schemas import ClarifyingQuestion


class Intent(StrEnum):
    """The questions we handle. Layer 0 maps free text onto exactly one of these.

    Adding an intent means adding: a router entry, an analytics path, a narration
    prompt, and golden-set cases. Don't add one without all four.

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

    def render_for_prompt(self) -> str:
        """The only representation of data the model ever sees."""
        lines = [f"Period: {self.period}"]
        lines += [f"- {f.label}: {f.display}" for f in self.facts]
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
    """Layer 3's output. This is the evidence behind the pitch — log every one."""

    passed: bool
    checked: list[str] = Field(default_factory=list, description="numeric tokens in the draft")
    unverified: list[str] = Field(default_factory=list, description="tokens with no matching fact")
    derived: list[str] = Field(
        default_factory=list,
        description=(
            "Computed *relationships* stated without a number — 'twice as much', 'half "
            "your bill', 'a third of the increase'. These contain no numeric token, so a "
            "token-by-token check passes them, but each one is a division the model "
            "performed. Reported separately from `unverified` because they are a "
            "different failure: not a wrong figure, an unauthorised calculation."
        ),
    )
    regenerated: bool = False
    fell_back_to_template: bool = False
    provider_error: bool = Field(
        default=False,
        description=(
            "True when the template was served because the model was unreachable, as "
            "distinct from the number-checker rejecting its drafts. Without this the "
            "two fallback paths are indistinguishable, and this report is what "
            "'N answers, 0 fabricated figures' is counted from — a day Ollama was down "
            "would otherwise read as a day the checker caught six fabrications, which "
            "is the opposite claim and a flattering one."
        ),
    )


class ChatResponse(BaseModel):
    customer_id: str
    intent: Intent
    text: str
    facts: list[Fact]
    verification: VerificationReport
    escalate_to_human: bool = False
    conversation_id: int | None = Field(
        default=None,
        description=(
            "Send this back on the next message to keep the thread together. Null when "
            "persistence is off — there is no conversation to continue."
        ),
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
