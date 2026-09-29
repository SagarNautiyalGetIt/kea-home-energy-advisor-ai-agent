# Power Clash mobile checkpoints

**Scope:** an interactive, clearly labelled synthetic preview in the existing Expo mobile app. Players compare a weighted monthly score **within their suburb**. The top three eligible users would receive electricity-bill credits only after funding, retailer settlement, and legal approval. [Issue #231](https://github.com/CS778-S2-2026-AWS-Challenge/HAKAS-kea-energy/issues/231), [integration draft PR #232](https://github.com/CS778-S2-2026-AWS-Challenge/HAKAS-kea-energy/pull/232), and the [production blueprint](https://github.com/CS778-S2-2026-AWS-Challenge/HAKAS-kea-energy/pull/228) track the work and gates.

**Rendered preview:** the integrated Expo web export was inspected at 390px phone width after demo sign-in. Home and Power Clash displayed with no horizontal overflow; switching to Ponsonby and selecting off-peak savings changed rank, score, and explanation together. Native iOS and Android appearance still needs device verification.

## Checkpoint 1 — stack and consent

- [x] Confirm Expo Router, SDK 57, React Native 0.86, Reanimated, Haptics, and the app's monochrome dark theme.
- [x] Confirm no verified suburb assignment or production customer identity boundary is available. All sample scores and rankings are visibly marked demo.
- [x] Add SDK-compatible `expo-location` with foreground-only approximate-location text, Android fine/background permission blocks, and no coordinate persistence or API transmission.
- [x] Explain location use before the OS dialog. Keep manual suburb selection usable after denial. Defer notifications until a real event source exists.

## Checkpoint 2 — monthly within-suburb preview

- [x] Add a reachable Power Clash route from Home and More in the existing navigation.
- [x] Replace district-versus-district maps and flash quests with a dark page: suburb selector, your sample rank, interactive 3D-style energy arena, four weighted category rows, monthly individual leaderboard, top-three bill-credit concept, and Sparky.
- [x] Show conservation against one's own baseline, illustrative EV and solar avoided emissions, and off-peak money saved. The **demo-only** weights are 35/20/25/20 and all four point contributions are capped.
- [x] Make category explanations and suburb changes interactive with selection haptics and visible feedback. Keep the category detail static and readable when motion is reduced.
- [x] Add an isometric four-pillar score board using existing SVG, Gesture Handler and Reanimated. Tap selects a category, horizontal drag tilts through bounded UI-thread transforms, and the score list remains an accessible alternative.
- [x] Add direct next moves to Usage and Sparky. Frame the game around informed, proactive efficiency rather than using the least energy at any cost.
- [x] State that production scoring must review eligibility and fairness for households without EVs or solar, alongside meter, charger, generation, tariff, and carbon evidence.
- [x] Keep score, rank, and reward copy truthful: no real customer ranking, approved carbon offset, money, or bill credit is computed or awarded.

## Checkpoint 3 — verify and integrate with Stable v2

- [x] Add focused tests for suburb suggestion, permission fallbacks, bounded weights, and ranked sample profiles.
- [x] Run typecheck, focused lint, all mobile tests, and iOS/Android/web exports with output outside the Vault (29 Sep 2026).
- [x] Inspect the redesigned web preview at 390px and 320px with no horizontal overflow; exercise suburb and category selection. Earlier preview exercised the permission fallback and nearby-demo suggestion; native permission behaviour remains a device gate.
- [x] Integrate with preserved `mobile-V2` at `80059d9`, Kea Home/Sparky polish, and the Power Clash preview. Combined mobile typecheck, eight test files, focused lint, and iOS/Android/web export passed. Web lint/build and generated OpenAPI/type comparison passed (29 Sep 2026).
- [x] Inspect the integrated Home and Power Clash in the browser at phone width. The demo Home correctly withheld unmeasured solar, EV, battery, and home power readings.
- [x] Akash confirmed the integrated build opens in Expo Go and Power Clash works on his phone (29 Sep 2026). Device platform and detailed native appearance, permission, haptic, and frame-pacing checks remain open.
- [x] Confirm `git diff --check`, changed-file scope, and authorship. No secrets, customer data, or unrelated files were found in the changed-file review.
- [ ] Resolve the full API TestClient stream test timeout on this Python 3.14 environment; the same test also times out on the unchanged main-based branch. Focused model-readiness and security-header checks passed, and a live unknown-household chat request returned 404.
- [x] Open draft PR #232 linked to issue #231 and attach it to the task. Device and production gates remain visible to reviewers.

## Release checkpoint — open

- [ ] Production auth, household authorization, verified suburb assignment, consent, withdrawal, privacy impact review, and leaderboard disclosure rules.
- [ ] Measured meter baseline and verified EV charger, solar generation/export, and tariff evidence; equitable eligibility for homes without EV or solar.
- [ ] Reviewed marginal-emissions and counterfactual methods, including no double counting between EV, solar, and conservation.
- [ ] Published score weights, versioning, appeals, fraud controls, month-end settlement, funded and legally approved bill credits.
- [ ] Native iOS/Android visual, haptics, and frame-pacing evidence plus teammate approval. Expo Go launch alone does not establish 60 fps.
