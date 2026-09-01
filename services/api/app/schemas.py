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


class HouseholdSummary(BaseModel):
    """Shape the frontend charts against. Fixture-backed until Day 2."""

    customer_id: str
    label: str
    period: str
    daily_kwh: list[float]
    total_kwh: float
    estimated_cost_nzd: float
