# ADR-0007 — React Native with Expo for the mobile app

**Date:** 2026-09-04 · **Status:** Accepted · **Owner:** Team HAKAS

## Context

The Kea Energy Home Energy Advisor is expanding beyond the web dashboard (`services/web/`)
to include a mobile application. The mobile app must:
1. Deliver the same bill-shock prevention experience, conversational interface, and usage
   insights on both iOS and Android.
2. Deliver **Tier-1 push notifications** for spike detection and bill-shock warnings
   alongside email alerts.
3. Be demoed live on an **iPhone** during the final presentation.
4. Integrate with the frozen backend API (`contracts/openapi.json`) without schema drift.
5. Enable rapid multi-developer collaboration without imposing massive local toolchain
   configuration burdens across the team.

## Options considered

- **Native (Swift/SwiftUI + Kotlin/Jetpack Compose):** Maximum native fidelity and performance,
  but requires two distinct codebases, two separate OpenAPI generators, and double the
  developer bandwidth during a fast-moving sprint.
- **Flutter (Dart):** Single codebase, strong cross-platform UI consistency, but introduces
  a completely separate language ecosystem (Dart), cannot reuse existing TypeScript types or
  client utilities, and requires a separate Dart OpenAPI generation pipeline.
- **React Native + Expo (TypeScript):** Single codebase, direct stack synergy with the
  React 19 / TypeScript web app (`services/web/`), shared type generation via
  `openapi-typescript`, built-in cross-platform push notification infrastructure, and
  instant device deployment via Expo Go / EAS for the live iPhone demo.

## Decision

**React Native with Expo (TypeScript)** in `services/mobile/`, on four grounds in order of weight:

1. **Direct contract and type synergy.** The mobile team runs `openapi-typescript` against
   `../../contracts/openapi.json` to generate `src/api.d.ts`, exactly like the web team.
   Types remain identical across both frontends, and any backend change is immediately caught
   at compile time.
2. **Tier-1 Push Notification ecosystem.** Expo provides a managed push notification service
   (Expo Push API / APNs / FCM) with simple token registration. Bill-shock spikes identified
   by Layer 1 analytics (`app/analytics/`) can dispatch immediate native notifications without
   requiring low-level APNs/FCM bridging code during the sprint.
3. **Frictionless team testing & iPhone demo.** Teammates on backend, AI, or data teams can
   test and verify mobile pull requests directly on physical iOS and Android devices by
   scanning an Expo QR code, bypassing the need for full local Xcode/Android Studio setups.
4. **Shared mental model with web.** Both frontends share React paradigms, component
   structure conventions, and color/design tokens derived from Kea Energy's visual language.

## Push Notification Architecture (Tier 1)

Bill-shock prevention requires proactive alerting. The push notification flow operates as
follows:

1. **Token Registration:** On app launch and user consent, the mobile app retrieves the
   device push token via `expo-notifications` and registers it with the backend (`POST /api/notifications/register`).
2. **Spike Trigger:** When Layer 1 analytics identifies an anomalous consumption spike or
   projected bill-shock condition, the backend dispatches a push notification payload
   (alert tier: critical/advisory, projected overshoot amount, timestamp).
3. **Deep Linking:** Tapping the notification opens the mobile app directly into the
   relevant household usage breakdown or initiates a chat consultation with the advisor.

## Consequences

**Accepted:**
- **Local networking divergence:** Android emulators map the host machine to `10.0.2.2`, iOS
  simulators use `localhost`, and physical iPhones require the developer's LAN IP. The mobile
  app must parameterize the API URL cleanly through `.env`.
- **Custom SSE parsing in React Native:** React Native's networking runtime differs from
  browser `fetch` streams. SSE frame reading for `/api/chat/stream` must be handled via
  a dedicated stream reader that supports chunk-splitting and UTF-8 decoding.

**Rejected reasoning worth recording:**
Flutter has strong merits for raw rendering performance, but splitting the frontend into
two disjoint language stacks (TypeScript for web, Dart for mobile) would split review
capacity and double the maintenance overhead on API contracts. React Native preserves team
fungibility.

## Contract-first commitment

The mobile app strictly consumes `contracts/openapi.json`. No mobile feature may introduce
uncontracted endpoints or rely on undeclared response shapes. If an endpoint requires
modification, update `app/api/`, regenerate `contracts/openapi.json` (`make api-spec`), and
update both clients in the same PR.
