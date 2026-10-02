# Mobile app repair verification

Issues: KEA-274 through KEA-285. Base: `cd4f48b` (`main`).

## Behaviour

- Saved sessions require a bearer token. Restoration checks `/api/auth/session`; a rejected current bearer clears the session and returns to login. An old request cannot clear a newly signed-in account. Network failures retain the authenticated offline session.
- Usage starts on the latest available dated period when the initial selection is empty. Costs remain explicitly illustrative and missing time bands remain unavailable.
- Home/Grid show dated meter imports when live power is unavailable. Solar, EV and battery need measured device data; missing sensors link to Settings. A zero measurement remains a zero.
- Home and EV contours follow the artwork. Art and hotspots share a bounded perspective/zoom transform. This is interaction with the existing artwork, not a new freely rotating 3D model.
- Sparky AI uses the original Bloub engine/body/eyes, copied unchanged with its MIT notice. The adapter adds a separate capsule mouth and theme inversion. Bill prediction shares that identity.
- Question cards use the v2 prompts/icons and become a horizontal rail above the composer on focus or keyboard visibility. Aurora is a native SVG adaptation of the [React Bits reference](https://reactbits.dev/backgrounds/aurora), animated with GSAP; it pauses while hidden and respects reduced motion.
- The duplicate header Home action is removed. Power Clash is accessible from Home and retains its synthetic demo labels and inactive reward disclosure.
- `npm run typecheck` regenerates typed routes with the locked Expo SDK before TypeScript, including `/solar`, so stale `.expo` declarations cannot break the check.

## Automated and local evidence — 3 October 2026

| Check | Result |
| --- | --- |
| Root `make check` | Passed: Ruff, 889 API tests, 5 skipped, web ESLint/TypeScript, attribution |
| Mobile `npm run typecheck` and `npm run lint` | Passed with fresh Expo route declarations |
| Mobile test suite | 46 tests passed, 0 failures, 0 skipped; 13 test files |
| Expo exports | Web, iOS, Android passed; `/solar` included |
| Original Bloub source | All 11 vendored TypeScript files byte-for-byte equal to the source; MIT license preserved |
| Live demo API | Seven in-memory households returned authorized Home/Usage data; expired bearer 401 and cross-household 403 verified |
| Browser | Fixture login, dated Home imports, unavailable sensor actions, Usage fallback, reload with valid session, API-restart rejection, re-login, EV selection, zoom/reset, prediction identity, question focus rail and Power Clash navigation verified |

The live API ran with `KEA_PERSIST=0`: nine database-backed accounts need the seeded database and were unavailable in this test environment. Neither the application nor these checks invent measurements for them. No live household credentials or tokens are included in this evidence.

## Teammate acceptance

Use the normal [startup sequence](../STARTUP.md), a seeded demo API, and the [Android phone guide](android-phone.md). Set the mobile API URL to a host reachable from the phone; local browser testing also needs its origin in `KEA_CORS_ORIGINS`.

1. Sign in to July Household. Open Usage in Day/Week/Month; check dates, units, totals, missing-band disclosure and comparison coverage. Test a database household with persistence enabled.
2. Relaunch with a valid session. Restart the demo API, then reopen the app: it must return to sign-in. Sign in again and check Usage. Disconnect the network separately: it must show a recoverable network error without treating that as a rejected credential.
3. Select every Home card and artwork hotspot. Drag sideways, zoom to both limits, reset, and scroll vertically. Connect mapped device sensors; confirm zero and positive readings use the right unit/date.
4. Check Home and EV contours in both themes. Verify white Bloub in dark mode and black in light mode, plus mouth changes for thinking/responding. Open bill prediction and Power Clash.
5. Focus the Sparky input with the native keyboard open. Scroll and tap the suggested-question rail; check the composer, bottom navigation, safe areas and keyboard dismissal on iOS and Android. Repeat with reduced motion.

Native iOS/Android keyboard, safe-area and performance evidence, a second teammate's machine, and an independent approving review are still required before merge. Expo exports and browser checks do not satisfy those gates. This change does not enable production authentication, real competition standings or bill credits.
