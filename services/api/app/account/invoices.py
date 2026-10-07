"""Issued invoices, read through an explicit serving view; no inferred payments."""

import datetime as dt
import os

from sqlalchemy import text

from app.config import settings
from app.schemas import BillingChargeLine, BillingInvoice


async def history(customer_id: str) -> list[BillingInvoice] | None:
    if not settings.persist:
        return None
    from app.db.session import get_sessionmaker

    as_of = (
        dt.date.fromisoformat(os.environ["KEA_AS_OF"]) if os.getenv("KEA_AS_OF") else dt.date.max
    )

    async with get_sessionmaker()() as session:
        exists = await session.scalar(text("SELECT to_regclass('app.invoice_history')"))
        if not exists:
            return None
        rows = (
            (
                await session.execute(
                    text("""
          SELECT * FROM app.invoice_history WHERE account_number=:account AND issue_date<=:as_of
          ORDER BY issue_date DESC, invoice_number DESC
        """),
                    {"account": customer_id, "as_of": as_of},
                )
            )
            .mappings()
            .all()
        )
    return [invoice_from_record(row, as_of) for row in rows]


def invoice_from_record(row, as_of: dt.date) -> BillingInvoice:
    cutoff = min(as_of, row["available_to"])
    paid = sum(
        float(item["amount"])
        for item in row["payments"]
        if dt.date.fromisoformat(item["paid_on"]) <= cutoff
    )
    due = max(0, round(float(row["total_charges"]) - paid, 2))
    return BillingInvoice(
        id=row["invoice_number"],
        issued=row["issue_date"],
        period=f"{row['period_start']} – {row['period_end']}",
        days=row["period_days"],
        due=row["due_date"],
        amount=float(row["total_charges"]),
        amount_due=due,
        status="Paid" if due <= 0 else "Due",
        gst=float(row["gst_amount"]),
        charge_lines=[
            BillingChargeLine(label="Charges excluding GST", amount=float(row["charges_excl_gst"])),
            BillingChargeLine(label="GST", amount=float(row["gst_amount"])),
        ],
    )
