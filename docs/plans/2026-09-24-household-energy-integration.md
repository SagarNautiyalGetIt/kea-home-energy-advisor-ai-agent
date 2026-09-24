# Household energy integration and mobile repair

Date: 2026-09-24

Owner: Kea mobile/API
State: Draft PR ready; production and native evidence pending

## Ground rules

- Meter intervals support household totals, timing patterns, and estimates. They do **not** identify an appliance by themselves.
- A discovered device name is not energy telemetry. Appliance kWh is shown as measured only when an energy meter reports it; a nameplate/runtime estimate must be labelled as such.
- Keep every observation, preference, weather lookup, and scene tied to the selected household. Missing readings stay unknown, never zero or simulated live values.
- The AI receives calculated facts with provenance and confidence. It may ask whether an unexplained overnight pattern could be EV charging, but cannot confirm that attribution from the user's answer alone.

## Work and acceptance criteria

| ID | Work | Acceptance | State |
| --- | --- | --- | --- |
| D1 | Trace API, app data sources, auth, charts, and Home scene | Inventory of contract mismatches and failure paths recorded below | Done |
| B1 | Persist daily connected-device observations per household with validation and provenance | Measured kWh comes only from a device meter; idempotent sync; household isolation; missing is distinct from zero | Done in code; database migration not applied to production |
| B2 | Add consented Home Assistant energy sensor ingestion and discovery handoff | Selected energy entities yield complete daily kWh; unavailable hubs/sensors report honest states; discovery identifies the API server's LAN only | Done in code; needs a compatible user-owned sensor for live proof |
| B3 | Serve a household-scoped energy snapshot and appliance breakdown for mobile | Home flow animation uses fresh mapped on-device power readings only; backend serves dated daily energy, provenance, confidence, and missing states | Done in code |
| B4 | Ground AI in measured device facts and persisted EV answer | Short formatted answer integrates meter and device evidence, asks one useful clarification for ambiguous overnight use, remembers answer per household without upgrading it to measurement | Done in code; live model verification requires a ready provider |
| M1 | Repair login/API error handling and populate data-backed charts | No silent local login on API failure; successful API responses populate supported graphs; unsupported time bands show unknown rather than fixed percentages | Done in code and web preview |
| M2 | Wire home scene and weather to the household | No fixed live demand, battery percentage, synthetic EV, or Auckland-only weather for all homes; unknown values do not animate | Done in code and web preview |
| U1 | Port Kea Energy Home's source colors and time/weather mood into an edge-to-edge scene | Sky responds to household location/time/weather; ground fades into app black; source colors match Home project; no external weather link or preview/card language | Done in code and web preview |
| U2 | Bring Home swipe blur, blue accents, breakdown selection, and bill chart into one design language | Home blur follows scroll; outline blue matches Usage graph; requested copy removed; bill graph uses a thick segmented semicircle inspired by supplied screenshot | Done in code and web preview |
| U3 | Fix Account list warning and redesign Sparky with gentle app-wide motion | Account menu keys stable; original Kea companion has idle and thinking motion; common controls and page entrances honour reduced-motion settings | Done in code and web preview |
| D2 | Regenerate shared OpenAPI, update startup sequence, and record source provenance | Contract matches routes; local motion reference is separately logged with attribution; no reference code or assets enter Kea | Done in code and Vault |
| V1 | Verify integration and record limits | Backend tests, mobile typecheck/lint, contract tests, web/mobile bundles, and a rendered app pass where runnable; document device/account prerequisites | Done locally; physical devices and second machine pending |

## Findings from initial trace

- `DemoHomeView` calculates energy from weather with fixed battery, load, EV, and grid inputs. Weather affects appearance, not measured household electricity.
- `/api/homelink/discover` scans the **server** network and returns names only. Provider connectors are stubs; no device measurements are persisted.
- Existing `homelink` schemas and arithmetic already distinguish measured, rated, and inferred device observations, but nothing supplies production observations to them.
- `getDashboardView` treats a household request and bill-shock request as one all-or-nothing load. The mobile auth provider can accept a local fallback account after an API failure, which explains a signed-in page with a dashboard error.
- Dashboard hourly arrays are empty in real-data mode because the API contract does not supply an hourly series yet.
- The existing Home scene uses an independent Auckland weather card, a rounded preview card, simulated pulse routes, and pale ground. Its weather source opens an external site.
- The current bill chart is a thin ticked speedometer. The supplied image is a visual reference for a thick, soft segmented arc; its website text is not product instruction.
- The fixture API previously split each daily total into peak, off-peak, and night with fixed percentages. That invented a time-of-day shape. Fixture band arrays now contain `null`; only households with interval-derived bands get time-band figures.
- The Account screen warning was a missing React key on the mapped menu rows. A stable route key fixes the list identity; the earlier browser warning has not reappeared in the current render.

## Dependency and rollout order

1. B1–B3 establish truthful, household-scoped data contracts and storage.
2. B4 combines those facts with user-confirmed context without overstating certainty.
3. M1–M2 wire the screens, then U1–U2 polish the design against live/empty states.
4. V1 checks both connected and unconnected households. A real smart-device verification requires a user-owned compatible energy sensor and permission to connect it.

## Remaining integration boundaries

- The user currently has no hub or energy-monitoring device. Connected appliance kWh, live source pulses, and an EV charging attribution cannot be demonstrated against their home. The empty state is intentional and truthful.
- Expo Go can connect to a Home Assistant URL and read its energy/power sensors, but the existing network discovery runs on the API server's LAN. It cannot truthfully claim to have scanned the phone's LAN. A phone-side mDNS implementation would need a compatible native module/development build and local-network permission.
- Demo account tokens scope new device and EV writes. Production sync is disabled until real customer authentication and authorization are available. A local `KEA_PERSIST=0` run loses server-side observations at restart; the EV yes/no answer is restored from the device for that household.
- The API's daily meter records and Home Assistant's latest complete device day can differ. Home displays both dates, and Usage shows device readings separately from its selected meter period.
- The bill prediction is a projection. The modal now spells out the comparison basis and maps internal reason codes into customer language.

## Local verification

- Full backend suite passed after the prompt and API changes; focused household and device tests cover authorization, idempotent readings, EV memory, missing time bands, and the night-load threshold.
- Mobile lint, strict TypeScript, and Expo Doctor (21/21 checks) passed. Eleven mobile tests passed, including 23-hour and 25-hour Auckland energy days, meter reset arithmetic, and incomplete-day rejection. SDK patch versions were aligned and legacy `expo-cli` and redundant React Native types were removed.
- Android and iOS Expo exports completed; the web preview was inspected at desktop and phone widths. These bundle checks do not establish native runtime behavior.
- The OpenAPI file was regenerated from the current routes and both mobile and web API types were regenerated. Web lint, type checking, and production build passed.
- No Home Assistant hardware or production identity was available, so ingestion, native gestures, and real model narration still need device and provider acceptance evidence before merge.

## Pre-mortem before the storage migration

**Failure statement:** It is 8 October 2026. We shipped appliance figures, and a customer saw an invented or another household's reading.

### Tigers

| Risk | Evidence | Disposition |
| --- | --- | --- |
| Anonymous clients write a different household's observations | Existing `/auth/login` is demo-only and the API's household routes do not establish a production principal | **Blocking:** restrict new writes to demo mode with an account-bound token; production must acquire customer auth first |
| Device discovery is mistaken for measured energy | Current mDNS result contains names but no power; current mobile scene synthesizes kW from weather | **Blocking:** never convert discovery or weather into kWh or kW; show unknown when no sensor exists |
| An old meter reading animates as live power | Existing household response is a dated daily total, not a current power feed | **Blocking:** carry observation timestamps and units; only animate current power observations within a defined freshness window |

### Paper Tigers

- **Every user must own a hub now** → dismissed: the user has no device; an unconnected household can still render meter-backed usage with empty appliance and flow states.

### Elephants for Akash

- Elephant: The backend has no production customer identity/authorization path. A real household cannot safely sync device measurements until that is supplied.

**Gate:** PASS for a demo-gated schema and local code; BLOCKED for production device-data ingestion until customer identity exists.

## Pre-mortem before publishing the mobile V2 pull request

**Failure statement:** It is 8 October 2026. The mobile V2 PR was merged as if it proved live appliance telemetry and native behaviour, then households saw missing or misattributed energy and a broken Expo build.

### Tigers

| Risk | Evidence | Disposition |
| --- | --- | --- |
| A fixture band split is shown as a household measurement | The API previously multiplied every daily total by three fixed shares | **Blocking:** return null time bands without interval rows and test the response |
| The PR suggests production identity or live device proof exists | Demo token gate is the only new write authorization, and the user has no energy sensor | **Blocking:** publish as draft with those limits explicit; keep production sync disabled |
| A changed endpoint reaches the PR with a stale contract | Repository CI regenerates `contracts/openapi.json` and fails on drift | **Blocking:** regenerate the contract and both generated TypeScript clients before pushing |
| Reference artwork is treated as original source | Bloub's upstream repository carries an MIT license and named author | **Blocking:** keep the local license/attribution; commit only Kea-original SVG and motion code |
| Native gestures, permissions, or rendering differ from the web preview | Only the web view and export bundles are available in this work session | **Track:** attach iOS/Android device evidence before merge; do not claim native validation |

### Paper Tigers

- **The new code changes the primary checkout or its saved stash** → dismissed: implementation is in a separate cache worktree; the primary checkout and `stash@{0}` remain untouched.

### Elephants for Akash

- Elephant: The team repository's Definition of Done requires both native platforms, a second machine, and an approving review. Those cannot be supplied by a local web preview or Expo export.

**Gate:** PASS to publish a draft PR with explicit limits and tests; BLOCKED to merge it as production-ready until production auth and native evidence exist.
