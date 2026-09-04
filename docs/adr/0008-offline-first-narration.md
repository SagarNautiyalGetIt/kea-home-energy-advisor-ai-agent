# ADR-0008 — Local models are for customers without a connection, not for us

**Status:** accepted · **Date:** 4 September 2026 · **Sprint:** 3 · **Supersedes part of** [ADR-0005](0005-two-speed-models.md)

## Context

Sprint 2 ran a local model through Ollama, sized to whatever hardware it found — 27B on
the 48 GB M4, 4B on CI. That was right for a laptop demo with no cloud account, and wrong
as an architecture: **the answer a customer gets should not depend on which machine
happened to serve it.**

But "delete the local model" is also wrong, and for a reason the pitch actually cares
about. A rural household on a bad line can reach the app most evenings and not at all
during a storm — which is exactly when a bill-shock warning is worth having. For that
customer, a server-side model is not slow, it is *absent*.

Those are two different problems and Sprint 2 had them conflated into one setting.

## Decision

**Bedrock is the default.** `KEA_PROVIDER` defaults to `bedrock`. Ollama remains, in two
clearly separated roles: local development (`KEA_PROVIDER=ollama`, chosen deliberately),
and a declared server-side fallback (`bedrock+ollama`).

**Nothing falls back automatically.** A chain has to be written out in the environment
variable. This is the load-bearing rule, and it exists because this repository has been
bitten twice by systems that reported success while doing nothing — a recorder that
dropped 9 of 14 accounts while `/health` said `recording: database`, and a `.env` that
nothing read.

A silent model downgrade is worse than either, because the output still looks like an
answer. Gemma 3 4B and Claude Sonnet produce visibly different prose from the same fact
bundle, so an hour where Bedrock was unreachable would be read as *"the model got worse"*
rather than *"we served a different model"*. So: the chain is explicit, `/health` reports
the provider **currently answering** rather than the one configured, and every fallback
logs at WARNING.

**The customer-offline case is a different mechanism entirely.** A household with no
connection cannot reach this API, so a server-side fallback does nothing for them. That
case is `app/offline.py`: the app fetches an **offline pack** while it still has a
connection, and an on-device model narrates from it later.

### The offline pack, and why it does not break the architecture

The rule that governs this system is that the numbers are computed by code and the model
only writes the sentence. An on-device model is the easiest place to lose that: hand a
phone a month of readings and a 1B model and ask "what will my bill be", and you have
asked a small model to do arithmetic — the thing small models are worst at, on the
question where a wrong answer destroys the product's claim.

So the device does not compute either. The pack carries **fact bundles the server already
computed**, one per supported intent. Offline, the phone does what the server does minus
layer 1:

| layer | on the server | on the phone, offline |
|---|---|---|
| 0 routing | Python rules | the same rules, ~2 KB of regex |
| 1 analytics | computed per request | **looked up** in the pack — a dictionary read |
| 2 narration | Bedrock | the on-device model |
| 3 verification | the number checker | the same checker, ported |

Only layer 2 differs, and layer 2 was never allowed to touch a number. That is what makes
an offline answer trustworthy rather than a downgrade with a disclaimer.

Two consequences follow directly:

- **The pack carries no raw series.** `OfflinePack` has no `daily_kwh`, and a test asserts
  it. A device holding the readings is a device whose model can be asked to total them, on
  the platform where nobody could audit it.
- **Hardship is excluded from the pack.** A household in payment difficulty needs a
  person, and the route to one runs over the network. An offline model producing a warm,
  fluent, self-contained reply about payment options would *replace* that handoff with a
  dead end — the customer would feel heard and nobody would be told. Offline, the app says
  it cannot help with this until it reconnects.

### Nothing is downloaded without being asked

~530 MB pushed to every phone would spend a rural customer's metered data on a feature
most people never need, before they have decided the app is worth keeping. The app asks
once at sign-up — *"Do you often lose your connection?"* — and records the answer as
`AlertPreferences.offline_model_opt_in`. The server never pushes; the client fetches over
wifi when the customer has said yes. The same switch is in Settings.

The prompt quotes the real size from `GET /api/offline/models` rather than a hard-coded
one, because somebody agreeing to "about 530 MB" and receiving 1.8 GB is a cost we imposed
on them.

## Consequences

**Good.** Answer quality no longer depends on the serving machine. The offline path is a
genuine feature for the customers the scenario brief cares about, rather than a
consolation prize. Nothing degrades silently.

**Bad.** A deployment that forgets `KEA_PROVIDER` and has no Bedrock access gets template
fallbacks rather than a local model — correct, and it will look like a broken deploy to
anyone who has not read this. `/health` says which provider is answering; the demo
checklist says to look at it.

**Unresolved.** The mobile app does not exist, so the offline pack is served and tested
but not consumed. The pack format is versioned (`schema_version`) so a device on an older
build refuses a pack it does not understand rather than reading fields positionally.

Related: [ADR-0004](0004-llm-provider-interface.md), [ADR-0010](0010-aws-deployment.md),
[ADR-0009](0009-smart-home-integration.md) (shares the phone-computes pattern).
