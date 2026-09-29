# Security & data handling

Team HAKAS · Kea Energy Scenario 10

This is a university project, but it models a real regulated domain — electricity
retail, hardship detection, and household consumption data. We hold ourselves to
the standard the domain implies.

---

## 1. What must never enter this repository

| Never commit | Why |
|---|---|
| `.env` files, API keys, tokens, passwords | trivially scraped; rotating them is painful |
| AWS credentials of any kind | the org account is shared and billable |
| Real customer names, addresses, ICP numbers, or contact details | privacy, and NZ Privacy Act 2020 |
| Raw survey responses containing respondent identities | the survey was consented for analysis, not publication |
| Anything belonging to another project or vault | see the absolute rule in `CONTRIBUTING.md` |

All demo households in this repo are **synthetic**. `app/db/seed.py` generates
them. The July 2026 consumption figures are measured from a *published* chart on
one team member's own bill and carry no identifying detail.

---

## 2. Secrets management

- Local: `.env`, gitignored. Copy from `.env.example`.
- CI: GitHub Actions secrets — Settings → Secrets and variables → Actions.
- Never paste a secret into an issue, a PR comment, or a Slack/Discord message.

**If a secret is committed by accident:** rotate it first, then tell the maintainer.
Deleting the commit does not help — it is already in the fork/clone of anyone who pulled.

---

## 3. Automated protection

This repository has GitHub **secret scanning** and **push protection** enabled.
If push protection blocks your push, it is doing its job — do not bypass it.
Remove the secret, rotate it, and push again.

Dependabot alerts are enabled. Security updates get priority over feature cards.

---

## 4. PII in the product itself

The current app is a **synthetic-data prototype**. It has demo login labels,
but no production session or household-authorization boundary. Do not connect
real customer data or expose the API as a production customer service until
authentication, authorization, login rate limits, and data-deletion handling
are implemented and independently reviewed.

The AI pipeline limits what the model receives:

- The offline design uses a `FactBundle` (`app/schemas.py`) of computed facts.
- The online agent uses typed tools to retrieve household-scoped facts. This
  scope is bound to a demo customer ID, not a production identity claim.
- Raw readings are handled in Python (`app/analytics/`) and the database; do
  not send raw meter series or personal identifiers to a model provider.
- Conversation turns are persisted for the evidence trail. Treat the `turn`,
  `conversation`, and `escalation` tables as sensitive if ever populated with
  real data.

The mobile client does not grant local sign-in when the API rejects credentials
or is unreachable. API responses set `nosniff`, frame denial, and a restrictive
API content policy; HTTPS responses also set HSTS. Local demo passwords in
`app/auth.py` are public synthetic test credentials, not production secrets.

See [ADR-0011](docs/adr/0011-agentic-tool-use.md) for the online agent design.

---

## 5. Hardship and duty of care

Under the Electricity Authority Consumer Care Obligations Part 6, **cl. 9.3(c)**,
significant consumption changes trigger retailer duties. The agent must escalate
to a human on any hardship signal and must never counsel someone in financial
distress. This is a safety requirement, not a feature — regressions here are
treated as incidents.

---

## 6. Reporting

Found a security or privacy problem? Open a **private** issue or message the
maintainer directly. Do not open a public issue describing an exploitable flaw.
