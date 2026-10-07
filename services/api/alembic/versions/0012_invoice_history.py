"""Read-only invoice history boundary over the existing serving replica."""
from alembic import op

revision = "0012_invoice_history"
down_revision = "0011_client_state"
branch_labels = None
depends_on = None


def upgrade():
    # Local public.* seed databases do not carry the serving billing schemas.
    op.execute("""
    DO $$ BEGIN
      IF to_regclass('billing.bill') IS NOT NULL AND to_regclass('kea.mart_daily_usage') IS NOT NULL THEN
        EXECUTE $view$
        CREATE VIEW app.invoice_history WITH (security_barrier=true) AS
        SELECT a.account_number, b.invoice_number, b.issue_date, b.period_start,
          b.period_end, b.period_days, b.total_charges, b.due_date, b.gst_amount,
          b.charges_excl_gst, b.status::text AS source_status,
          coalesce((SELECT jsonb_agg(jsonb_build_object('paid_on',
            (p.paid_at AT TIME ZONE 'Pacific/Auckland')::date, 'amount', p.amount))
            FROM billing.payment p WHERE p.bill_id=b.bill_id AND NOT p.is_failed), '[]') AS payments,
          d.available_to
        FROM billing.bill b JOIN billing.account a ON a.account_id=b.account_id
        JOIN LATERAL (SELECT max(usage_date) AS available_to FROM kea.mart_daily_usage
          WHERE icp_id=a.icp_id) d ON d.available_to IS NOT NULL
        WHERE b.issue_date <= d.available_to AND b.status::text NOT IN ('draft','cancelled')
        $view$;
      END IF;
    END $$;
    """)


def downgrade():
    op.execute("DROP VIEW IF EXISTS app.invoice_history")
