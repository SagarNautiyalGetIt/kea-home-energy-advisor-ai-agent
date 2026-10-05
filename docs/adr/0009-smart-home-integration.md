# ADR-0009 — Smart-home integration

**Status:** proposed · **Date:** 4 September 2026 · **Sprint:** 4

## Context

Every bundle this system produces carries the same caveat:

> Do not name or guess which appliance caused any change — half-hourly meter data cannot
> identify appliances, and claiming otherwise is a fabrication.

It is correct, it is load-bearing, and it is the single biggest limit on how useful an
answer can be. The product's flagship finding — *"most of your bill is a steady 2.4 kWh a
day that runs whether you are home or not"* — stops one word short of being actionable,
because the next word would be the appliance and we cannot say it.

A connected device changes the **data**, not the rule. When a heat pump reports its own
energy, naming it is not inference; it is reading a label off a measurement. That is the
only honest reason to relax the caveat, and it is a good one.

## Decision

Add a `homelink` package that normalises Apple HomeKit, Google Home, Matter and
SmartThings into one observation type, turns those observations into `Fact` objects in
pure Python, and lifts the appliance prohibition **per device**.

    connectors   vendor payload    ->  DeviceObservation   normalisation      (I/O)
    insights     observations      ->  Fact + caveats      pure arithmetic    (layer 1)
    narration    facts             ->  a sentence          the model          (layer 2)

The architecture does not change, and that is the point. Device data is more raw data, so
it enters at layer 1 exactly where meter readings do. The model still only writes the
sentence.

### The four decisions that carry the design

**1. The caveat is lifted per device, never per household.**
`insights.appliance_caveats` generates an allow-list of the specific devices that reported
usable figures and leaves the prohibition standing for everything else in the house. A
household with one connected heat pump may be told about the heat pump; the other 80% of
its bill is as unidentifiable as it was yesterday. Implemented as generated text rather
than a boolean flag precisely so it cannot be flipped globally by accident.

**2. Apple HomeKit is push-only, because Apple publishes no cloud API.**
This is the constraint most integration plans get wrong. HomeKit accessory state lives on
the user's devices and in an end-to-end-encrypted iCloud container. There is no
server-side API, no OAuth flow, no webhook — by design. No credential exists that would
let this backend read a HomeKit home.

So the iOS app reads HomeKit locally through the `HomeKit` framework, aggregates to daily
totals **on the phone**, and posts the result. The backend is a sink. Consequences:

- The minute-level accessory stream never leaves the device. That is a stronger privacy
  position than any consent screen, and it costs nothing.
- It shares the mobile architecture with the offline model (ADR-0008) — both are "the
  phone computes, the server stores facts".
- Web-only customers cannot connect HomeKit. The connect screen says so rather than
  showing a button that dead-ends.

**3. Confidence is a first-class field, and it governs wording.**
A device with its own energy meter is `MEASURED`. Runtime times a nameplate rating is
`RATED` — real arithmetic over two real numbers, and still an over-estimate, because
nameplate power is a maximum. Anything else is `INFERRED` and never becomes a dollar
figure at all. `RATED` figures carry a caveat forcing the narrator to say "about". A guess
presented as a measurement is the one failure in this package that reaches a customer as a
confident wrong number.

**4. Nothing finer than a day is stored.**
`DeviceObservation` has no field a minute-level record could go in. A device event stream
is a record of when somebody showers and when they go to bed; 47.6% of surveyed customers
already say they would not trust an AI with their usage data, and half-hourly meter reads
are the sharpest thing we hold today. Connectors aggregate at the edge. The guarantee is
in the schema, not in a policy someone has to remember.

### Scopes

Read-only, everywhere. Kea explains bills; it does not run heat pumps. Asking for write
access would be asking for a permission we cannot justify on a consent screen, and it
would make us liable for a house that got cold overnight.

## Build order, and why

Not alphabetical, and not by market share.

| # | Provider | Why here |
|---|---|---|
| 1 | **Matter / Home Assistant** | The only provider that reaches `MEASURED` for free. A Home Assistant household already has per-device energy in long-term statistics, normalised. For a product whose claim is that figures are real, build the one that supplies real figures first. No vendor fee, no approval queue. |
| 2 | **Apple HomeKit** | Needs the iOS app, which is on the roadmap anyway. Highest NZ household penetration of the four, and the push design means no vendor dependency at all. |
| 3 | **SmartThings** | Ordinary OAuth, widest retail device coverage, no registration fee. |
| 4 | **Google Home** | Last, deliberately. Device Access charges a one-off per-project registration fee, and the SDM API reports device *state*, not energy — so every Google figure is `RATED` at best. Most cost, weakest data. |

## What this unlocks, concretely

The bill-shock warning currently decomposes an overshoot into weather, behaviour and
everyday load (the existing bill-shock forecast). With a connected cylinder that becomes:

> Your cylinder ran unattended on 19 of 21 days and cost about $46 — that is most of the
> $68 you are tracking above normal, and it is on a schedule you can change.

Every figure there is computed. The only new thing is that we may say *"cylinder"*.

## Consequences

**Good.** The product's biggest honest limitation becomes surmountable for the households
that opt in, without weakening it for the ones that do not. Always-on detection is the
most actionable output this system can produce and it is nearly free once observations
exist. The HomeKit path pushes the most sensitive data off our infrastructure entirely.

**Bad.** Four integrations is real surface area, and three of them need vendor accounts
that a course project may not be able to obtain. Device coverage will be patchy, so
connected devices will rarely sum to the whole bill — the caveat set says so, but the UI
has to as well, or a customer will read the difference as unexplained.

**Deliberately unresolved.**

- **Nameplate lookup for `RATED` devices.** Either the customer types it in (accurate,
  friction) or we hold a model→wattage table (frictionless, and a table we would have to
  source and defend). Not decided; `rated_watts` is optional on the observation so both
  remain open.
- **Consent lifetime.** OAuth tokens outlive the customer's memory of granting them.
  Proposal: re-confirm annually, and show the connection on the bill-shock card wherever a
  device figure is quoted, so the data's origin is visible at the point of use rather than
  buried in Settings.
- **Whether device facts should reach the bill-shock *alert*.** An email naming an
  appliance is more useful and more intrusive than one that does not. Not decided.

## Status of the code

`app/homelink/` is complete for schemas, insights, consent scopes, the connector protocol
and the mock home. `tests/test_homelink.py` covers the caveat rules end to end. The four
real connectors raise `NotImplementedError` with the specific missing prerequisite named —
they are seams, not stubs, and the shape above them is settled and tested.

Related: [ADR-0002](0002-narrate-only-architecture.md) (why the model never computes),
[ADR-0008](0008-offline-first-narration.md) (the phone-computes pattern this shares).
