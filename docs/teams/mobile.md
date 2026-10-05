# Mobile team

## You own

`services/mobile/` — React Native, Expo, TypeScript, NativeWind / Tailwind.

## First hour

```bash
cd services/mobile
npm ci
npm run types        # generates src/api.d.ts from the committed contract
npx expo start       # opens Expo dev tools with QR code
```

Press:
- **`i`** to open in the **iOS Simulator** (macOS)
- **`a`** to open in the **Android Emulator**
- Or scan the terminal QR code using **Expo Go** on your physical phone (iOS / Android)

**You are not blocked on the backend.** `contracts/openapi.json` is committed, so types
generate from the contract file. Run `make api-dev` from the repo root in another terminal
when you want live responses.

---

## Target Devices & Pitch Demo

- **Both iOS and Android are supported equally.** All pull requests must function on both
  operating systems.
- **The live pitch demo runs on an iPhone.** Test thoroughly on iOS: check notch / Dynamic
  Island clearance, iOS navigation transitions, and Apple Human Interface Guidelines (HIG)
  tap target standards (minimum 44x44pt).
- **Device runbooks and release acceptance checklists live in [`qa/`](../../qa/).** QA runs
  manual acceptance testing of the mobile app on a physical phone; the test cases, report
  and open defects are linked from #349. Tag QA on a PR that changes a flow those cases
  cover, so the affected cases are re-run.

---

## Tier-1 Alert Channel: Push Notifications

Bill-shock prevention relies on proactive intervention before the bill arrives. Push
notifications are a **Tier-1 alert channel** alongside email:

- Handled via `expo-notifications`.
- Devices register their push token on launch with backend persistence.
- When the bill-shock assessment identifies anomalous usage or an impending threshold
  breach, a push notification alerts the customer immediately. That path is proactive and
  deliberately not the assistant: nobody asks a question to receive a warning, so it is a
  polled endpoint (`/households/{id}/bill-shock`) rather than a chat turn.
- Tapping a notification routes directly to the relevant household alert or conversational
  advisor context.
- **Graceful degradation:** If a user denies notification permissions, the app must not
  crash or re-prompt aggressively; fall back gracefully to in-app notification banners.

---

## The thing to internalise

Endpoint shapes are **frozen**. Implementations change behind them all sprint; the
contract does not. Build against it with confidence.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Provider, model, and whether the model is warm |
| `GET /api/households` | The five demo households |
| `GET /api/households/{id}` | Daily kWh + cost for one household |
| `POST /api/chat` | Non-streaming — integrate against this first |
| `POST /api/chat/stream` | SSE: `meta` → `token`* → `done` |

Start with `POST /api/chat`. Get your screens working non-streaming first, then integrate
the streaming SSE connection. Debugging mobile UI layout and an SSE parser simultaneously
is two problems at once.

---

## Rules specific to you

- **Surface `escalate_to_human` prominently.** Under the Electricity Authority Consumer
  Care Obligations, human escalation is closer to a legal duty than a feature. If
  `meta.escalate` is true, the user must see an unmissable escalation action on screen.
- **Every dollar figure is labelled illustrative.** Kea's real tariff is not public; the
  backend computes at an illustrative 30c/kWh. Any mobile screen with a `$` must say so.
- **Never name an appliance**, even if it would make a cleaner mobile UI. Half-hourly
  meter data cannot identify appliances — the refusal is a deliberate demo line.
- **Handle Safe Areas meticulously.** Use `react-native-safe-area-context`. Never let
  headers collide with the iPhone status bar / Dynamic Island, and never let bottom tabs
  overlap the home indicator.
- **Regenerate types after backend changes.** Run `npm run types` whenever
  `contracts/openapi.json` is updated.

---

## The traps

### 1. The Localhost Networking Trap
Mobile runtimes do not resolve `localhost` to your host development machine:
- **iOS Simulator:** `http://localhost:8000` works.
- **Android Emulator:** `http://localhost:8000` points to the emulator itself. You must use
  `http://10.0.2.2:8000`.
- **Physical iPhone (Expo Go):** `localhost` points to the phone. You must use your computer's
  local Wi-Fi IP (e.g. `http://192.168.1.50:8000`).

Always read the base URL from an environment variable (e.g. `EXPO_PUBLIC_API_URL` in `.env`),
and keep a working `.env.example` committed.

### 2. SSE Streaming in React Native
React Native's native fetch does not behave identically to a web browser:
- Standard `EventSource` cannot send a `POST` request with a JSON payload.
- SSE chunks can be split mid-frame over cellular or Wi-Fi networks.
- `src/lib/api.ts` accumulates into a buffer and splits on `\n\n`. It uses
  **XMLHttpRequest, not fetch** — React Native has no `ReadableStream` response body, so
  `res.body` is null on Hermes and a fetch-based reader silently gets nothing. That is not
  a preference; it is the only thing that streams here.

### 3. Five event types, and `reset` is the one to read about
`token` arrives per chunk as the assistant writes. But it works in *rounds*: it may write
a line ("Let me pull up your July bill") and then decide it needs a lookup first. `reset`
says that round turned out to be a lookup — drop what you rendered. A client that ignores
it shows "Let me check that." glued to the front of every answer.

`tool` and `result` are lookup activity, and worth showing rather than hiding behind a
spinner: naming the table being read is a more honest wait than three bouncing dots.
`error` means no answer was produced — show the message, never substitute one.

### 4. Answers are paragraphs now
They are no longer capped at two to four sentences. Split on blank lines, not every
newline. On a phone especially, a five-sentence explanation in one block is unreadable.

---

## Related

- [`../adr/0007-mobile-stack-expo.md`](../adr/0007-mobile-stack-expo.md) — Architecture decision for React Native + Expo
- [`../../contracts/README.md`](../../contracts/README.md) — The frozen API contract
- [`../api-standards.md`](../api-standards.md) — API standards and conventions
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — Branch naming, commit scopes, and PR rules
- [`qa.md`](qa.md) — How the app is acceptance-tested, and the device runbooks in `qa/`
