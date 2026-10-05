# Sprint 4 — data delivery plan and current status

Scenario 10's three stretch goals, from the data side:

1. **Appliance-level breakdown:** roughly where the power goes.
2. **Solar and EV:** the payback of rooftop solar, and the saving from moving EV
   charging off-peak.
3. **Hardship early warning:** a household sliding toward arrears, spotted
   weeks ahead, with a supportive outreach prepared for staff.

The design is `data/design/kea-data-platform-design.md` §15; the decisions are
in [`../../decision-log.md`](../../decision-log.md) (17 Sep 2026). The data
side changes only `data/`. Backend changes are specified in the brief below and
built by the backend owner.

## Status

| Stage | Delivers | Status |
|---|---|---|
| 1. Design and schema | Design §15, migration `V005`, the reference DDL, the read contract and its test, the rebuild reset, decision-log entries, backend brief 1 | **done, 17 Sep** — in review |
| 2. Planted test data | Generator changes and tests; one dry run of the source load on a throwaway Postgres | **done, 17 Sep** — dry run passed (`99_assert.sql` incl. §15), and passed again with the clean-label guard; in review |
| 3. Pipeline | Completeness fix, detected-load models, net heating fit, forecast v3, bill driver, solar and EV jobs, early-warning rules, staff queue; `make ci` green | **done, 17 Sep** — `make ci` green; Snowflake smoke build 51/51 and all 8 dbt unit tests pass; in review. The clean-label guard that the smoke build called for is in place (see "Smoke build on today's data") |
| Botman backtest | Stages 1–3 on the export of the day, own branch | **done, 17–18 Sep** on `forecast-backtest`: Stages 1–2 against the 12 Sep export (gate PASS), and Stage 3 after this rebuild, which re-ran the headline on the 17 Sep export (PASS again) and failed the seasonal variant |
| 4. Rebuild and evaluate | `make rebuild-demo`, evaluation against the thresholds below, backend brief 2 with measured figures | **done, 18 Sep** — rebuild green (dbt 308 PASS, `assert-source` and `assert-serving` pass, 6 dashboards verified, 10 Soda serving checks pass); the evaluation reports 44 figures, of which 2 missed a target — both in brief 2 |
| 5. The household with both panels and an EV | Load-linked array sizes, three solar+EV plants, `detect-v2`, the `solar_soak` scenario, migration `V006`, design §15.11, the evaluation's §1a and §9a, dashboard section 7, backend brief 3 | **code done, 20 Sep** — `make lint`, `make test` (244 + 99) and `make ci-dbt-parse` green, the five new dashboard queries replayed on a throwaway Postgres with V001–V006 applied. **Not yet re-measured**: it needs `make init-data` and a rebuild, so every figure in §15.10 and in `analysis/sprint4_evaluation/results/` still describes the pre-V006 cohort |
| 6. The home battery | Migration `V007` (`battery_kwh`) and `V008` (`battery_dispatch`, grid charging), sourced battery figures, dashboard 11 section 5, backend brief 4 | **done, 1 Oct** — `V007` merged (#259); the sources (#265) and grid charging (#267) in review. Published as `demo-20261001T130219`: `make ci` green, `assert_serving` 61 pass / 5 known / 0 fail, the evaluation's hand check on a grid-charged row reads Match |

Registrations that name a producer — `serving.TABLES`, the export SQL files,
the new jobs in `publish()`, the `validate()` requirements and `DECISIONS` in
`publish_serving.py` — land in Stage 3 with that producer. Registering them
earlier would fail every publish on tables nothing fills yet.

## Schema (V005)

| Table / change | Written by | Loaded |
|---|---|---|
| `kea.mart_daily_detected_load` | dbt → export | TRUNCATE |
| `kea.mart_charging_session` | dbt → export | TRUNCATE |
| `kea.solar_estimate` | `build_solar_estimates.py`, in the publication | append-only |
| `kea.ev_scenario` | `build_ev_scenarios.py`, in the publication | append-only |
| `kea.hardship_outlook` | `build_hardship_assessments.py` (v2) | append-only |
| `common.detection_confidence` (`low`, `medium`, `high`) | V005 | — |
| `common.hardship_signal_code` + `payment_drift`, `bill_above_usual_payment`, `first_shortfall` | V005 | — |
| `kea.mart_bill_explanation` + `detected_load_kwh_day_this`, `detected_load_kwh_day_prior`, `delta_from_detected_loads` | dbt → export | TRUNCATE |
| `kea.mart_forecast_input` + `detected_load_kwh_day` | dbt → export | TRUNCATE |

All new columns on existing marts are nullable. All new foreign keys are
deferrable. `make rebuild-demo`'s reset now truncates nine decision tables,
including the three new job tables.

**Read contract.** `data/design/serving_read_contract.json` lists every
serving column the backend reads or is asked to read. The `ServingReadContract`
test in `make ci-serving-db` fails if a migration renames, drops or retypes one,
if `kea_app` cannot select it, or if any served foreign key is not deferrable.

## Test data

One regeneration (in the Stage 4 rebuild) plants known answers:

- **EV:** 4 households without solar — 3 with a 7 kW wallbox (2 evening, 1 on a
  23:00 timer), 1 with a 2 kW portable charger — arriving at least six months
  before the span ends.
- **EV behind panels** (added 20 Sep, Stage 5): 3 households that *do* generate,
  each with a 7 kW wallbox — one on a 23:00 timer (the control: panels change
  nothing in the dark), one from 17:30 (masked in summer, clear in winter, the
  same household either way), one from 11:00 (the worst case, where the charge
  can be invisible). They are drawn from their own pool and screened on **net
  import**, not gross load, because net import is all the detector ever sees.
  ⚠️ They never enter the eight's precision and recall: the headline population
  is unchanged, so Sprint 4's figures stay comparable.
- **Night timer:** a 3 kW hot-water element on a 23:00 timer in 4 other
  households, every night, more in winter.
- **Payments:** 3 `SLIDING` accounts (drift, then shortfalls, after a bill
  ≥ 130 % of usual) and 1 `SLIDING_SUDDEN` account, an expected miss.
- Planted households avoid every source-defect target (35 candidates for 8
  places in the 50-household profile). They are also screened for a clean
  label: of the 35, 10 are clean for an EV and 7 for a hot-water element (see
  "Smoke build on today's data").
- In the repeated dry run (with the guard), the wallboxes' first sessions are
  on 19 Sep, 3 Nov and 7 Dec 2026, and the portable charger's on 22 Jan 2027:
  3,525 sessions in all (497 EV, 3,028 element nights). Every sliding account
  reaches arrears 51 days after its trigger bill is issued.
- The source load (`load_source.sh`) now stops at the first failed SQL step;
  `KEA_GEN_OUT` and `KEA_SOURCE_PSQL` let it run against a scratch directory
  and database. Answers live in
  `gen_audit.planted_load` and `gen_audit.planted_hardship` and never reach
  serving.

## Success thresholds (set before the first run)

| Feature | Target |
|---|---|
| EV `high_power` sessions | precision ≥ 90 %, recall ≥ 85 % (≥ 50 % overlap) |
| Daily bounds | ≥ 90 % of planted days inside [low, high] |
| Night timer | detected on ≥ 80 % of planted nights |
| Bill driver | detected step ≥ 70 % of the planted step, all 3 wallbox households |
| Hardship | median warning ≥ 21 days before onset; ≥ 2 of 3 gradual accounts caught |
| False alarms | ≤ 5 early outreaches per 100 on-time account-years |

A detection miss still publishes, and the report says which figure missed. A
hardship miss keeps the outreach rule at v1.

**Both were exercised.** The daily bounds missed (65.2 % against 90 %) and the
tables published with the report saying why. The hardship median lead missed by 3
days (18 against 21); on 18 Sep 2026 the outreach rule was kept at v2 rather than
reverted, because all 3 gradual accounts were caught and there were no false
alarms. The reasoning is in `docs/decision-log.md`.

## Stage 3 as built

What the code does where the design left a choice open. Every threshold below
is a dbt var or a constant with its reason beside it.

### 3a. Detected loads, completeness, heating fit, forecast v3, bill driver

- **Completeness, fixed in place.** `mart_daily_usage.interval_count` is the
  fewest distinct half-hours read on any of the ICP's import registers, and
  `estimated_count` counts distinct estimated import half-hours. A new
  singular test holds `interval_count <= expected_intervals`.
- **Runs** (`int_metering__import_runs`, method `detect-v1`):
  - A candidate half-hour is ≥ 0.75 kWh above the day's floor; two in a row
    make a run, and a run may cross midnight.
  - **Tail:** the half-hour after a run joins it when it is ≥ 0.25 kWh above
    the floor, because a charger or a cylinder often stops mid-half-hour.
  - **Rules** (first match wins): seasonal night block (not published);
    `ev`/`high_power` (two half-hours ≥ 2.5 kWh above the floor, any start
    time); `timed_night` (starts 21:00–06:30, mean 0.75–2.0 kWh, same slot ±1
    on ≥ 60 % of assessed nights since its first run); `ev`/`low_power`
    (≥ 6 half-hours, steady 0.9–2.0 kWh, medium confidence at most); other.
  - **Seasonal rule:** "never runs in warm months" means it starts in its slot
    on ≤ 10 % of the observed warm-month nights (Dec–Feb, a month counted with
    ≥ 20 assessed days).
- **Heating fit:** the monthly line is fitted on daily import minus
  `ev_kwh_low + timed_night_kwh_low`.
- **Forecast `hdd-linear-v3`:** `mart_forecast_input.detected_load_kwh_day` is
  a range join over the 28 days up to each snapshot (≥ 7 assessed days, else
  NULL, and the snapshot is not forecastable). `project_forecast()` takes it as
  a **required** keyword, so no caller can silently fall back to v2.
- **Bill driver:** `delta_from_detected_loads` as designed. Fixture 05's
  expected dominant driver in `assert_serving.sql` is now `detected_loads`,
  checked as `must`, not `known`.
- **Dashboards:** the bill-driver cards on the serving dashboard, the Stage 5
  dashboard and Story gain the new driver. Story's section 2 text names
  `hdd-linear-v3` and says what it adds back; two of its text cards are two
  rows taller to fit.
- **Tests:** 8 dbt unit tests, the project's first, in
  `_silver__unit_tests.yml` and `_marts__unit_tests.yml`. CI only parses them;
  they run in the Snowflake smoke build.
  - A `format: sql` expectation must name every model column. The run
    classification test lists only the class columns and takes the rest from
    dbt's own CTE for the model's output (`dbt_internal_unit_test_actual`),
    joined from the expected runs, so a missing or extra run still fails.
    Setting one household's expected class wrongly makes it fail, as it should.

### Smoke build on today's data (17 Sep)

`dbt build` of the import half-hours, runs, detected half-hours and the two
new marts on today's warehouse (nothing planted yet): 51 of 51 nodes pass
(5 models, 42 data tests, 4 unit tests), then `dbt test --select
test_type:unit` passes all 8. Nothing above those models was rebuilt.
Figures are aggregates.

- **Scale:** 37,375 assessed days across 58 ICPs.
- **EV-class detections on households that have no EV.** LCL has no EV
  charging, yet 27 of the 50 cohort households have `high_power` sessions
  (3,684 in all), and at least 39 have `low_power` ones (1,665). The loads
  are real, but they are not EVs, so for the EV label they are false
  positives.
  - The `high_power` ones look like heating: 1,198 sessions start in the cold months and 623 in
    the warm months, and 1,285 run for 6.5 hours or more (8.6 hours and
    41 kWh on average), longer than a 7 kW charger needs for most batteries.
  - The scale factor (×1.72) turns a UK 3 kW heater or cylinder into 5.2 kW,
    just above the 5 kW rule.
  - Ten households hold 96 % of the sessions.
- **Tightening the rule doesn't fix it (measured, not applied).** Requiring
  6 kW and at most 16 half-hours cuts the sessions of the households not chosen
  for planting from 2,968 to 1,580, and those households from 23 to 17. Half-hourly power and
  duration alone can't tell 7 kW of charging from 7 kW of heating.
- **One planted household is already the top false detection.** The household
  `planted.py` picks for the 23:00-timer wallbox has `high_power` sessions on
  688 of its 754 assessed days (698 sessions, most of their half-hours ≥ 7 kW
  above the floor). Its planted sessions would be indistinguishable, and the
  EV precision target (≥ 90 %) would fail on that household alone. The
  tightened rule above still leaves 466 of its sessions. The other planted
  households are clean: the two evening wallboxes have none, the portable
  charger 12 and the hot-water households 0 to 5.
- **Fixed: a clean-label guard in `planted.py` (17 Sep).** Before planting,
  `gen_metering.py` runs the detect-v1 run rules over each candidate's own
  scaled load (one more pass, about 20 s).
  - An EV place needs EV-shaped runs on at most 0.5% of the assessed days
    (3 of about 750).
  - A hot-water place needs the same with the element added, the element's
    own runs aside, and the element must read as a 23:00 timer on at least
    98% of nights. A household load in the hour before 23:00 pulls the run's
    start out of the timer slot, and one under the element makes it
    high-power.
  - Hot-water places are filled first, because on this data the households clean for
    an element are all clean for an EV too.
  - Of the 35 candidates, 10 are clean for an EV and 7 for an element. The
    old timer-wallbox household is now left out.
  - The chosen EV households have EV-shaped runs of their own on 3, 3, 1
    and 0 days; the hot-water households' elements are misread on 0 to 1
    nights of about 750.

  The unlabelled detections on the other households stay in the Stage 4
  report as the false-positive rate on real loads.
- **For backend brief 2:** on this data most loads "with the charging pattern
  of an EV" are electric heating, so the wording has to allow for that.

### 3b. Solar and EV estimates

- **Yield:** PVGIS 5.3 (PVGIS-ERA5 2005–2023) at each NIWA station,
  `reference/solar_yield_nz.csv`, regenerated by
  `reference/fetch_solar_yield.py`. Low and high come from roof direction and
  year-to-year weather. The station coordinates are approximate.
- **Window:** the plan recommender's year, so an estimate and a recommendation
  from one publication describe the same year. An account with less than 90 %
  of the window's half-hours read gets no estimate.
- **Solar:** only accounts with no export register — a payback for panels is
  only a question for a household that has none, and that skip is correct and
  unchanged by Stage 5. (What Stage 5 adds is for the households on the other
  side of it: see `solar_soak` below.) Generation is counted on metered
  half-hours only, so one row's generation, saving and payback describe the
  same half-hours. Install cost is 2,000–3,000 NZD per kW, marked `[ASSUMED]`.
- **Home battery** (added 30 Sep, `V007`): every size is also priced with a
  13.5 kWh battery, `battery_kwh`. It is walked through the real half-hours in
  time order: surplus charges it before anything is exported (5 kW, 90% round
  trip, the loss taken on the way in), import is met from it, and a gap in the
  readings empties it. Its cost is added to the panels'. Capacity, power and
  round trip are `[PUBLISHED]`, from one product's datasheet; the cost,
  12,000–18,000 NZD, is `[ASSUMED]` and brackets a survey of 63 NZ
  installations (`estimate_assumptions.py` cites both).
- **Charging it from the grid** (added 1 Oct, `V008`): on a plan with more than
  one import rate (Time of Use, Weekend) each size also gets a `grid_charge`
  battery, `battery_dispatch`. It tops up from the grid in the plan's cheapest
  half-hours, leaving room for as much surplus as the panels made the day
  before, does not discharge in them, and gives the energy back where the rate,
  after the loss, still beats them. Grid energy never counts as solar
  self-use. Flat plans get no such row.
- **`solar_soak`** (added 20 Sep): for accounts that *do* export, charging is
  placed in the NZ day's half-hours ranked by **measured** export, capped at
  each half-hour's own export, in both scenarios. Offered only when the basis
  window really did export. ⚠️ It may carry a **negative** saving and is
  published anyway.
- **`add_ev`:** 11,000 km a year at 0.19 kWh/km at the plug, as one 7.2 kW
  session a day starting at 18:00 or 23:00. A session's tail runs into the next
  half-hours, so a year's kWh is days × one session. Charging is added only
  where a reading exists, and priced on every plan the account is eligible for.
- **`shift_detected`:** each session's `kwh_low`, spread evenly over its
  half-hours (never more than was imported), moves to 23:00 the same night.
  The same kWh is put back, so nothing is lost or created. A session that
  already starts between 23:00 and 07:00 stays. It is priced on the current
  plan and on Time of Use.
- **Money:** GST-inclusive, rounded to the cent before any subtraction.
- **No Makefile targets** for the two jobs, as for the Sprint 3 jobs; the
  `pipeline/scripts/README.md` gives the `docker run` for a dry run.
- **Checked** against V001–V005 on a throwaway Postgres (kea-db was stopped),
  including a daylight-saving day.

### 3c. Hardship early warning and the staff queue

- **Ruleset `hardship-identification-v2`.** v1's five rules are unchanged and
  still read `payments_applied`. The three warning signs read the amount paid
  **by the assessment date**, from `billing.payment`.
  - `payment_drift`: the last three paid bills each ≥ 3 days later than the one
    before, and the latest 1–7 days late.
  - `bill_above_usual_payment`: any **open** bill, not only the latest issued
    one, or the newest forecast for the open cycle, grossed up for GST, at
    ≥ 130 % of the usual payment. Usual = the median paid on the last 6 paid
    bills due before it, needing at least 3. Without open bills, an account
    whose next bill is issued a few days later has an early window of about
    two days.
  - `first_shortfall`: a positive part payment below 95 % on the newest bill
    past due, after ≥ 3 bills paid in full. A bill with nothing paid is left to
    v1.
  - A forecast dated after `as_of`, or one for a cycle that is already billed,
    is ignored.
- **Outlook.** Written when drift or a shortfall is present. It assumes the
  household keeps paying **at most its usual amount**, takes a part payment as
  final, and gives the first bill still < 95 % paid 30 days after its due date.
  No outlook when the account is already in arrears, or when usual payments
  cover every bill. `outlook_rows()` asserts
  `projected_arrears_on > assessed_on`.
- **Expected lead** on the planted accounts: about 51 days when the trigger
  bill arrives two cycles before arrears (earlier with a forecast), about
  17–23 days when it is one cycle before in a weekly replay. Whether the median
  reaches 21 days depends on that mix, and Stage 4 measures it. `PAY_ON_TIME`
  accounts cannot show drift or a shortfall.
- **Replay caveat for Stage 4:** v1 reads `payments_applied`, which is the
  final amount, so a replay must use the as-of amounts for v1 too.
- **Alert rule v2.** Eligible: any v1 code, or `bill_above_usual_payment` with
  drift or a shortfall (an early outreach). `signal_count` still counts every
  signal, so every reader selects on the codes.
- **Dashboard 8 (staff only):**
  - "Latest hardship run" is a measure/value table: accounts assessed; flagged
    (a Sprint 3 signal); early warning; warning signs only; outlooks; signals;
    ruleset; date; generation.
  - "Hardship signals by reason" lists all eight codes, zeros included.
  - "Households flagged for outreach" keeps its meaning: a v1 code.
  - **New** "Signal evidence — for staff only": every signal of the latest
    generation, with the value observed and the staff-only explanation.
  - **New** "Open outreach — flagged and early warning": each open outreach
    with its kind, reasons, status and the outlook (arrears date, overdue
    amount, basis), early warnings first.
- **Story, section 4:** same layout and text; its counts and signal chart use
  the five v1 codes only.
- **Kept in step:** a test fails if the dashboards' code lists differ from
  `create_hardship_alerts.py`'s.
- **Live-demo caveat:** at the demo's `as_of`, the sliding accounts have
  probably already reached arrears, so the live queue may show few early
  warnings. The Stage 4 replay, not the live queue, measures the lead.
- **Checked** end to end on a throwaway Postgres: the jobs, then every
  hardship card as `kea_app`. The early account got
  `bill_above_usual_payment` and `payment_drift` plus an outlook, a spike alone
  got no outreach, and one early outreach was created.

### Backend

Stage 3 adds nothing to brief 1. The chat hardship scorer is unchanged, and
the staff queue is a data-owned Metabase dashboard.

## Backend brief 1

For the backend owner. Every path below is in a CODEOWNERS path. The data side
will not edit any of it.

### Ordering

**Migration first.** The backend maps whole rows: every mapped column of
`MartBillExplanation` is selected on each read. Run `make migrate-serving`
(V005) against a database **before** deploying backend code that maps the new
columns there. The reverse order breaks every bill-explanation read. The new
columns stay NULL until the Stage 4 export fills them, so the backend must treat
NULL as "not available", not as zero.

### New and changed columns (final, from the read contract)

`kea.mart_daily_detected_load` — PK (`icp_id`, `usage_date`), one row per
assessed day; no row = not assessed.

| Column | Type |
|---|---|
| `icp_id` | bigint not null |
| `usage_date` | date not null |
| `floor_kwh_per_hh` | numeric(10,4) not null |
| `ev_kwh_low`, `ev_kwh_high` | numeric(12,4) not null (0 when none) |
| `ev_half_hours` | smallint not null |
| `ev_charger_class` | text, `high_power` \| `low_power`; NULL when none |
| `ev_confidence` | common.detection_confidence; NULL when none |
| `timed_night_kwh_low`, `timed_night_kwh_high` | numeric(12,4) not null |
| `timed_night_half_hours` | smallint not null |
| `timed_night_confidence` | common.detection_confidence; NULL when none |
| `method_version` | text not null |
| `built_at` | timestamptz not null |

`kea.solar_estimate` — append-only; read the rows with the newest
`computed_at` per account (index `(account_id, computed_at DESC, system_kw,
battery_kwh, battery_dispatch)`). ⚠️ Since `V007` and `V008` a size has up to
three rows; see backend brief 4.

| Column | Type |
|---|---|
| `estimate_id` | bigint not null |
| `account_id` | bigint not null |
| `plan_id` | integer not null (the plan both costs were priced on) |
| `system_kw` | numeric(4,1) not null (3, 5, 7) |
| `battery_kwh` | numeric(4,1) not null (`V007`): 0 = panels alone, 13.5 = with a battery |
| `battery_dispatch` | text (`V008`): NULL without a battery, `self_consumption` or `grid_charge` |
| `weather_region` | text not null |
| `basis_from`, `basis_to` | date not null |
| `annual_generation_kwh_low` / `_high` | numeric(10,1) not null |
| `self_used_pct_low` / `_high` | numeric(5,2) not null |
| `annual_saving_nzd_low` / `_high` | numeric(12,2) not null |
| `install_cost_nzd_low` / `_high` | numeric(12,2) not null |
| `payback_years_low` / `_high` | numeric(8,1); NULL = no payback at that bound |
| `assumptions_version` | text not null |
| `computed_at` | timestamptz not null |

`kea.ev_scenario` — append-only; newest `computed_at` per account.

| Column | Type |
|---|---|
| `scenario_id` | bigint not null |
| `account_id` | bigint not null |
| `scenario` | text not null: `add_ev` \| `shift_detected` |
| `plan_id` | integer not null (the plan this row is priced on) |
| `current_plan_id` | integer not null |
| `charging_pattern` | text not null: `evening`/`night` (add_ev), `as_detected`/`night` (shift_detected); the first of each pair is the baseline |
| `basis_from`, `basis_to` | date not null |
| `annual_ev_kwh` | numeric(10,1) not null |
| `annual_bill_nzd` | numeric(12,2) not null — the whole household's bill with that charging |
| `annual_ev_cost_nzd` | numeric(12,2) not null — the part the charging adds |
| `saving_vs_baseline_nzd` | numeric(12,2) not null — 0 on the baseline row |
| `assumptions_version` | text not null |
| `computed_at` | timestamptz not null |

`kea.mart_bill_explanation`, three new nullable columns:
`detected_load_kwh_day_this` numeric(10,4), `detected_load_kwh_day_prior`
numeric(10,4), `delta_from_detected_loads` numeric(12,2).

`common.detection_confidence` is ordered `low` < `medium` < `high`.

### Changes requested

| # | Change | Where | Why |
|---|---|---|---|
| 1 | **Read the new data** | `app/db/marts.py`: models for `mart_daily_detected_load`, `solar_estimate`, `ev_scenario`, and the three `MartBillExplanation` columns. `analytics/account.DayUsage`: detected kWh bounds and confidences. `repository._account_context`: join them by date. | Otherwise nothing reaches a customer. |
| 2 | **Breakdown** | `analytics/disaggregation.split()`: `ev_charging` and `timed_night_load` slices with a new `Confidence.DETECTED`; take their low bound off before always-on and heating, as the controlled circuit already is; show the high bound as "up to". Use the heating slope passed in (refit on days only when none is passed). Take always-on from the published floor (`base_load_kwh`). `schemas.EnergyCategory.confidence`: add `detected`, then `make spec`. `services/web` `EnergyBreakdownCard.tsx` (`TONES`, `CONFIDENCE_COPY`, `CONFIDENCE_HINT`) and `index.css`. `agent/tools.get_energy_breakdown`: the wording rule. | `split()` ignores the slope it is given and refits by day (median R² 0.069 by day against 0.467 by month). Its always-on figure is a low percentile of daily totals, though its text calls it the overnight floor. The card would call a detected pattern "Read directly off your meter". |
| 3 | **Bill comparison** | `analytics/drivers.py`: `BillPeriod.detected_load_kwh_per_day`, and a "detected loads" step between base load and discretionary, clamped like the others. `caveats()`: allow a detected pattern to be described as a pattern. `repository._periods_from_explanation`: read the two `detected_load_kwh_day_*` columns; the bill-table fallback passes None. | `decompose()` recomputes the drivers, so without this an EV's arrival reads as "day-to-day usage". |
| 4 | **Solar and EV answers** | `agent/tools.py`: an async `get_solar_and_ev_estimates` in `TOOL_SCHEMAS` and `_ASYNC`, like `get_hourly_profile`. State the solar range, `assumptions_version` and "simple payback". The EV figures are single values under stated assumptions, so name those assumptions with them. Update `METER_BASIS`. | No tool reads the new tables. |
| 5 | **Forecast** (lower priority) | `analytics/forecast.forecast_cycle`: fit on daily kWh minus the detected low bounds, then add the recent detected kWh per day back, as `hdd-linear-v3` does. | EV sessions add scatter to the daily fit. |
| 6 | **Docstrings** | `account.DayUsage`, `drivers.BillPeriod` | Both say base load comes from an overnight percentile; it is the day's smallest half-hour × 48. |

Tests they would touch: `test_disaggregation.py`, `test_drivers.py`,
`test_repository.py`, `test_agent.py`.

### Wording rule

- EV: "a load with the charging pattern of an EV", never "your EV".
- Timed night load: "a load that switches on at the same time most nights
  (often a water heater on a timer)".
- Detected loads and solar: always the range, never a single figure.
- EV what-ifs: a single figure, always with the assumptions behind it
  (`assumptions_version`: annual km, kWh per km, charging time).

### No backend change needed, but worth knowing

- **Daily completeness is fixed on the data side (Stage 3).**
  `kea.mart_daily_usage.interval_count` and `estimated_count` will count each
  import half-hour once, as `MartDailyUsage`'s docstring and
  `DayUsage.is_complete` already assume. Figures change for the 8 solar
  households and fixture 01 (48 rather than 96 per day; their gaps now show).
  Optional afterwards: `is_complete` could test `==` rather than `>=`.
- **`common.hardship_signal_code` gains three values.** The backend reads
  neither the hardship tables nor this enum today; future code mapping it needs
  them.
- **`kea.mart_charging_session`, `kea.hardship_outlook` and
  `kea.mart_forecast_input.detected_load_kwh_day`** are for the pipeline and
  staff dashboards; the backend is not asked to read them.

### Found in review, not Sprint 4 work

`repository._account_context` (`services/api/app/analytics/repository.py`,
around lines 602–763) never sets `BillingFacts.balance_nzd` or `due_date`, so
`hardship/signals._account_signals` can never raise the overdue or balance
signals for a mart-backed account. Suggested fix: fill both from the `billing`
tables the pipeline's hardship job already reads; `kea_app` can read them
(V002).

## Backend brief 2

Measured on the 18 Sep rebuild (release `demo-20260918T113420`) and the
evaluation that followed it. Method and thresholds:
`data/analysis/sprint4_evaluation/README.md`; the run itself:
`data/analysis/sprint4_evaluation/results/report.md`. **No change is asked here
that brief 1 did not already ask for.** This is the measured ground under the
wording, plus what the rebuild did to the numbers the backend reads.

### What the detection found, against the planted answers

Eight households were planted with a known load; every figure below is against
the exact planted kWh, on days the generator did not alter afterwards.

| Measure | Result | Target | |
|---|---|---|---|
| wallbox sessions: precision | 349 of 349 = 100% | ≥ 90% | pass |
| wallbox sessions: recall | 349 of 349 = 100% | ≥ 85% | pass |
| portable charger found as `low_power` | 87 of 87 = 100% | – | (0 read as `high_power`) |
| timed nights detected | 2,410 of 2,411 = 100% | ≥ 80% | pass |
| published half-hours − planted half-hours | median 0, mean −0.05 | – | the right half-hours |
| planted days inside the published band | 2,107 of 3,230 = 65.2% | ≥ 90% | **missed** |
| …within 0.5 kWh of the band | 93.7% | – | |
| …within 10% of the day's planted kWh | 97.1% | – | |
| net heating refit vs the published fit | 49 of 49 ICPs | 0 mismatches | pass |
| bill driver ÷ planted step (3 wallboxes) | 100%, 110%, 110% | ≥ 70% | pass |

The bounds miss is a scale, not a detection failure: the band is narrow (median
0.50 kWh wide) and the low bound sits a little above the truth, so a 2% overshoot
falls outside it. For the days that miss, the median miss is 0.15 kWh — 2.3% of
that day's planted kWh. It is worst on evening charging (one household 1.80 kWh,
9%) and smallest on timed night loads. The tables still publish; the figure and
the distance are in the report.

### What that means for the wording rule

1. **The low bound is not a floor.** On evening charging it usually sits *above*
   the load that was really there. "About 8 kWh" or "8 to 11 kWh"; never "at
   least 8 kWh".
2. **Never "your EV", and not only because of privacy.** In the 39 households
   with nothing planted, the model still found high-power sessions on 35 of them
   — 49.1 high-power and 19.9 low-power sessions per household-year without
   solar, and 26.8 / 15.9 with it. On this data most of them are electric
   heating. A detection is a pattern, not an appliance.
3. **The bill step is approximate.** The published driver ran 100–110% of the
   planted step. Quote it as "about $X of the change", and keep the unexplained
   remainder visible: in the worked example $25.27 of a $25.57 change was
   attributed, $−5.49 left unexplained.
4. **Solar keeps its range.** Against the 8 households that really export, the
   model's exported share landed 1.1 to 2.7 points below the metered one, so the
   published low/high brackets what happened. Keep "simple payback": the worked
   example is 11.5–22.0 years, install $6,000–$9,000 against $409.57–$519.99 a
   year.

### Figures the backend can quote

- **Forecast (`hdd-linear-v3`):** median absolute error 4.9% on households with
  nothing planted (7.6% over days 1–14, 3.0% from day 15), 5.4% on the planted
  hot-water households. `kea.bill_forecast` holds v3 rows only: 8,716 rows
  across 26 accounts.
- **Detected loads published:** `mart_daily_detected_load` 37,375 rows;
  `mart_charging_session` 5,586 sessions (3,977 `high_power`, 1,609 `low_power`)
  across 42 ICPs; `solar_estimate` 108 rows over 36 accounts (8 skipped as
  already exporting); `ev_scenario` 342 rows over 44 accounts.
- **Coverage of the bill explainer:** 192 explainable bills over 27 cohort
  accounts, and 652 bills carry a non-zero detected-load driver.

### What the rebuild changed in the tables the backend reads

| In serving | Before (18 Sep) | After |
|---|---|---|
| daily-usage days with `interval_count > expected_intervals` | 6,047 | 0 |
| complete daily-usage days | 31,398 | 37,375 |
| the 8 solar households: complete days | 1 | 5,954 |
| the 8 solar households: forecastable snapshots / accounts with a fit / explainable bills | 0 / 0 / 0 | 1,863 / 8 / 47 |
| forecastable snapshots (cohort) | 7,784 over 23 accounts | 9,032 over 27 accounts |
| explainable bills (cohort) | 166 over 24 accounts | 197 over 28 accounts |
| cohort accounts with a heating fit | 38 | 46 |
| `bill_forecast` | `hdd-linear-v2`, 7,468 rows / 22 accounts | `hdd-linear-v3`, 8,716 rows / 26 accounts |
| latest hardship assessment | v1: 11 flagged, 4 multi-signal | v2: 28 flagged, 9 multi-signal |
| pending hardship outreach | 11 | 15 |
| accounts recommended to switch plan (of 44) | 28 | 27 |
| fixture 01: complete daily-usage days | 0 of 24 | 24 of 24 |

The "After" column records the 18 September rebuild and is left as it was
measured. The 19 September re-publish, which takes base load in the dark where
the ICP generates (design §8.4), re-measures three of these rows differently:
forecastable snapshots (cohort) 8,716 over 26 accounts, explainable bills
(cohort) 192 over 27, and bills carrying a non-zero detected-load driver 652.
The solar rows, `bill_forecast`, hardship, pending outreach and plan
recommendations all re-measure unchanged. Two cautions on reading this table
against today's data. "Cohort accounts with a heating fit" counted the fixtures
too — 46 exceeds the 45-account cohort — and the comparable figure today is 47
over all 54 accounts. And the cohort rows moved further than the eight solar
households can account for, since the solar sub-counts did not move at all. The
generated source is not the reason: `cohort.json` differs only in its timestamp,
and the generator hashes the LCLid against a fixed seed, never the clock. So the
difference comes from pipeline changes landed after 18 September, and it is not
yet traced to a particular one. Quote "Figures the backend can quote" above,
not this table.

Fixture 05 (`new_appliance`) now has `detected_loads` as its dominant bill
driver, which is what `assert_serving.sql` has expected since Stage 3, and it
passes. The nine fixtures otherwise carry the same five known divergences as
before Sprint 4 — three short fixtures with no fitted heating slope, and the
13-month fixture's pre-2024 invoices — so 66 checks run: 61 pass, 5 known, 0
failures. One account fewer is recommended to switch plan, on a cohort whose
solar households' usage is no longer counted twice.

The completeness fix landed as brief 1 predicted: every solar household and
fixture 01 now count 48 half-hours a day, not 96. Because nothing in serving now
has `interval_count > expected_intervals`, changing `DayUsage.is_complete` from
`>=` to `==` would not move a single row today — it is still the honest test.

### Hardship, for information only

The backend reads no hardship table, so nothing is asked here. The weekly replay
caught all 3 gradual accounts before arrears began, 51, 18 and 17 days ahead
(median 18 against a 21-day target — **missed**), with 0 early outreaches across
55.3 on-time account-years. The sudden-stop profile is not caught, by design: it
stops paying with no warning sign first. In the live assessment as at 2027-08-28
there are no arrears outlooks and no early outreach at all, because the planted
accounts' triggers fall before the served window; the replay, not that run, is
the measure of the rule.
### Addendum, 18 Sep 2026 (raised in review, after brief 2 was handed over)

One operational coupling that neither brief states, and that changes where a
support question gets diagnosed. It asks for **no code change on either side**.

**A household with no recent detection now has no forecast either.**
`hdd-linear-v3` projects the remaining days at the net baseline **plus**
`detected_load_kwh_day`, so `mart_forecast_input.is_forecastable` now also
requires the detection to exist: at least
`detected_load_min_days` = **7** assessed days inside the trailing
`detected_load_window_days` = **28** days ending at the snapshot date. Under v2
only the heating fit mattered.

The net effect of the rebuild was a gain, not a loss — forecastable snapshots
went 7,468 (v2) to 8,716 (v3), because the completeness fix gave the solar
households days they never had. But the new failure mode is real and it is
silent: a metering gap, a run of incomplete days, or a regression in the
detection models will now remove a household's **bill forecast** as well as its
breakdown, and the account simply stops appearing in `kea.bill_forecast`.

So when a customer or a staff member reports "my forecast disappeared", the
first thing to check is that ICP's assessed days in
`kea.mart_daily_detected_load` over the last 28 days, not the forecast job.
Seven days is a floor, not a target: a household that is assessed on only 7 of
28 days gets a forecast built on a 7-day detection mean.

---

## Backend brief 3 — the household with both panels and an EV (`V006`, `detect-v2`)

Written 20 Sep 2026, with Stage 5's code complete and **before** the
re-measurement. Nothing here quotes a measured figure yet; every number in
brief 2 and in design §15.10 still describes the pre-V006 cohort and will move
when the rebuild runs. This brief is about **shape and wording**, both of which
are already final.

### Why it exists

Sprint 4 covered solar households and EV households, never one that is both.
A meter records two things on two separate non-negative registers —
`import = max(0, load − pv)` and `export = max(0, pv − load)` — and **never
records generation**. So on a generating ICP:

| | what the import register holds | what may be said about load |
|---|---|---|
| the house is exporting | exactly 0 | **nothing.** Load is invisible, not small |
| daylight, not exporting | load − pv | it is **understated** by an unknown amount |

A 7 kW wallbox under a generating array can present as 2 kW of import — below
the 5 kW threshold — and we published that as a **portable charger**. A miss is
silence; a misclassification is a confident wrong answer, and that is what this
release removes.

### The four changes to what you read

1. **`kea.mart_daily_detected_load.masked_intervals`** (`smallint`, nullable) —
   half-hours of that NZ day the import register could not read in full. `0` for
   every household without panels and for every night. **NULL means the row
   predates detect-v2**, not that nothing was hidden; both tables are
   TRUNCATE-and-load, so the first detect-v2 publication leaves none behind.
2. **`kea.mart_charging_session.masked_half_hours`** (`smallint`, nullable), and
   **`charger_class` is now NULLABLE.** ⚠️ **This is the breaking one.** A reader
   that branched on two classes needs a third branch. Above zero masked
   half-hours, `confidence` is capped at `'low'` and `charger_class` is either
   `'high_power'` or NULL — never `'low_power'`, which is the claim the release
   exists to refuse. (`'high_power'` survives masking because PV only ever
   subtracts: a run that cleared 5 kW anyway really did.)
3. **`kea.ev_scenario.charging_pattern` gains `'solar_soak'`**, on both
   scenarios. ⚠️ **It may carry a negative `saving_vs_baseline_nzd`** — both
   CHECKs were relaxed for it. On Time of Use, midday import the panels did not
   cover sits in the most expensive window, and the honest answer is sometimes
   "your night rate still wins". A losing row is published, not suppressed, so
   the UI needs to be able to render one.
4. **No forecast change.** `ev_kwh_low/high`, `ev_half_hours`, `detected_class`
   and `is_assessed_day` are all deliberately unchanged, so `mart_forecast_input`
   and `hdd-linear-v3` see exactly what they saw under detect-v1. Nothing in
   `kea.bill_forecast` moves because of this release.

### The wording rule, which is the point of the whole release

⚠️ **A NULL `charger_class` is not "no EV found."** The session is published
with its kWh, its hours and its window; only the wallbox-against-portable
distinction is withheld. For a generating household the breakdown needs a
sentence of its own, something like:

> *"We can only see what you bought from us. While your panels were generating,
> we cannot tell what you used."*

Rendering a blank, or falling back to the old default class, would restore the
exact defect this work removes.

### What we are NOT giving you, and will not

- **A self-consumption percentage.** Not computable from two non-negative
  registers: the denominator — generation — is never measured. A measured
  *export headroom by time of day* would be sound and is its own piece of work.
- **A reconstructed PV curve in a published model.** That is an estimate inside
  evidence (design §15.2). The evaluation may reconstruct, because there the
  generator's output is known; a real customer's is not.
- **A recall target on masked sessions.** Where the array covers the whole draw
  the import register reads 0 and no run exists to find. That is the meter's
  limit, not the ruleset's.

### Gates already in place on our side

`assert_masked_runs_have_no_charger_class.sql` (dbt singular test) and V006's
`charging_session_masking` CHECK both refuse a `low_power` claim on a masked
run, so a bad build fails at `make dbt-test` rather than an hour later in the
publication. `design/serving_read_contract.json` carries
`mart_daily_detected_load.masked_intervals`, so `ServingReadContract` (in
`make ci-serving-db`) fails if it is renamed, dropped or retyped.
⚠️ **`mart_charging_session` is not in the read contract at all** — it never
was, because nothing in the contract said you read it. If you do read it, or
intend to, say so and we will add the table and both columns; until then
`masked_half_hours` and the nullable `charger_class` are guarded only by V006's
CHECKs and the dbt test, not by the contract test.

### Re-measured 20 Sep 2026 — figures you can now quote

Release `demo-20260920T175812`, dbt 331 PASS / 0 WARN / 0 ERROR, `make ci`
green (including `ci-serving-db` replaying V006 on a throwaway Postgres).
**63 figures, 15 with a threshold, 13 met**; the two misses are the daily-bounds
share and the hardship lead, both of which missed before this release as well.

| | |
|---|---|
| `low_power` claimed on a run the panels hid | **0** (target 0) — the gate this release exists for |
| recall, sessions the meter saw whole | **100%** (185 of 185) |
| recall, sessions the panels hid | **43.8%** (56 of 128) — **no target, and there never will be one** |
| sessions published with no class at all | 28, all on the midday host |
| accounts offered `solar_soak` | **8 of 8** generating accounts; median saving $277.53 (`add_ev`), $58.85 (`shift_detected`) |
| `solar_soak` rows carrying a negative saving | 0 in this cohort — but the CHECKs allow one and the UI must still render it |
| high_power precision / recall, whole cohort | 100% / 100% (349 of 349), unchanged |

⚠️ **Two of the three hosts are controls, not seasonal cases.** The 23:00 host
scored a bill-driver step ratio of **0.992** — panels change nothing in the dark,
which is the proof detect-v2 is targeted. The 17:30 host recorded **zero** hidden
sessions in the whole year: a 7.2 kW wallbox outdraws any array here at 17:30
even at midsummer, so the charge stops the export that would have hidden it. Only
the 11:00 host is masked (step ratio 0.202), and it carries the whole hidden-recall
figure. Do not expect a seasonal swing from the evening household.

**No number in brief 2 moved.** The per-shape daily-bounds figures are identical
to six decimal places (`ev_wallbox_7kw` 0.555294, `ev_portable_2kw` 0.440367,
`hot_water_3kw` 0.676187), and the pooled figure excluding the new households
reproduces the old one exactly at 0.652322. The pooled headline reads 61.6%
rather than 65.2% only because the new shape joined the pool.

The dashboard's new **section 7 · When the panels are in the way** has been
rebuilt against this release (dashboard 11, 38 cards, `--check` clean).

---

## Backend brief 4 — the home battery (`V007`, `V008`)

Written 1 Oct 2026, after the release it describes. The shape, the wording and
the figures below are all measured on `demo-20261001T130219`.

### What changed in `kea.solar_estimate`

Each system size used to have one row. It now has up to three:

| `battery_kwh` | `battery_dispatch` | the row assumes | written for |
|---|---|---|---|
| 0 | NULL | panels alone — exactly the rows there were before | every estimated account |
| 13.5 | `self_consumption` | a battery that stores only what the panels would export | every estimated account |
| 13.5 | `grid_charge` | the same battery, also filled from the grid in the plan's cheapest half-hours | accounts on a plan with more than one import rate |

- ⚠️ **A reader keyed on `(account_id, system_kw)` now finds two or three rows.**
  `battery_kwh = 0` gives the old panels-only answer; add `battery_kwh` and
  `battery_dispatch` to the key to read the rest.
- **On a battery row `install_cost_nzd_*` includes the battery** (12,000–18,000
  NZD on top of the panels), so payback is still cost ÷ saving.
- **`self_used_pct_*` counts only solar energy**, including the solar share of
  what the battery gives back. Grid energy that passed through the battery is
  never counted.
- Both columns are in `design/serving_read_contract.json`, so
  `ServingReadContract` fails if either is renamed, dropped or retyped.

### Wording rule

- Name the battery the row assumes: "with a 13.5 kWh home battery", and for a
  `grid_charge` row, "also charged from the grid overnight on your Time of Use
  plan" (or "at weekends" on the Weekend plan).
- A `self_consumption` row must not imply grid charging: "it stores only what
  your panels would otherwise export".
- ⚠️ **A battery row is not always the better row.** It saves more each year
  and usually pays back later, and on a large array a `grid_charge` row can
  save slightly less than the `self_consumption` one in a sunny year. Show
  the rows side by side; never pick one for the customer.
- As for panels: always the range, "simple payback", and the
  `assumptions_version` (`sprint4-assumptions-v3`).

### Figures you can quote

Medians over the estimated households, low – high:

| system | households | saving a year | used at home | payback, years |
|---|---|---|---|---|
| 5 kW, panels alone | 36 | $904 – $1,116 | 32.4 – 40.5% | 9.0 – 16.6 |
| 5 kW + battery | 36 | $1,373 – $1,785 | 75.5 – 85.5% | 12.4 – 24.1 |
| 5 kW + battery, grid-charged | 20 | $1,585 – $1,859 | 69.9 – 77.5% | 11.9 – 20.9 |

For the same 20 households, the grid-charged battery shortens the payback
against the surplus-only one most on small arrays and on the Weekend plan: at
3 kW, from 14.8 – 31.0 to 11.9 – 21.6 years on Weekend and from 14.2 – 29.0 to
12.6 – 21.9 on Time of Use. At 7 kW on Time of Use the two are within a few
months of each other.

### What we are NOT giving you

- **A battery without panels.** The table requires `system_kw > 0`; a
  battery-only what-if is a separate piece of work.
- **Selling stored energy back to the grid.** Kea's buy-back is flat, so it
  would never pay; no row assumes it.
- **Grid charging on a flat plan.** There it only loses the round trip.
