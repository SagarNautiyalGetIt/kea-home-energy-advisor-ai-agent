"""Demo sign-in. **Not authentication** — read this before wiring it to anything real.

## What this is

Fourteen synthetic identities, each mapped to one household or fixture account, so the
team can open the app as different customers and see genuinely different data. That is
the whole job: the previous login validated the *shape* of an email and the *length* of
a password, accepted literally anything, and always showed the same household.

## What this is not

There is no user table, no registration, no session expiry, no rate limit, and the
passwords are constants in this file. That is deliberate and it is safe **only** because
every account behind it is fabricated — the names, the meters and the usage are all
seeded fixtures, and none of them belongs to a person.

Three properties keep it from quietly becoming load-bearing:

1. `KEA_DEMO_LOGINS` gates it, and it is **off** unless set. A deployment that forgets
   to set it gets 503 from `/api/auth/login`, not an open door.
2. Passwords are compared with `secrets.compare_digest`, so this file cannot teach
   anyone the timing-unsafe habit even though the threat model here is empty.
3. The plaintext lives here rather than in a database, so there is no migration path
   that would carry it into a real environment by accident.

**Before this touches a real customer:** delete it. Do not "harden" it — a real system
needs a user table, hashed credentials with a real KDF, and a session store, and none of
those are edits to this module.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass


@dataclass(frozen=True)
class DemoAccount:
    """One sign-in, and the household it opens."""

    email: str
    password: str
    customer_id: str
    display_name: str
    #: One line on what this account is for, shown on the credentials card so a tester
    #: can pick the account that exercises what they are trying to look at.
    scenario: str


#: The five hand-shaped households every intent is calibrated against, then Harvey's
#: nine fixture accounts from the `elt` data platform. Both are reachable because
#: `CompositeRepository` searches `public.*` first and `kea.*` second.
DEMO_ACCOUNTS: tuple[DemoAccount, ...] = (
    # ── the demo households (public.*, seeded by `make api-seed`) ───────────────
    # These carry no name in the database — `Customer` deliberately holds none, because
    # 47.6% of surveyed customers said they would not trust an AI with their data. The
    # names here are demo labels only and are never written back.
    DemoAccount("july@kea.example", "julyhouse24", "H-JUL", "July Household",
                "High standing load — the flagship 'why is my bill high' case."),
    DemoAccount("cold@kea.example", "coldsnap24", "H-COLD", "Cold Snap Household",
                "Cold-snap driven, not behaviour. Trips the bill-shock warning at day 6."),
    DemoAccount("spike@kea.example", "spikeday24", "H-SPIKE", "Spike Household",
                "One genuine behavioural spike — good for 'which day was highest'."),
    DemoAccount("drop@kea.example", "hardship24", "H-DROP", "Usage Collapse Household",
                "The hardship signal. Escalates to a human."),
    DemoAccount("tariff@kea.example", "lowfixed24", "H-TARIFF", "Low User Household",
                "Low steady user, better off on another plan. Exercises the tariff check."),
    # Person-named rather than "X Household", because these two are for sitting in
    # front of the app as a customer rather than driving a demo line. Same rule as
    # above holds: the name is a label here and is never written to `Customer`.
    DemoAccount("zara@kea.example", "steady24", "H-ZARA", "Zara Duncan",
                "Nothing is wrong. The account to check the agent doesn't invent a cause."),
    DemoAccount("aroha@kea.example", "climbing24", "H-AROHA", "Aroha Fraser",
                "Usage drifts up all month with no alarming day. Trips the forecast, not a spike."),
    # ── Harvey's fixture accounts (kea.*, loaded by `make data-load`) ───────────
    # Name and account number both come straight from kea.mart_account_context, so the
    # person you sign in as is the person the account belongs to.
    DemoAccount("julia@kea.example", "invoice24", "DEMO-ACCT-221001", "Julia Fox",
                "The printed-invoice fixture — August 2024."),
    DemoAccount("ana@kea.example", "fullhouse24", "DEMO-ACCT-222001", "Ana Whitiora",
                "Bill up because the house filled up."),
    DemoAccount("tama@kea.example", "coldbill24", "DEMO-ACCT-223001", "Tama Rewiri",
                "Bill up on a cold snap — four months of history."),
    DemoAccount("mere@kea.example", "faulty24", "DEMO-ACCT-224001", "Mere Kahu",
                "A cylinder element stuck on — shows up in base load, not behaviour."),
    DemoAccount("josh@kea.example", "newappliance24", "DEMO-ACCT-225001", "Josh Fuller",
                "A new appliance added mid-period."),
    DemoAccount("priya@kea.example", "estimated24", "DEMO-ACCT-226001", "Priya Raman",
                "Estimated reads — the explainer must hedge rather than assert."),
    DemoAccount("daniel@kea.example", "longer24", "DEMO-ACCT-227001", "Daniel Okafor",
                "A longer billing period, not more usage. The classic false alarm."),
    DemoAccount("rangi@kea.example", "history24", "DEMO-ACCT-228001", "Rangi Paterson",
                "Thirteen months of history — the deepest account in the set."),
    DemoAccount("mereana@kea.example", "forecast24", "DEMO-ACCT-229001", "Mereana Tipene",
                "Mid-cycle, no bill issued yet. The forecast case."),
)

_BY_EMAIL = {a.email.lower(): a for a in DEMO_ACCOUNTS}


def authenticate(email: str, password: str) -> DemoAccount | None:
    """The account, or None. Never says which half was wrong.

    `compare_digest` rather than `==` — the threat model here is empty, but a
    string-compare on a credential is a habit worth not writing down.
    """
    account = _BY_EMAIL.get(email.strip().lower())
    if account is None:
        # Compare anyway so a missing address and a wrong password cost the same time.
        secrets.compare_digest(password, "no-such-account")
        return None
    if not secrets.compare_digest(password, account.password):
        return None
    return account
