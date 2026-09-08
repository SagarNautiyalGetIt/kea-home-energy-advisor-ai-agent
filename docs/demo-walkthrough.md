# Local demo walkthrough

Use this walkthrough to present the Kea Energy customer portal in about 5–10
minutes. It focuses on the dashboard, computed energy facts, Sparky, and the
handoff to human support. It works with the five built-in household fixtures.

For installation, use the [Windows setup guide](windows-setup.md) or the
[repository setup instructions](../README.md#start-here).

## Before the demo

- Start the API on port 8000 and the frontend on port 5173. Keep both terminals open.
- Enable `KEA_DEMO_LOGINS=1`. For the simplest demo, use `KEA_PERSIST=0`.
- Open <http://127.0.0.1:8000/api/health>. Confirm `status` is `ok` and note
  `data_source`, `recording`, and `model_ready`.
- If `model_ready` is false, present this as a **template-fallback demo**. The
  calculations still run, but no language model is composing the answers.
- Use synthetic demo accounts only. Dollar amounts are estimated at the project's
  illustrative 30c/kWh rate, not a live Kea customer tariff.

Voice, alert delivery, and PostgreSQL persistence are not required for this route.
The nine `DEMO-ACCT-*` accounts need the separately loaded data-platform marts;
do not use them for a fixture-only demonstration.

## 1. Sign in as the July household

Open <http://127.0.0.1:5173> and enter:

| Field | Value |
|---|---|
| Email | `july@kea.example` |
| Password | `julyhouse24` |

Select **Login**, then **Explore dashboard** if the welcome dialog appears.
Check that the greeting names **July Household**.

Suggested explanation:

> This is a sample household. We will look at its usage, explain the bill, and
> show how the app handles questions it cannot safely answer.

Demo credentials are defined in [the API's account list](../services/api/app/auth.py).
They are not production authentication.

## 2. Explain the dashboard

For the current July fixture, check these values:

| Dashboard item | Expected value |
|---|---|
| Latest day's cost | 2.31 NZD |
| Usage so far | 300.0 kWh |
| Cost so far | 90.00 NZD |
| Projected this cycle | 90.00 NZD |
| Last 7 days | 70.7 kWh |

Point out the **Power Bill Shock Warning** and the illustrative tariff label.
This fixture contains a complete July cycle: the cycle has closed, so the displayed
amount is not a live prediction partway through the current month.

Suggested explanation:

> The app compares this household with similar homes. It does not claim to know
> this customer's previous bills. The warning explains the difference using
> calculated usage and an illustrative tariff.

The hourly chart is labelled **illustrative shape**. Do not describe it as measured
hour-by-hour readings. The separate Usage page also contains illustrative series;
use the dashboard and API-backed Sparky responses for this walkthrough's household
data claims.

If the dashboard says **Usage data unavailable**, pause and fix the API error
before presenting its figures. The Windows setup guide covers the missing
`Pacific/Auckland` timezone database error.

## 3. Ask Sparky why the bill is high

Select **Ask Sparky AI** on the dashboard, or open
<http://127.0.0.1:5173/assistant> while signed in.

Ask:

> Why is my power bill so high?

Wait for the answer to finish before sending another question. Check that the
selected household is still `H-JUL` if the household selector is visible.

The explanation should distinguish sustained extra usage from the one-off spike.
The current fixture's computed facts include approximately **2.4 kWh a day** of
extra usage, **$292 a year** at the illustrative rate, and **$2.52** attributable
to the spike. Treat annual cost as an extrapolation, not an actual annual bill.

Suggested explanation:

> Python computes the facts. When a model is available, it writes an explanation
> from those facts and the number checker checks its figures. If the model is
> unavailable, the app can assemble a template directly from the computed facts.

Wording can vary with the configured model. Do not rehearse one exact paragraph
as the only acceptable answer. In fallback mode, do not claim that a model's
answer passed verification: the API explicitly reports a template fallback.

## 4. Show a focused question and a limitation

Ask these one at a time:

| Question | What to look for |
|---|---|
| “Which day was my highest usage?” | A daily peak answer. The July fixture peaks on day 11 at 17.6 kWh. |
| “Which appliance uses the most electricity?” | An explanation that aggregate usage cannot identify a specific appliance. It should not invent an appliance diagnosis. |

Suggested explanation:

> A useful answer includes knowing what the data cannot tell us. A high reading
> alone does not establish which appliance caused it.

These expected outcomes are grounded in the current fixtures and routing code.
If a response differs, inspect its facts and intent rather than explaining away
the mismatch during the demonstration.

## 5. Show the human-support path

Ask:

> I cannot pay my bill.

Look for the affordability message and **Talk to a human** button. The route should
set `escalate_to_human` to true. Explain that payment difficulty is directed toward
a person rather than handled solely through automated advice.

In the current web implementation, selecting the button displays a message that
a Customer Care request has been prepared. **It does not demonstrate a delivered
support ticket, a phone call, or a staff member being notified.** Present it as the
handoff interface, not an operational contact-centre integration.

## 6. Review the verification log

In the same browser tab, open <http://127.0.0.1:5173/verification>.
This operator view is available by URL and is not in the customer navigation.

Review the questions just submitted and explain the distinction between:

- Model-written answers whose figures passed the checker.
- Template answers assembled directly from computed facts.
- Rejected or unverified figures, if any are shown.

Quote only the totals actually displayed. A log for this run is not proof that
every possible model response is correct. The log uses browser `sessionStorage`;
it is not the durable database audit record, and it is separate from backend
recording controlled by `KEA_PERSIST`.

## Optional: demonstrate another household

Sign out through the profile menu and sign in with another fixture account.
Check the greeting before continuing, so the dashboard and narrative refer to
the intended household.

| Scenario | Email | Password | Suggested question |
|---|---|---|---|
| Cold snap | `cold@kea.example` | `coldsnap24` | Was that just the cold snap? |
| One-off spike | `spike@kea.example` | `spikeday24` | Which day was my highest usage? |
| Usage collapse | `drop@kea.example` | `hardship24` | I cannot pay my bill. |
| Low steady usage | `tariff@kea.example` | `lowfixed24` | Could another plan save me money? |

Plan comparisons are illustrative; they do not perform a real tariff switch.

## Rehearsal checklist

- [ ] Login identifies the intended household.
- [ ] Dashboard figures load and the tariff disclaimer is visible.
- [ ] The presenter distinguishes sample data and illustrative charts.
- [ ] Sparky responds to the bill and peak-day questions.
- [ ] The appliance question does not produce an unsupported diagnosis.
- [ ] The affordability question surfaces the human-support option.
- [ ] The verification log reflects the questions asked in this browser session.
- [ ] The presenter identifies template fallback or model narration accurately.

If a check fails, record the question, household, observed result, and relevant
API error for the team. Avoid including real customer information in screenshots
or issue reports.

## Validation scope

The Windows setup session verified July login, the populated dashboard, the
bill-shock endpoint, and a non-streaming bill-explanation response in template
fallback mode. The remaining walkthrough steps are based on the current frontend,
router, and fixtures and should be rehearsed before a presentation. Model-backed
narration, voice, delivered alerts, and database persistence were not verified
in that session.
