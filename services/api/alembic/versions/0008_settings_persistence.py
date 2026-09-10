"""Two Settings controls that were never saved anywhere.

`app.alert_preference` already stores every threshold, every channel and the offline-model
opt-in. Two switches on the same screen were not in it, and lived in React state instead:

* **Bill reminders.** The Settings screen offered a switch the alerting engine never
  heard. A customer could turn reminders off, watch the toggle move, and change nothing —
  the same class of failure the threshold sliders had before they were moved server-side,
  and the one the note at the top of `app/alerts/preferences.py` exists to warn about.
* **Theme.** Kept in `localStorage`, so it had to be set again on every device and was
  lost whenever the browser was cleared.

Both default to what the screen already showed — reminders on, light theme — so no
existing customer sees a change from this migration. `NOT NULL` with a server default is
therefore safe on a populated table and no backfill is needed.

Theme is appearance rather than contact, which makes `alert_preference` an imperfect home
for it. It goes here anyway rather than into a new one-row-per-customer table: it is the
same shape of thing — a per-customer choice the client fetches once on load — and the
mobile app already reads this row on launch, so a second table would be a second request
to answer the same question. The table name is the thing that has aged, not the decision.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0008_settings_persistence"
down_revision: str | None = "0007_plan_change_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "alert_preference",
        sa.Column(
            "bill_reminders",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        schema="app",
    )
    op.add_column(
        "alert_preference",
        sa.Column(
            "theme",
            sa.String(length=16),
            nullable=False,
            server_default="light",
        ),
        schema="app",
    )
    # Only `light` and `dark` are rendered. A third value would fall through to the
    # light stylesheet silently, so the database refuses it rather than letting a typo
    # in a client become a theme nobody can see.
    op.create_check_constraint(
        "ck_alert_preference_theme",
        "alert_preference",
        "theme IN ('light', 'dark')",
        schema="app",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_alert_preference_theme", "alert_preference", schema="app", type_="check"
    )
    op.drop_column("alert_preference", "theme", schema="app")
    op.drop_column("alert_preference", "bill_reminders", schema="app")
