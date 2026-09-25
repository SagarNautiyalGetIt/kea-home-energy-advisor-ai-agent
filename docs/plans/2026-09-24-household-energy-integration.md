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

## Stable V2 follow-up — 25 Sep 2026

**Problem.** Mobile screens can still leave charts or fields blank when a request fails or asks for a date the backend has not supplied. The Sparky stream uses the same answer pipeline as web, but the mobile client must render every supported response type and keep safety wording truthful. Recent presentation changes also need to preserve legibility and the app's shared visual language when the keyboard or Home sheet moves.

**User outcomes.** A household can tell which figures are measured, which period they cover, and why a chart is unavailable. Sparky responds with an appropriately warm, concise tone without diagnosing a person or promising an action the service has not taken. Home and chat remain readable at compact heights, large text, and reduced motion.

| ID | Priority | Task and acceptance | Evidence to record | State |
| --- | --- | --- | --- | --- |
| S1 | P0 | Trace every mobile chart/blank field from API response through selector to screen; remove fixed customer-looking fallback values. For missing data, show a labelled unavailable state and retry where a request failed. | Reproduction, API payload, selector tests, rendered screen | Done in code and rendered preview |
| S2 | P0 | Serve household-scoped dated usage history where the repository actually has rows. Keep dates ascending and time-band values null unless measured; daily mode must not invent hourly readings. | Contract/API tests, generated OpenAPI, graph tests | Done in code; production auth pending |
| S3 | P0 | Audit Sparky's shared web/mobile answer path: guardrails, emotion-sensitive tone, sources, chart frames, and support handoff. Render supported evidence on mobile and remove unverified operational promises. | Pipeline and stream tests, mobile UI check | Done in code; live model proof pending |
| S4 | P0 | Preserve the attached keyboard and Home behaviour: compact 96px mascot/chip rail, tap-to-send, 5% scene opacity floor, unblurred heading/weather, and 140px sky fade behind the house. Remove any synthetic live flow or customer fixture inserted for a screenshot. | Lint/typecheck and rendered phone-size check | Done in code and rendered preview; native gesture proof pending |
| S5 | P1 | Review spacing, color, charts, motion, and empty/error copy against the app's existing tokens across Home, Usage, Bill, and Sparky. Respect reduced-motion settings. | Screen audit with before/after notes | Done in code and rendered preview |
| S6 | P0 | Update the existing Mobile V2 draft PR to **Stable v2 mobile**, run API/mobile/web checks and CI, and record remaining native, hardware, auth, and model-provider boundaries. | PR head/checks, plan, Vault handoff | Local checks done; CI and external acceptance pending |
| S7 | P0 | Fit Home art, card rail, graph controls, bill chart, Help, and Sparky start/keyboard states to compact and large phones without clipping; isolate account-specific screen state on household switches. | Rendered 320×568, 320×700, 390×844, 430×932 checks; mobile lint/typecheck | Done in web preview; physical-phone proof pending |

**Sequence.** Establish a reproducible API payload and screen state for S1/S3; fix selector and server contracts in S1/S2; preserve and verify layout in S4/S5; then run S6 gates. The source of truth is the selected household, so an unavailable result must never be filled by another account's fixture or a visual preview constant.

**Release boundary.** No compatible household energy sensor is present, and the demo API has no production customer identity. Device telemetry and native Expo Go interactions need real-device evidence before the draft becomes merge-ready. A web-sized preview and exported bundles are useful checks, not substitutes for that evidence.

**Implementation and review evidence.** The dated usage endpoint checks the selected demo token before returning history; tests cover no token, wrong household, missing dates, incomplete mart days, and supplier-estimated reads. Estimated intervals keep daily kWh visible with a quality label and withhold measured time bands. Weekly/monthly band totals require a complete selected period. Usage and Sparky remount on household switches so prior account data never appears on the next account's first frame. The default app path calls the API; the explicit local-preview path no longer invents fixed time-band percentages. In the rendered browser preview, compact Home (320×568), Usage (320×568 and 430×932), Sparky (320×700), Bill (320×568), and Help (320×568) fit without clipped primary controls. The web preview cannot prove native swipes or device permissions.

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
- Mobile lint, strict TypeScript, and Expo Doctor (21/21 checks in the initial V2 pass) passed. The Stable v2 follow-up has 23 passing mobile tests, including 23-hour and 25-hour Auckland energy days, meter reset arithmetic, SSE/chart parsing, dated usage gaps, incomplete periods, and estimated-read labelling. SDK patch versions were aligned and legacy `expo-cli` and redundant React Native types were removed.
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

## Pre-mortem before pushing the Stable v2 follow-up

**Failure statement:** It is 9 October 2026. The Stable v2 update was treated as production-ready, and one household saw another household's chat or historical usage while a customer received a false measured-energy or staff-handoff claim.

### Tigers

| Risk | Evidence | Disposition |
| --- | --- | --- |
| Historical usage leaks across households | Independent review found the new dated route initially had no token check | **Blocking before push:** require a matching demo token; cover missing and wrong tokens in API tests. Done. Production authorization remains a merge blocker. |
| Account switching briefly shows the old household's data | Usage and Sparky previously reset state only after a passive effect ran | **Blocking before push:** remount both screens using the household ID as a key, abort old requests, and clear account-specific data. Done in code. |
| A partial week or supplier-estimated interval is labelled measured | The selector summed every returned day; mart rows carry `estimated_count` | **Blocking before push:** require complete period coverage for time-band totals, carry daily quality, and withhold measured bands for estimated days. Covered by API and selector tests. |
| The app promises that a staff member has received a hardship chat | The escalation recorder has no staff delivery channel, while old copy implied live handoff | **Blocking before push:** state that the concern is recorded and direct users to verified bill contact details. Backend, mobile, and web copy changed. |
| Native gestures or safe areas differ from the browser preview | Browser checks and iOS/Android exports do not exercise an actual phone | **Track:** keep the PR draft; collect iOS and Android screenshots/recordings, sheet gesture, local-network permission, and second-machine evidence before review/merge. |

### Paper Tigers

- **The new chart fabricates a complete current week when only July demo rows exist** → dismissed: the live API and rendered Usage screen show an empty current period, the July availability range, and a user-triggered latest-period action; gap tests cover an incomplete week.
- **The primary checkout and saved stash will be overwritten** → dismissed: all edits and exports are in the isolated worktree or external cache, and the primary repository was left untouched.

### Elephants for Akash

- Elephant: Chat and several older household reads still accept a body/path customer ID without production authorization. The new route is demo-token scoped, but this is not a complete production customer identity model.
- Elephant: The repository Definition of Done requires a second machine, native iOS and Android evidence, green CI, and an approving review. Bundle exports and a browser viewport audit cannot satisfy that requirement.

**Gate:** PASS for a demo-scoped draft PR after local checks and CI; BLOCKED for ready-for-review or merge until production identity and the repository's native/review evidence are supplied.
