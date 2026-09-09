"""What the assistant can change, as opposed to what it can read.

    settings.py   alerting preferences — applied immediately, reversible
    changes.py    plan switches — staged, confirmed, recorded for a person

Kept out of `agent/tools.py` deliberately. Every tool in that module is a read: safe to
call twice, safe to call speculatively, safe to retry after a timeout. Nothing in this
package is, and that difference is invisible at the call site — so it is a package boundary
rather than a naming convention, because otherwise somebody adds a write tool to whichever
file happens to be open.

## The line between "just do it" and "ask first"

Applied immediately: thresholds, channel toggles, quiet hours, the dollar floor. All of
them are preferences the customer could change on the Settings screen, all of them are
reversible in one more sentence, and putting a confirmation in front of them would teach
the customer to say yes to confirmations — which is precisely how the one confirmation that
matters gets waved through.

Confirmed first: a plan change. It is the only thing here that costs money if it is wrong,
and it is the only thing here a customer cannot simply undo by asking again.

Refused entirely: payments, bank and card details, opening or closing an account,
transferring a supply, moving a due date, registering a medical dependency, adjusting a
bill. Each either needs a credential the assistant must never handle, or changes who is
liable for something — which is not a thing to do on the strength of one sentence in a chat
window. The customer-facing version of this list is in
`app/knowledge/articles.py:what-sparky-can-change`, and the two are meant to agree.
"""

from app.account.changes import (
    ChangeStore,
    PendingChanges,
    PlanChangeRequest,
    Staged,
    build_change_store,
)
from app.account.settings import (
    CHANNEL_FIELDS,
    FieldChange,
    SettingsError,
    build,
    ladder_after,
)

__all__ = [
    "CHANNEL_FIELDS",
    "ChangeStore",
    "FieldChange",
    "PendingChanges",
    "PlanChangeRequest",
    "SettingsError",
    "Staged",
    "build",
    "build_change_store",
    "ladder_after",
]
