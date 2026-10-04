# Immersive mobile release — 3 October 2026

This release carries forward PR302 and addresses follow-up issues #326–#340. The source GLB and original Bloub artwork remain unchanged. Equipment/window masks are illustrative annotations on one fused mesh, not individually addressable model objects.

Phone follow-up: the requester confirmed orbit isolation and Explore Kea swipe both work in Expo Go. Requested energy-flow polish uses 44% thicker tubes and twice as many brighter, soft pulses, with output colour conversion and the original travel speed/direction. Other physical checks remain pending.

| Issue | Behavior / decision |
| --- | --- |
| #326 | Home opens on the conduit close-up in cyan holographic style, moves to its resting view over 3.8 seconds after a 0.45-second pause, then blends to original unlit textures over 2.2 seconds. One material/program is retained. Legacy experience settings receive the realistic default while retaining haptic preferences; a new explicit “Keep Home holographic” choice remains available. Reduced Motion skips the camera/material reveal. |
| #327 | The scene claims touches at their start and locks only its parent page scroll for the gesture. Release, cancellation, backgrounding and unmount restore page scrolling. Energy rail and content outside the scene remain scrollable. |
| #328–#330 | Solar plane bounds include its right edge; Home bounds include the front-left section but exclude ground and equipment; car bounds include source moonroof vertices above the former cutoff. Shader masks preserve original textures. |
| #331 | Fresh regional day/night controls warm window illumination. When weather is stale or missing, the Auckland clock supplies a labelled-by-source internal time fallback; no weather conditions are guessed. Lighting is illustrative, not a home control. |
| #332 | Stars on clear nights, cloud motion, rain/snow, morning birds and warm summer butterflies occupy world space with the model. Precipitation sets have 44 points, stars 72 and wildlife three objects. Energy/weather share one 30fps demand-render clock, paused when hidden/backgrounded; Reduced Motion retains static weather. `forceSinglePass` avoids a duplicate transparent DoubleSide draw of the large house. |
| #333 | Explore Kea owns the initial dock touch before the enclosing native ScrollView can take it. Upward release opens; tap/accessible activation remain. Sideways/downward/cancelled gestures do not open. Existing frosted modal and iOS dismissal sequencing are retained. |
| #334–#335 | Signed-in fixture charts now reuse the existing seeder's explicitly synthetic half-hour profile, reconciling to the published daily totals. Demo sources and tariff windows are labelled; real missing intervals/bands remain null. Day defaults to a chart, without the long hourly list. Week/month preserve missing date slots; isolated readings remain visible without bridging gaps. See [interval/band requirements](mobile-usage-time-bands.md). |
| #336–#337 | Tap Sparky for short original-expression reactions, then return to centred idle. Response mouth state stays independent, haptics respect preferences, and timers stop offscreen. Plans uses the same live mascot and keeps its contextual route. |
| #338 | Quests/Arena/League group the existing features. One chosen mission and contextual Sparky help form the main game loop; secondary history is disclosed. Native entrance/selection motion respects OS Reduced Motion and a game switch. Planning acknowledgements are neutral because aggregate XP responses cannot prove a newly awarded mutation. Optional 3D asset prompts and primary-source research: [Power Clash engagement](power-clash-engagement.md). |
| #339 | All follow-ups have assigned/labelled HAKAS cards and a mirrored Vault board. Create the replacement PR before closing this release's superseded PR302; keep unrelated PRs and history. No merge/deployment is part of this change. |
| #340 | Energy conduits use radius .0065 instead of .0045, six soft pulses instead of three, stronger core/base opacity and renderer output colour conversion. Doubling phase preserves original travel speed; inactive and zero-power paths remain off. |

## Acceptance boundaries

Strict types, lint, automated tests and web/native exports verify source and bundling. They do not verify real device gestures, shaders, haptics or frame time. The 1,872,276-triangle model requires physical iOS/Android testing. Second-machine evidence and an independent approving review remain required before merge. Browser automation previously rejected the local preview through a security policy, so no alternate-browser workaround is used and no new visual pass is claimed.

July fixture data covers one month; the last week has five of seven days. The month graph preserves unavailable months as gaps. Production hourly/band metrics require authorized meter intervals and the household's actual tariff mapping. Demo shape is illustrative even where daily totals are chart-derived.

AWS deployment/provider acceptance remains deferred from PR302. Recorded voice turns are implemented there; full-duplex VoIP remains unimplemented. This PR does not turn those limitations into a deployment claim.
