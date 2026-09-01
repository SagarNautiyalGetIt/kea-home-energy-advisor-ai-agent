"""The contract every layer speaks.

The FactBundle is the spine of the whole system. Layer 1 (analytics) produces it,
layer 2 (narration) is given nothing else, and layer 3 (verification) checks the
model's prose against it. If a number is not in here, it must not reach the user.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class Intent(StrEnum):
    """The questions we handle. Layer 0 maps free text onto exactly one of these.

    Adding an intent means adding: a router rule, an analytics path, a narration
    prompt, and golden-set cases. Don't add one without all four.
    """

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
        return [f.value for f in self.facts]

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
        description="above_comparable_homes | rising_within_cycle. Empty when not triggered.",
    )

    days_elapsed: int
    days_in_cycle: int
    days_remaining: int = Field(
        description="What makes this actionable rather than just bad news."
    )

    usage_so_far_kwh: float
    cost_so_far_nzd: float
    projected_cycle_cost_nzd: float
    comparable_home_cost_nzd: float
    overshoot_nzd: float
    overshoot_pct: float
    recent_trend_pct: float

    facts: list[Fact] = Field(
        default_factory=list,
        description="The same computed facts the narration is limited to, so the UI and "
        "the assistant can never disagree about a figure.",
    )
    caveats: list[str] = Field(default_factory=list)

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
