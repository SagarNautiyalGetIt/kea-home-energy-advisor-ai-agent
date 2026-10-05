# Kea Energy mobile

React Native client built with Expo SDK 57, TypeScript, and Expo Router. It
shows the customer dashboard, usage, Sparky, billing, plans, profile, and settings.

The dashboard's interactive 3D Kea Home combines an orbitable model, weather,
source highlighting and an opening reveal. Its conduit layout and illustrative
energy-dispatch model draw on
[Akash Nair's Kea Energy Home](https://github.com/nair-akash/kea-energy-home).
See [the attribution and MIT license](assets/kea/KEA_HOME_ATTRIBUTION.md).
The scene fetches regional modelled New Zealand weather from
[Open-Meteo](https://open-meteo.com/) and refreshes it every 15 minutes while
the app is open. Weather and sunlight influence the illustrative power flows;
fresh mapped sensor readings can drive measured paths separately. Demo energy
values are examples, not customer meter data. If weather is unavailable,
the screen offers a retry instead of inventing current conditions.

## Run locally

From the repository root:

```bash
make mobile-install
make mobile-types
make mobile-dev
```

Scan the Expo QR code from an iOS or Android device. For a browser preview, run
`make mobile-web`. From this directory, the equivalent commands are `npm ci`,
`npm run start`, and `npm run web`.

To test the native on-phone Sparky model and Home Visual Highlight with an
Android phone, use the [Android phone validation runbook](../../qa/android-phone.md).
Expo Go can preview the rest of the app but cannot load the local inference
library; the runbook builds and verifies a development APK.

## Backend integration

Set `EXPO_PUBLIC_API_URL` to the backend origin on a physical phone. The emulator
defaults are in `src/lib/backend-client.ts`. Values prefixed with `EXPO_PUBLIC_`
are bundled into the client and must never contain private keys.

Live API data is the default. Set `EXPO_PUBLIC_USE_REAL_DATA=false` only for an
explicit UI preview. Sparky always uses `/api/chat/stream`; if the API is offline,
it reports an error rather than inventing a customer answer. Usage charts show
only time periods actually returned by the backend.

The energy breakdown comes from `GET /api/households/{customer_id}/energy-breakdown`
and describes behavioural categories, not named appliances. Settings calls
`POST /api/homelink/discover` on demand. That scan runs on the API server's LAN,
not the phone's LAN, and supplies device names only. Actual device energy requires
a supported, consented integration that returns measured readings. No such mobile
connector is active yet.

Connected surfaces: demo sign-in, dashboard and bill-shock assessment, daily
usage, behavioural energy breakdown, read-only billing and plan catalogue,
profile read, alert preferences, and streaming Sparky. Plans display published
prices and known account state; switching is disabled because there is no mobile
write route. No card or payment data is shown as if it came from Kea.

Demo login returns a household-bound temporary bearer token. This is synthetic
demo identity, not production authentication. Configured production middleware
supports issuer-verified household access; the local demo does not prove that
an identity service or its authorization is deployed and verified.

## Intentional frontend-only data

- News, notification previews, and FAQs remain static demonstration/content
  data in `src/data/mock.ts`.
- `EXPO_PUBLIC_USE_REAL_DATA=false` enables explicitly labelled UI preview data.
- The dashboard house is a visual scene. Live path readings require a configured,
  consented Home Assistant sensor mapping; missing or stale paths stay off and
  are not mixed with illustrative readings when measured data is available.

The current backend contract provides dated daily, hourly and tariff-band
analytics. Seeded July households use explicitly synthetic half-hour profiles
that reconcile to their daily totals. Missing genuine intervals or tariff
mappings stay unavailable; demo shapes must not be treated as measured customer
readings. Detailed invoice charge lines and payment transactions remain outside
the available account tools. See the [interval and band contract](../../docs/mobile-usage-time-bands.md)
and [Sparky account inventory](../../docs/sparky-account-coverage.md).

## Known integration constraints

- Real customer use needs a configured, independently verified identity service
  and server-side household authorization.
- Device-level energy needs consented connectors and measured or rated readings;
  mDNS names and whole-home meter totals cannot provide it.
- EV ownership and charging schedule answers need typed, account-scoped local
  persistence before Sparky can reuse them across sessions. A yes to ownership
  alone does not confirm that a night rise was charging.
- The `Keep me logged in` control defaults to off, but session persistence is
  not yet conditional on that control.
- `support@kea-energy.example` is placeholder support content and must be
  replaced before production release.

The generated models come from `../../contracts/openapi.json`, and the web
client's request/SSE handling in `../web/src/lib/client.ts` remains the reference
for the frozen backend contract. Implementation and release limits are recorded
in the [mobile release notes](../../docs/mobile-immersive-release.md) and
[security guide](../../SECURITY.md).

## Checks

```bash
make mobile-check
```

That generates the mobile API types, runs unit tests, ESLint, strict TypeScript
checking and Expo Doctor, then creates production bundles for web, iOS, and
Android. Run `npx expo install --check` after dependency changes.
