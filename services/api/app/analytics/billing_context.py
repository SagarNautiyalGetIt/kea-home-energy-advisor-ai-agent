"""Shared pure billing-cycle inputs for the dashboard and assistant assessment."""

from app.analytics.forecast import own_cycle_costs
from app.analytics.repository import UsageContext

DEFAULT_CYCLE_DAYS = 31


def cycle_days(ctx: UsageContext) -> int:
    billing = ctx.account.billing if ctx.account else None
    if billing and billing.current_period_start and billing.current_period_end:
        span = (billing.current_period_end - billing.current_period_start).days + 1
        if span > 0:
            return max(span, len(ctx.window.daily_kwh))
    return max(DEFAULT_CYCLE_DAYS, len(ctx.window.daily_kwh))


def own_history(ctx: UsageContext) -> tuple[list[float], float | None]:
    account = ctx.account
    if account is None or not account.days:
        return [], None
    start = account.billing.current_period_start if account.billing else None
    return own_cycle_costs(
        [(day.date, day.import_kwh) for day in account.days],
        unit_price_nzd=ctx.window.unit_price_nzd,
        current_cycle_start=start,
    )
