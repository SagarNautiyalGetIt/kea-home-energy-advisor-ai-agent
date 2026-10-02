# Mobile app repair verification

> Historical PR #286 evidence. The supplied GLB, outage page, production identity,
> voice and notification integrations are covered by [replacement acceptance](sparky-release.md).
> The authored mesh and inactive reward descriptions below describe the earlier build.

Issues: KEA-274 through KEA-285, KEA-288 and KEA-289. Base: `cd4f48b` (`main`).

## Behaviour

- Saved sessions require a bearer token. Restoration checks `/api/auth/session`; a rejected current bearer clears the session and returns to login. An old request cannot clear a newly signed-in account. Network failures retain the authenticated offline session.
- Usage starts on the latest available dated period when the initial selection is empty. Costs remain explicitly illustrative and missing time bands remain unavailable.
- Home/Grid show dated meter imports when live power is unavailable. Solar, EV and battery need measured device data; missing sensors link to Settings. A zero measurement remains a zero.
- Home uses an authored 3D mesh following the existing cedar house, roof solar, battery, grid cabinet and EV layout. Horizontal drag changes the camera yaw/pitch; rotate buttons, bounded zoom and reset remain available with reduced motion. Perspective, world-space lighting, back-face culling and a static BSP partition reveal and occlude different surfaces as the view turns. Equipment selection uses the visible mesh; sensor-only power flows follow 3D conduits and respect the same occlusion. The house PNG is no longer rendered in Home. This is a stylized geometric reconstruction, not a photorealistic scan of the original image.
- Sparky AI uses the original Bloub engine/body/eyes, copied unchanged with its MIT notice. The adapter adds a separate capsule mouth and theme inversion. Mouth placement follows the face centres/tilt, independent of eyelid compression or opacity. Resting expressions stay closed; responding has gentle articulation, with a static reduced-motion pose. Bill prediction shares that identity.
- Question cards use the v2 prompts/icons and become a horizontal rail above the composer on focus or keyboard visibility. Aurora is a native SVG adaptation of the [React Bits reference](https://reactbits.dev/backgrounds/aurora), animated with GSAP; it pauses while hidden and respects reduced motion. Assistant-page Bloub has a faint reflection using the same palette, ribbon geometry and clock. The overlay is capped at 8.5% opacity in dark mode and 7.5% in light mode and uses the existing body-minus-face mask. Navigation and bill prediction remain monochrome. No vendored geometry changes or dependencies were added.
- The duplicate header Home action is removed. Power Clash is accessible from Home and retains its synthetic demo labels and inactive reward disclosure.
- `npm run typecheck` regenerates typed routes with the locked Expo SDK before TypeScript, including `/solar`, so stale `.expo` declarations cannot break the check.

## Automated and local evidence — 3 October 2026

| Check | Result |
| --- | --- |
| Root `make check` | Passed: Ruff, 889 API tests, 5 skipped, web ESLint/TypeScript, attribution |
| Mobile `npm run typecheck` and `npm run lint` | Passed with fresh Expo route declarations |
| Mobile test suite | 54 tests passed, 0 failures, 0 skipped; 14 test files; mouth blink independence, volumetric orbit, occlusion and initial framing regressions included |
| Expo exports | Web, iOS, Android passed; `/solar` included |
| Original Bloub source | All 11 vendored TypeScript files byte-for-byte equal to the source; MIT license preserved |
| Live demo API | Seven in-memory households returned authorized Home/Usage data; expired bearer 401 and cross-household 403 verified |
| Browser | Fixture login, dated Home imports, unavailable sensor actions, Usage fallback, reload with valid session, API-restart rejection, re-login, EV selection, zoom/reset, prediction identity, question focus rail and Power Clash navigation verified |
| Mouth blink in browser | 79 rendered samples: eye vertical projection compressed from 0.89 to 0.17; mouth kept one path, full opacity and translation/rotation only |
| Aurora reflection in browser | At 390px: 220px hero, 112px compact hero and 34px chat avatars checked in both themes. Background/reflection ribbon paths match within the same rendered frame; tint group opacity is 0.085 dark / 0.075 light and preserves all four facial-mask paths. Eyes/mouth stay clear with no overflow; navigation remains untinted. Chat-avatar checks used a deliberate disconnected local API, without a model call. Long-chat and native frame times remain unmeasured. |
| 3D Home in browser | At 390 px: sideways pointer drag, front/rear orbit with rotate limits, maximum zoom, reset, vertical scroll, a visible battery-face press, card/action synchronization and both themes verified. Front/rear screenshots show different walls and car occlusion; surface counts changed from 927 to 959. Screen-reader tree exposes one scene image instead of hundreds of decorative faces. |

The 3D scene uses the installed React Native SVG renderer on web/iOS/Android. Its geometry is static; BSP splitting is done once, and projection runs only when the camera changes. Static surface components are memoized; active measured flows update conduit colors at a capped 20 Hz and pause when hidden/reduced-motion. Zoom intentionally enlarges/crops the view; zoom-out/reset restore the fully framed scene. No GPU dependency or external model asset was added.

The live API ran with `KEA_PERSIST=0`: nine database-backed accounts need the seeded database and were unavailable in this test environment. Neither the application nor these checks invent measurements for them. No live household credentials or tokens are included in this evidence.

## Teammate acceptance

Use the normal [startup sequence](../STARTUP.md), a seeded demo API, and the [Android phone guide](android-phone.md). Set the mobile API URL to a host reachable from the phone; local browser testing also needs its origin in `KEA_CORS_ORIGINS`.

1. Sign in to July Household. Open Usage in Day/Week/Month; check dates, units, totals, missing-band disclosure and comparison coverage. Test a database household with persistence enabled.
2. Relaunch with a valid session. Restart the demo API, then reopen the app: it must return to sign-in. Sign in again and check Usage. Disconnect the network separately: it must show a recoverable network error without treating that as a rejected credential.
3. Select every Home card and visible mesh hotspot. Drag sideways and confirm other walls/roof faces appear; orbit to the opposite side with the rotate buttons, zoom to both limits, reset, and scroll vertically. Repeat with reduced motion and in both themes. Connect mapped device sensors; confirm zero and positive readings use the right unit/date. Check live-flow animation frame times and touch response on iOS/Android; native rendering and gesture arbitration remain deferred, not verified by browser checks.
4. Check Home and EV contours in both themes. Verify white Bloub in dark mode and black in light mode, plus mouth changes for thinking/responding. Open bill prediction and Power Clash.
5. Focus the Sparky input with the native keyboard open. Scroll and tap the suggested-question rail; check the composer, bottom navigation, safe areas and keyboard dismissal on iOS and Android. Repeat with reduced motion. Inspect the faint Aurora reflection in the 220px hero, 112px compact hero and 34px chat avatars, in both themes. Eyes/mouth must stay clear; compare the reflection with the background motion. Inspect a long chat for frame drops; native mask appearance and performance remain unverified until this acceptance is run.

Native iOS/Android keyboard, safe-area and performance evidence, a second teammate's machine, and an independent approving review are still required before merge. Expo exports and browser checks do not satisfy those gates. This change does not enable production authentication, real competition standings or bill credits.
