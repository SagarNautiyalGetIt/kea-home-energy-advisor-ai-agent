# Sprint 3 — Kea plans and commitment terms

The data specification behind Sprint 3 plan comparison and recommendation.
The product screenshots are the source of truth:

- [`plans-1.png`](plans-1.png) defines the three pricing styles and rates.
- [`plans-2.png`](plans-2.png) defines Flexible, 6-month and 12-month terms.

These are Kea demo products. They replace the four plans previously modelled
on Contact Energy; no Contact product name or rate remains in the active LCL
catalogue.

## 1. Which data demonstrates which sprint

The datasets have separate jobs:

| Dataset | Purpose |
|---|---|
| Nine hand-written households | Sprint 2: known bill explanations, tariff edge cases and the printed $50.54 invoice |
| 50-household LCL cohort | Sprint 3: compare plans, recommend a better option, forecast bills and identify hardship signals |

The nine fixtures retain their original historical plan codes and prices. They
are regression evidence, not candidates in the Sprint 3 recommendation set.
All Sprint 3 decision jobs select generated ICPs (`09%`) explicitly, rather
than relying on the fixtures happening to fall outside the latest usage window.

## 2. The three pricing styles

All displayed prices are customer-facing and GST-inclusive.

| Style | Usage price | Daily charge | Best suited to |
|---|---|---:|---|
| **Anytime Rate** | **$0.325/kWh** all day | **$1.45/day** | Customers wanting simplicity and predictable pricing |
| **Time of Use** | Peak **$0.390**, off-peak **$0.270**, night **$0.180** per kWh | **$1.50/day** | Customers able to shift usage away from peak |
| **Free Weekends** | **$0.365/kWh** outside the free period; **$0** Sat/Sun 09:00–17:00 | **$1.55/day** | Households using more electricity on weekends |

Time of Use uses the exact screenshot boundaries on every day:

| Band | Local time |
|---|---|
| Peak | 07:00–11:00 and 17:00–21:00 |
| Off-peak | 11:00–17:00 and 21:00–23:00 |
| Night | 23:00–07:00 |

“Free” means every per-kWh import charge is zero. The fixed daily charge still
applies. The previous Contact-derived implementation left some unbanded usage
components inside a free window; the bundled Kea tariff removes that ambiguity.

### Internal rate representation

Source bill lines and catalogue components are ex-GST. Imported energy also
receives the existing 5.11% line-loss uplift. The stored import rate is:

```
displayed rate / 1.15 GST / 1.0511 line-loss factor
```

The stored daily charge is the displayed amount divided by 1.15. Recombining
the catalogue component, line loss and GST must reproduce every displayed rate
at its printed precision; `02_catalogue.sql` asserts that map before commit.

The screenshots do not define solar buy-back. The demo uses the same assumed
flat **8c/kWh customer-facing credit** on all three styles. Holding export price
constant keeps the eight solar households billable without allowing an
invented buy-back difference to drive the recommendation.

## 3. Commitment terms

The term is independent of the pricing style, producing nine selectable
combinations.

| Term | Monthly credit | Total credit | Screenshot early-exit wording |
|---|---:|---:|---|
| **Flexible** | $0 | $0 | No exit fee |
| **6 months** | **$10/month** | **$60** | Up to $50 |
| **12 months** | **$25/month** | **$300** | Up to $100 |

Credits are GST-inclusive and appear on a bill as a separate negative `credit`
line. Recommendation output continues to split:

```
usage_saving   unconditional difference between pricing styles
term_credit    conditional value earned by completing the commitment
annual_saving  usage_saving + term_credit
```

A switch is recommended only when `usage_saving > 0`; a term credit cannot
turn a more expensive usage plan into a “saving”. The screenshots state maximum
early-exit charges but do not define a calculation schedule, and the demo has
no early-exit event. Those caps are therefore displayed product terms, not
subtracted from annual savings or invented as customer transactions.

## 4. Catalogue and assignment

The active generated codes are:

```
KEA_ANY_VECT_STA
KEA_TOU_VECT_STA
KEA_WKND_VECT_STA
```

Each has two abutting validity rows around 2026-04-01 so the historical pipeline
still exercises period-end plan-version resolution. Both versions use the
same screenshot price because no historical Kea tariff was supplied.

Starting-plan assignment is deterministic and independent of measured usage:
40% Anytime, 30% Time of Use and 30% Free Weekends by hash. On the current
50-household cohort this yields 20 / 17 / 13. The generator must not assign the
cheapest plan after inspecting consumption; doing so would erase the problem
the recommendation feature exists to find.

## 5. Acceptance criteria

- Exactly three active generated plan codes exist, all Vector / Standard User.
- Every generated plan has two gapless validity versions.
- Every energy and network scope tiles all 7 × 48 local half-hours exactly once.
- Recombined active rates and daily charges equal the screenshots.
- All three plans have generated accounts and a common 8c solar buy-back.
- Every eligible LCL account is priced against 3 plans × 3 terms = 9 offers.
- Sprint 3 forecasts, recommendations, hardship assessments and alerts contain
  LCL accounts only.
- The dashboard includes real bill-period examples showing current cost,
  candidate cost and the specific band/window that creates the saving.
