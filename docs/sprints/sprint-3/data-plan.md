# Sprint 3 — data delivery plan and current status

Companion to [`plans-and-terms.md`](plans-and-terms.md), which is the source of
truth for the three customer-facing plans. This document records how the data
supports the Sprint 3 demonstration and which acceptance checks protect it.

## Dataset separation

Two datasets deliberately serve different demonstrations:

| Dataset | Purpose | Rules |
|---|---|---|
| Nine fixed households | Sprint 2 regression and pipeline walkthrough | Preserve their networks, historical tariffs and known bill examples |
| LCL compact cohort | Sprint 3 plans, forecasts, hardship and recommendations | 50 source households; Vector only; Standard User only; three Kea plans |

Sprint 3 decision jobs explicitly select LCL ICP numbers beginning with `09`.
They do not reinterpret the nine Sprint 2 fixtures as customers eligible for
the new Kea offers. The fixtures still pass through the common warehouse and
serving pipeline so regression coverage remains intact.

This split is preferable to converting the fixtures. Sprint 2 needs stable,
small examples with known outcomes; Sprint 3 needs varied, real half-hourly
load shapes so plan fit can be compared credibly.

## Compact demonstration profile

`make rebuild-demo` is the normal demonstration rebuild. It keeps the complete
two-year LCL source span, deliberate data-quality defects, revisions, payment
behaviours and the nine fixtures, but reduces the generated cohort from 500 to
50 households. `COHORT_SIZE=500` remains available for a scale run.

The compact path extracts the large meter range with one partitioned Spark job
instead of hundreds of daily jobs. Its target is under 30 minutes. The rebuild
on 8 September 2026 completed source generation, Spark, Snowflake/dbt and the
serving load comfortably inside that limit; dbt passed all 239 models/tests.

The source generator created:

- 50 LCL households and about 2.14 million source meter-read rows;
- 1,224 generated invoice periods;
- 20 Anytime, 17 Time of Use and 13 Free Weekends source assignments;
- 25 Flexible, 10 six-month and 15 twelve-month source terms.

Five planted integrity cases are intentionally excluded before or during the
serving layer. The served LCL accounts therefore do not have to total 50, and
the difference is a tested demonstration of quarantine rather than data loss.

## Current plan catalogue

The active LCL offer set is deliberately small:

| Plan | Usage price, GST inclusive | Daily charge |
|---|---|---:|
| Anytime Rate | $0.325/kWh at all times | $1.45 |
| Time of Use | Peak $0.390; off-peak $0.270; night $0.180 | $1.50 |
| Free Weekends | $0.365 outside the free window; $0.000 Sat/Sun 09:00–17:00 | $1.55 |

Time of Use windows are peak 07:00–11:00 and 17:00–21:00, off-peak
11:00–17:00 and 21:00–23:00, and night 23:00–07:00. The catalogue stores
rates ex-GST and adjusts import energy for the 5.11% line-loss factor so the
pricing engine recomposes exactly to these advertised customer rates.

The screenshots do not specify solar buy-back. All three plans therefore use
the same assumed $0.08/kWh customer-facing export rate. This keeps export
working without allowing an invented buy-back difference to decide which plan
wins. Early-exit caps are documented but are not subtracted from annual savings
because the demo has no exit event or remaining-term model.

The three term choices are Flexible ($0), six months ($10/month conditional
credit), and twelve months ($25/month conditional credit). Recommendation rows
keep unconditional usage savings and conditional term credit separate. A plan
switch is recommended only when its usage cost is genuinely lower.

## Why initial plans are not assigned optimally

The generator assigns a varied initial mix deterministically from household
identity, not from the load shape that makes a plan cheapest. This is necessary
for a plan-fit demonstration: assigning everyone to the cheapest plan first
would leave the recommender no useful decision to show.

The rebuilt serving data contains 18 valid active accounts on Anytime, 14 on
Time of Use and 13 on Free Weekends. Additional source assignments are among
the planted integrity cases and are intentionally absent or invalid downstream.

## Recommendation and bill evidence

`make recommend-plans` prices each eligible LCL account against three plans and
three terms. It compresses one year of reads into exact weekday/time/flow
profile cells; because all tariff windows are weekly and prices are linear in
kWh, this changes runtime but not the result.

The current build produced:

- 44 eligible LCL households;
- 396 candidate rows, exactly 44 × 3 plans × 3 terms;
- 28 recommended switches based on unconditional usage savings;
- 84 examples, three completed real bill periods for every recommended switch;
- cheapest-family results of Time of Use 39, Anytime 3 and Free Weekends 2;
- 8 households with less than $50/year between first and second place.

Time of Use dominates this particular real cohort, but all three plans win for
at least one household. The narrow-margin group must be presented as uncertain,
not as a confident recommendation.

The dashboard chooses two different plan movements from the strongest valid
examples. In the current generation:

| Account | Current → recommended | Annual usage saving | Saving over three shown bills |
|---|---|---:|---:|
| A83870875 | Anytime → Time of Use | $575.36 | $253.39 |
| A24074436 | Free Weekends → Time of Use | $491.46 | $99.66 |

For each bill it shows the actual issued amount as calibration and compares a
current-plan re-rate with a recommended-plan re-rate using the same readings,
dates and pricing engine. This makes “why the current plan is a poor fit” a
concrete bill story rather than only an annual summary.

`make verify-plan-bills` is the pricing acceptance gate:

> Re-rate one issued bill for every eligible open account against its historical
> plan version and reproduce charges excluding GST within $1.

The rebuilt data passes 53/53 accounts. The one planted ambiguous-register
account is explicitly quarantined and skipped rather than guessed.

## Forecasts, hardship and outreach

The same compact rebuild now produces:

- 7,468 bill forecasts for 22 forecastable LCL accounts, including 211 anomaly
  flags;
- 45 LCL hardship assessments, of which 11 are flagged;
- all five explainable hardship signal types;
- 11 pending, unscheduled in-app outreach alerts and zero messages sent.

Forecasts require enough clean usage plus weather overlap, so 22 of 50 is an
eligibility result, not a population target. Hardship assessments distinguish
“assessed with no signals” from “not assessed”; reason codes are stored as
child rows. Alert creation is idempotent and intentionally stops at `pending`.

## Delivery order

```text
catalogue + generated source
        │
        ├── warehouse/serving ── forecasts
        │
        ├── tariff engine ── recommendations ── bill reproduction gate
        │
        └── payments/usage ── hardship assessments ── pending alerts
```

All items above are implemented. The code-managed Metabase dashboards are
rebuilt after decision data so their queries always point at the newest
append-only generation.

## Outside Sprint 3

Outages, solar-installation workflows, EV inventory, hardship risk scores,
load decomposition and automatic hardship-case creation remain out of scope.
The data side identifies explainable signals and prepares pending outreach; it
does not contact a customer or open an operational case.
