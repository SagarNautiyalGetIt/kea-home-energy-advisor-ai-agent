# Data Engineering / Data Analysis team

## You own

| Path | What |
|---|---|
| `data/` | Raw extracts, analysis notebooks, the data dictionary |
| `services/api/app/analytics/` | The engine that computes every headline number |
| `services/api/app/db/` | Models and the seeder |

`app/analytics/engine.py` is where every figure in the pitch comes from. CODEOWNERS
routes it to you.

## First hour

```bash
make setup
cp .env.example .env
make db
make api-migrate
make api-seed         # 5 households x 31 days x 48 intervals
make api-test
```

Then read [`../erd.md`](../erd.md) and
[ADR-0006](../adr/0006-postgres-in-sprint-2.md).

## The thing to internalise

**Every figure traces to a source.** This is the brief's standing rule and it is not a
documentation preference — it is the product. 61.9% of surveyed customers named "it might
give me wrong or made-up information" as their top concern, the largest single answer.
Preventing that *demonstrably* is the pitch.

So: a number in a notebook, a number in a slide and a number in the API are all held to
the same standard. Someone must be able to follow it back to the rows it came from.

The July household is the reference point. `tests/data/july_2026_daily.json` holds real
measured values and `test_analytics_july.py` fails if the engine drifts from them. If
your change breaks that test, assume the change is wrong until you can show otherwise.

## Rules specific to you

- **Dollar figures are illustrative, at 30c/kWh.** Kea's real tariff is not public.
  Anywhere a `$` appears has to say so — including in your notebooks.
- **Never name an appliance.** Half-hourly interval data cannot identify appliances. No
  amount of clustering changes that. The refusal is a demo line, not a limitation to hide.
- **No respondent-level survey data in this repo.** It was collected for analysis, not
  publication. Aggregates are fine; raw responses are not.
- **`data/raw/` is never edited by hand.** If an extract needs fixing, the fix is a
  script in `data/analysis/` so it is reproducible and reviewable.
- New analytics functions need unit tests. Definition of Done, not a suggestion.

## A worked example of the standard

When attributing bill overshoot, the published method flags one day and yields 10.9%; a
generic 1.5x detector flags two and yields 16.4%. Both are defensible. The commit kept
the published method as the default and put the looser one behind a flag — because the
number that reaches a slide has to have a citable method behind it, not the one that
looked better. Do that.

## Related

- [`../../data/README.md`](../../data/README.md)
- [`../erd.md`](../erd.md)
- [`../prd.md`](../prd.md)
