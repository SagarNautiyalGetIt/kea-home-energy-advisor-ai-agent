# Kea Energy mobile

React Native client built with Expo SDK 57, TypeScript, and Expo Router. It
implements the customer-facing authentication, dashboard, usage, Sparky,
billing, plans, profile, settings, support, notification, and payment flows.

## Run locally

For the tested LAN/tunnel commands, Expo Go troubleshooting, and coding-harness fast
path, see [`LAUNCH.md`](./LAUNCH.md).

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

Set `EXPO_PUBLIC_API_URL` to the backend origin. Optional endpoint overrides and
payment/push configuration are documented in `.env.example`. Values prefixed
with `EXPO_PUBLIC_` are bundled into the client and must never contain private
keys or server-side secrets.

The shared client in `src/lib/backend-client.ts` sends the access token as a
Bearer token, retries one `401` after refreshing the token, and keeps access and
refresh tokens in Expo SecureStore on native platforms. Non-secret session
display data is stored in AsyncStorage. Tokens are memory-only in the web
preview.

The following frontend flows have API adapters and loading, empty, and error
states ready for backend responses:

- login, registration, token refresh, forgot password, and change password;
- dashboard usage totals and backend-computed bill-shock warnings;
- daily, weekly, and monthly usage data;
- billing details, invoices, invoice payment, and payment-method add/delete;
- plans, current-plan selection, and plan-switch requests;
- profile read/update;
- notification-preference read/update and Expo push-token registration;
- Sparky streaming chat, feedback, attachments, and voice transport.

Login and registration responses must include `customer_id` and a non-empty
`access_token` (or `token`). They may also include `refresh_token`,
`display_name`, and `email`. The backend must authorize every household route
against the authenticated token instead of trusting the path or body
`customer_id` alone.

Card details are sent only to the configured payment provider's tokenization
URL. The Kea backend receives the returned payment-method token and must never
receive or log raw card numbers or CVC values.

## Intentional frontend-only data

- News, notification previews, and FAQs remain static demonstration/content
  data in `src/data/mock.ts`.
- When `EXPO_PUBLIC_API_URL` is absent, only the Usage screen can use isolated
  illustrative readings for frontend development. Its bill-shock warning is not
  fabricated; live warning data must come from the backend.
- Dashboard account metrics, billing, plans, and profile data do not invent a
  customer record while the backend is unavailable.

The current backend contract provides daily usage totals. Hourly readings,
time-band totals, detailed period costs, and every newly configurable endpoint
must be implemented or confirmed by the backend team. Until those contracts
match, the relevant screen will show its unavailable/error state rather than
customer-looking hardcoded data.

## Known integration constraints

- The current login backend must be extended to return an access token before
  the mobile login flow can succeed.
- The `Keep me logged in` control defaults to off, but session persistence is
  not yet conditional on that control.
- Endpoint paths are frontend defaults, not proof that the corresponding
  backend routes already exist. Coordinate request/response schemas with the
  backend team and update `.env.example` when a route differs.
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
