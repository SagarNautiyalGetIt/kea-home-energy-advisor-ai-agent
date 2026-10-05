# Mobile acceptance follow-ups (#349)

The 4 October QA report tested database-backed Expo Go and found five defects.

| Defect | Repair | Acceptance still needed |
|---|---|---|
| D1 | Cold Snap account text now describes the completed July cycle and the $20 alert floor; no alert threshold or fixture is changed. | QA should expect the API's actual completed-cycle verdict, not a day-six warning. |
| D2 | Demo picker lists only accounts whose data resolves. Correct credentials for an unloaded household return 503 before issuing a token. | Load missing synthetic households on the operator's database if those scenarios are needed. No reseed was performed; it would erase conversations and audit data. |
| D3 | Missing forecasts show unavailable text, no green ring, and a retry action; account changes clear old dashboard data. | iOS/Android loading, error, retry and account-switch checks. |
| D4 | Daily usage totals compute maximum import and all tied dates over exactly the selected range; prompt directs Sparky to those fields. | Live-provider paraphrases and QA peak-day retest. A numeric provenance check alone does not prove a model correctly interprets a maximum. |
| D5 | Absent tariff-band rows are hidden with the source's unavailability reason; present readings remain displayed, including zero. | QA with database-backed demo households and genuine band data. |

## PR #265 generated household access

The service/client source audit found no hardcoded old generated ICP `1027`, new ICP
`1086`, `DEMO_ICP`, or generated surrogate-key dependencies. Existing `DEMO-ACCT-*`
identities are the hand-built fixture accounts and should not be renamed with the cohort.
The API currently has no reader for `kea.solar_estimate`; a future reader must include
`battery_dispatch`, as PR #265 documents.

The planted walkthrough uses stable account `A41636552`, derived by PR #265's
`planted.account_number(planted.DEMO_LCLID)` (`MAC000265`). It is independent of
the cohort's ICP/surrogate renumbering. To expose its synthetic login after that data
release is loaded, explicitly set **all three** flags on the API:
`KEA_DEMO_LOGINS=1 KEA_PERSIST=1 KEA_GENERATED_DEMO_LOGIN=1`.
The picker then supplies its credentials only if the household actually resolves.
This adds no data or production authentication; the demo flag remains off by default.
No Snowflake rebuild, publication, database migration, cloud deployment or live model
acceptance was performed for these fixes.

## Backend brief 2 figures after the cohort change

The 18/19 September figures in `docs/sprints/sprint-4/data-plan.md` are historical.
The following restatement uses the committed evaluation report at PR #265 head
`1d7df2faeefba0ee25deb79ab0a70b7740c3f216`, timestamp **2026-10-02 23:18 UTC**,
and its metrics CSV. It is an archived measurement, not a fresh database query.
The planted walkthrough is excluded from that evaluation; these results measure
synthetic planted answers, not appliance identification in real households.

| Brief 2 measure | Restated archived result |
|---|---|
| High-power precision / recall | 653/655 = 99.7%; 653/654 = 99.8% |
| Portable charger found as low power | 177/184 = 96.2%; one high-power class error |
| Timed nights detected | 4,929/4,931, rounded 100.0% |
| Published minus planted half-hours | Median 0.0; mean -0.09 |
| Planted days inside published band | 3,599/6,898 = 52.2%; misses the 90% target |
| Within 0.5 kWh / within 10% of planted kWh | 90.7% / 95.5% |
| Band width / median miss outside band | 0.45 kWh / 0.16 kWh (2.3% of planted kWh) |
| Heating-fit replication | 199/199 match; zero mismatches; 118 fits have R² >= 0.30 |
| Six non-solar wallbox bill-driver ratios | 1.002, 1.063, 1.027, 1.003, 0.996, 1.012; all meet 0.70 |
| Unplanted household session rates per year | No solar: 39.1 high / 21.0 low; solar: 41.7 high / 15.8 low |
| Unplanted forecast median APE | 4.9% overall; 7.5% days 1–14; 3.4% from day 15 (27,479 scored) |
| Hot-water forecast median APE | 3.6% overall; 6.2% days 1–14; 2.4% from day 15 (551 scored) |
| Published forecast model/count | Only hdd-linear-v3; 37,663 rows |
| Gradual hardship warning | 6/6 caught; median 22 days, meets 21-day target |
| Early outreach false alarms | Zero over 282.2 on-time account-years |
| Solar export-share model minus meter | -1.4 to -2.9 percentage points over 19 households |
| Archived worked bill change | $20.84 detected-load driver; $18.53 total change; $13.36 unexplained |
| Archived worked grid-charged battery payback | 3 kW + 13.5 kWh: $18,000–$27,000 install; $722.66–$835.31/year; 21.5–37.4 years |

Keep the original wording rules: a lower bound is not a guaranteed floor; a charging
pattern is not proof of an EV; bill attribution is approximate; show the unexplained
remainder and simple-payback assumptions. The report does **not** restate the old
daily-load/session/solar/scenario row counts, explainable-bill counts, latest live
hardship/outreach counts, or plan-switch count. Those must be queried from a loaded
release before quoting them as current. The 18 September before/after table remains
an explicitly dated comparison and must not be presented as the 200-household release.
