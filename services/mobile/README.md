# Kea Energy mobile

React Native client built with Expo SDK 57, TypeScript, and Expo Router. It
shows the customer dashboard, usage, Sparky, billing, plans, profile, and settings.

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

The demo login returns a customer ID without an access token. The shared client
supports token storage for a future identity contract, but this deployment does
not authenticate or authorize household access for real customers.

## Intentional frontend-only data

- News, notification previews, and FAQs remain static demonstration/content
  data in `src/data/mock.ts`.
- `EXPO_PUBLIC_USE_REAL_DATA=false` enables explicitly labelled UI preview data.
- The dashboard house illustration is a concept scene. It hides device figures
  in live mode because the backend has no solar, EV, or battery telemetry.

The current backend contract provides daily usage totals. Hourly readings,
time-band totals, detailed period costs, and every newly configurable endpoint
must be implemented or confirmed by the backend team. Until those contracts
match, the relevant screen will show its unavailable/error state rather than
customer-looking hardcoded data.

## Known integration constraints

- Real customer use needs an identity service and server-side household authorization.
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
for the frozen backend contract. Deferred work is tracked in
[`../../docs/tech-debt.md`](../../docs/tech-debt.md).

## Checks

```bash
make mobile-check
```

That generates the mobile API types, runs unit tests, ESLint, strict TypeScript
checking and Expo Doctor, then creates production bundles for web, iOS, and
Android. Run `npx expo install --check` after dependency changes.
