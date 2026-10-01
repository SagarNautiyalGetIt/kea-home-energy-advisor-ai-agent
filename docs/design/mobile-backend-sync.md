# Mobile backend alignment

Checked against `contracts/openapi.json` and the route implementations on main
(`e7077ee`) on 1 October 2026. Mobile and website use the same `services/api`.
This change consumes existing endpoints; it does not change the frozen contract.

## Endpoint matrix

All Kea requests use the configured `backend-client.ts` base URL. Assistant and
voice streams use the same configured base with their streaming transports.

| Mobile feature | Current API path / method | Boundary |
| --- | --- | --- |
| Sign-in / demo account picker | `POST /api/auth/login`, `GET /api/auth/demo-accounts` | Demo login is opt-in; registration is not supported |
| Home / bill warning | `GET /api/households/{customer_id}`, `GET .../bill-shock` | Daily totals; costs and bill projections are estimates; demo source must be labelled |
| Day / Week / Month usage | `GET .../usage-series?start=YYYY-MM-DD&end=YYYY-MM-DD` | Dated daily totals, quality and nullable bands; no hourly/half-hourly interval field |
| Home scene | `GET .../home-energy` | Daily observation data; server currently reports `live_power_available=false` |
| Solar / annual sizing | `GET .../annual-demand` | Measured annual demand or explicitly labelled estimate; current main's Solar page uses this |
| Energy categories | `GET .../energy-breakdown` | Preserve confidence, basis and caveat; behavioural estimates are not measured appliance consumption |
| Connected appliances | `GET .../appliances`, `POST .../device-observations` | Only mapped complete daily sensor observations are measured device kWh |
| EV household context | `GET .../context`, `PUT .../context/ev` | User-confirmed context, not a measured charging reading |
| Billing / plans / profile | `GET .../billing`, `GET .../plans`, `GET .../profile` | Read-only published account views; backend has no profile write endpoint |
| Alert preferences | `GET/PUT .../alert-preferences` | Available persisted preference contract |
| Sparky | `POST /api/chat/stream` | Retain conversation ID, source labels and human-handover limits |
| Voice | `POST /api/voice/stream` | Opt-in provider readiness, not guaranteed by a working text chat |
| Payments / saved payment methods / plan switching / profile writes / AI feedback / attachment uploads / refresh token | Configurable client paths only | No default supported endpoints in this contract. Keep unavailable/error states; do not claim success or invent routes |
| Home Assistant | User-owned HA `/api/states`, `/api/config`, `/api/history/period/...` | Separate server and credential; discovery names are not electricity readings |

## Usage fixes

- Remove the unsupported `/usage/day` request and fabricated interval timestamps.
- Request actual dates for all three chart periods and comparison selections.
- Accept the single point returned for a daily aggregate.
- Month charts show up to four available calendar months, but the headline and
  band totals represent only the selected month, not all chart bars combined.
- Validate customer identity, real unique ordered dates, matching array lengths,
  reading quality, finite nonnegative values and total consistency.
- Keep missing dates and null bands unavailable. Do not assume tariff time windows
  from the band names or claim derived daily costs are billing invoices.
- Label demo usage and estimated readings/costs, including comparison data.
- Show actual/expected date coverage for both selections. Suppress percentage
  changes for incomplete headline periods and comparison overlays for incomplete
  chart windows so a missing day or month cannot shift into another date's slot.
- Clear previous-selection data while fetching; show an error with Retry after
  failure, and a distinct empty state when the server returns no readings.
- Load energy breakdown with the same real-data default as other feature clients.

## Verification and integration

`npm run typecheck` regenerates the ignored mobile types before strict checking,
so a clean checkout does not depend on a stale or missing generated file.
Run mobile lint and tests; native export is a bundle check, not device validation.
Written iOS/Android and second-machine confirmation remains required before merge.

PR #255 also edits the old Day usage loader. This implementation replaces that
loader for every period; review the overlap explicitly. Do not independently merge
both and keep an old `/usage/day` or speculative `intervals` fallback. PR #256
must retain energy-category evidence labels and a theme-aware sheet background.

## Remaining product limits

- A read-only backend cannot make locally saved profile edits visible on the
  website. The mobile editor must explicitly say changes stay on this phone.
- On-phone Sparky requires a supported native development build; Expo Go has no
  native inference module. Downloading a model must not silently enable local
  answers or give it account data.
- Physical-device rendering, keyboard behaviour, reduced motion and model download
  still need teammate confirmation. Unit tests and green website CI do not prove
  these phone behaviours.
