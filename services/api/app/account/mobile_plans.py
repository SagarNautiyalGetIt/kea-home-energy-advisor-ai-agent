"""Read-only mobile plan catalogue from Kea's published pricing source."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.analytics import plans
from app.analytics.account import AccountContext


class MobilePricingStyle(BaseModel):
    id: str
    name: str
    eyebrow: str
    rate: str
    daily: str
    best_for: str
    highlights: list[str]


class MobileCommitmentTerm(BaseModel):
    id: str
    name: str
    price_treatment: str
    monthly_credit: str
    credit_note: str
    total_credit: str
    early_exit_fee: str


class MobileCurrentPlan(BaseModel):
    pricing_style: str | None = None
    term: str | None = None


class MobilePlansView(BaseModel):
    pricing_styles: list[MobilePricingStyle]
    commitment_terms: list[MobileCommitmentTerm]
    current_plan: MobileCurrentPlan
    change_requests_available: bool = False
    limitation: str = Field(
        default=(
            "Plan switches are not available in the mobile API. "
            "Contact Customer Care to change plans."
        )
    )


TERMS = [
    MobileCommitmentTerm(
        id="flexible",
        name="Flexible",
        price_treatment="Rates may change with notice",
        monthly_credit="No credit",
        credit_note="No fixed term",
        total_credit="$0",
        early_exit_fee="No exit fee",
    ),
    MobileCommitmentTerm(
        id="6-months",
        name="6 months",
        price_treatment="Rates locked for 6 months",
        monthly_credit="$10",
        credit_note="$10 credit each month for 6 months",
        total_credit="$60",
        early_exit_fee="Up to $50",
    ),
    MobileCommitmentTerm(
        id="12-months",
        name="12 months",
        price_treatment="Rates locked for 12 months",
        monthly_credit="$25",
        credit_note="$25 credit each month for 12 months",
        total_credit="$300",
        early_exit_fee="Up to $100",
    ),
]


def _rate(plan: plans.PlanShape) -> str:
    if plan.off_peak_rate_nzd is not None and plan.night_rate_nzd is not None:
        return (
            f"${plan.unit_rate_nzd:.3f} peak / "
            f"${plan.off_peak_rate_nzd:.3f} off-peak / "
            f"${plan.night_rate_nzd:.3f} night"
        )
    if plan.free_weekend_window is not None:
        return f"${plan.unit_rate_nzd:.3f}/kWh outside free hours"
    return f"${plan.unit_rate_nzd:.3f}/kWh"


def mobile_plans(account: AccountContext | None) -> MobilePlansView:
    styles = [
        MobilePricingStyle(
            id=plan.code.replace("_", "-"),
            name=plan.name,
            eyebrow={
                "anytime": "One rate, all day",
                "time_of_use": "Cheaper away from peak",
                "free_weekends": "16 free hours weekly",
            }[plan.code],
            rate=_rate(plan),
            daily=f"${plan.daily_fixed_nzd:.2f}/day",
            best_for=plan.suits,
            highlights={
                "anytime": ["Same rate day and night", "Predictable pricing"],
                "time_of_use": ["Peak 7–11am and 5–9pm", "Lower overnight rate"],
                "free_weekends": ["Free Sat and Sun 9am–5pm", "Daily charge still applies"],
            }[plan.code],
        )
        for plan in plans.CATALOGUE
    ]
    current = MobileCurrentPlan()
    if account and account.plan:
        matched = next(
            (
                plan
                for plan in plans.CATALOGUE
                if account.plan.code == plan.code or account.plan.name == plan.name
            ),
            None,
        )
        if matched:
            current.pricing_style = matched.code.replace("_", "-")
            current.term = {0: "flexible", 6: "6-months", 12: "12-months"}.get(
                account.plan.term_months
            )
    return MobilePlansView(pricing_styles=styles, commitment_terms=TERMS, current_plan=current)
