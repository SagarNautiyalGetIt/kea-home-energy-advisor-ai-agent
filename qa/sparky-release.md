# Replacement Sparky release acceptance

This supersedes the current-behaviour portions of `mobile-app-repair.md`; that file
retains historical PR #286 evidence. Issues #291–#300 extend the original fixes.

## Local verification, 3 October 2026

- Root `make check`: API/web lint and types, API suite, attribution check.
- Mobile: strict route/type generation, lint and 55 tests passed.
- Terraform: official AWS/archive providers; `fmt` and offline `validate` passed.
- Model: Downloads, Vault and bundled GLB have the same SHA-256; original Bloub
  vendor sources remain unchanged. Exports and browser results are recorded in the PR.

Fixture tests cover exact-transcript TTS, cancellation, WAV validation and mu-law
conversion; notification acceptance versus delivery, opt-outs and failures; outage
source/freshness/revisions; planned versus verified XP and deduplication; JWT signature,
audience/expiry/scope; production HTTP scope; receipt signatures; real Connect flow
branches and worker failures. No fixture test proves a paid-provider or device result.

## App acceptance on iOS, Android and a second teammate's machine

1. Run the startup sequence and original Usage/session checks. Missing measurements
   remain unavailable; dated imports do not become appliance consumption.
2. Open Home in both themes. Confirm textured unlit defaults, genuine orbit, zoom and
   reset. Switch holographic mode and restart; confirm preference persistence. Measure
   model load/memory/frame time on a low-end phone and exercise the fallback.
3. Observe the expanded rail on entry and its later compaction. Touching it, reduced
   motion or screen-reader use prevents automatic compaction. Arrows, edge fades,
   partial next card, position dots and Details/Compact remain usable.
4. Ask Sparky a question. Its body stays visible, gaze stays centred, mouth articulation
   is independent of blinking, and idle gestures pause when hidden. Check short bold
   answers and semantic icon colours. Exercise sliders, switches and response haptics,
   then disable haptics and repeat. Check keyboard rail and native safe areas.
5. Open scheduled outages from Home and More. Test missing source, current source,
   stale data, cancellation, distributor link and source verification time. Import a
   signed fixture snapshot for a linked household; never infer an outage-free supply
   from an empty or expired schedule. Check medical preparation guidance.
6. Open Power Clash. Plan once per mission/day and retry; XP must not double. Planning
   stays labelled separately from trusted measured-action receipts. Check household
   isolation, safe comfort constraints, noncash XP and tariff-estimate disclosures.
7. With configured Gemini access, test microphone permission/denial, Send, 45-second
   cap, playback, Stop, double-tap, leaving/backgrounding during every phase, loss of
   service and token refresh. Talk uses recorded turns; full-duplex VoIP is not implemented.

## Team AWS verification before enabling customer sends

Use `infra/aws-runtime/README.md`. Build the Docker image, apply migrations in a
controlled database, review Terraform plan/costs, configure IAM/SSM and OIDC callbacks,
and run readiness with the chosen team profile/region. Keep alerts disabled initially.

Use only team-owned opted-in destinations. Test confidence/threshold boundaries,
master and channel opt-outs, quiet hours, hardship suppression and unavailable preference
storage. Confirm SES delivery/bounce/complaint, SNS delivery/opt-out, and Connect 1/9,
no input, invalid input, unavailable prompt, queue full and failed opt-out persistence.
Provider acceptance is queued, not delivered. Investigate unknown SES/SNS outcomes;
never blindly retry. Verify receipt replay and failure-queue alarms. Audition Gemini
3.8 Flash TTS and its emotional styles using approved paid probes.

AWS deployment/sends, Docker build, live PostgreSQL migrations, production OIDC and
native performance were not verified on the development machine. Independent review
and written iOS/Android/second-machine confirmation remain merge gates; deferred
testing is not a waiver. A single EC2 instance is not proven customer-production capacity.
