# Power Clash engagement plan

Date: 2026-10-03. Evidence: source research and repository inspection; product recommendations are hypotheses to test, not promises of savings.

## Research and its limits

| Primary source | Finding | Decision for Kea |
| --- | --- | --- |
| [Przybylski, Rigby and Ryan, 2010, motivational model of video games](https://selfdeterminationtheory.org/SDT/documents/2010_PrzybylskiRigbyRyan_ROGP.pdf) | Competence, autonomy and relatedness help explain enjoyable engagement. Meaningful choices and understandable controls matter; reward pressure can undermine intrinsic motivation. This is a theory and research synthesis, not a Kea energy trial. | Offer a choice of practical quests and explain their purpose. Celebrate progress without streak loss, shame, random rewards or a demand to return daily. |
| [Paunov, Grüne-Yanoff and Schwirplies, 2026, randomized electricity field experiment](https://www.nature.com/articles/s41598-026-69386-6) | A 24-week trial with 140 student households found both normative feedback and competence-building tips attenuated seasonal increases relative to controls. Effects were not necessarily absolute reductions, and the interventions did not differ significantly. Engagement with tips declined. | Sparky should explain one relevant action at a time. Test useful completed actions and metered outcomes; animation or app visits alone are not evidence of energy savings. Do not transfer the trial's effect sizes to Kea customers. |
| [Making the smart meter social, 2019](https://www.nature.com/articles/s41599-019-0254-5) | The field study supports combining comparisons with approval for already efficient households, helping avoid the boomerang effect of telling low users they are below average. | Personal improvement and encouragement precede the sample league. Comparisons require appropriate peer groups; raw low consumption must not define success. |
| [NZ Electricity Authority, demand-side flexibility, 2024](https://www.ea.govt.nz/news/eye-on-electricity/how-demand-side-flexibility-can-contribute-to-security-of-supply/) | Shifting the time or amount of demand can support supply and lower costs. Flexibility depends on resources and consumer constraints. | Quests focus on flexible loads, actual tariff windows, EV departure needs and comfort. A plan does not count as verified shifting. |
| [NZ Electricity Authority, flexibility in a renewable power system, 2025](https://www.ea.govt.nz/news/eye-on-electricity/demand-side-flexibility-in-a-highly-renewable-power-system/) | Flexible consumption can reduce system costs and better use generation; demand has daily and seasonal patterns. | Team benefit is a separately measured outcome. No blanket carbon or cost saving follows from pressing an off-peak button. |
| [W3C, animation from interactions](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions) | Users must be able to disable nonessential interaction motion under SC 2.3.3. Vestibular effects can cause harm. | Respect the OS reduced-motion setting, provide a game-motion switch, keep text and controls usable when animation is off. |
| [React Native animations](https://reactnative.dev/docs/animations) | Native animation supports transform and opacity without a JS update per frame; layout properties do not use the native driver. | Use the installed native animation stack, bounded transitions, cleanup on blur/background and no React-state animation loops. |

[React Bits Animated Content](https://www.reactbits.dev/animations/animated-content) and [Click Spark](https://www.reactbits.dev/animations/click-spark) are visual references for section entrances and brief action feedback. Their web implementations are not copied into the native app; existing React Native/Reanimated primitives supply the equivalent behavior.

## Release decisions

1. Replace the long stack with **Quests**, **Arena** and **League** views. Quests is the default and contains one selected mission, XP provenance, optional recent actions and contextual Sparky help. Arena contains the interactive isometric score board and accessible scoring controls. League contains sample ranks, suburb selection and the planned reward explanation.
2. Keep sample arena points/ranks separate from account planning XP and device-verified XP. The league remains prominently marked as a demo. Never animate a fake score increase after planning.
3. Show a single mission at a time with explicit previous/next controls and a position indicator. Saving a plan uses a neutral acknowledgement; the current API returns cumulative progress, not a receipt proving that this particular request earned new XP. No GET/POST total difference is celebrated. Existing server idempotency remains authoritative.
4. Use a small cosmetic isometric energy token, native entrance transitions and selection feedback. Reward bursts are deferred until an explicit mutation receipt can distinguish new and already-recorded actions. Motion pauses while unfocused/backgrounded and can be disabled. Avoid simultaneous competing effects across every paragraph.
5. Keep all original features available under their appropriate view or a disclosed details section. Do not silently enrol users in a league or send location.
6. Generated 3D assets are optional future polish. This release uses procedural vector geometry and adds no second expensive GL canvas beside the existing home model.

## Evaluation before making savings claims

Treat the game loop as a testable product hypothesis: useful choice → feasible plan → measured completion → clear feedback. Sparky explains tariff eligibility, departure/comfort constraints and uncertainty before an action; it never treats a planned task as a device command or a verified outcome. Let users skip unavailable EV/solar quests without losing standing; household capability and occupancy affect fair baselines.

Pre-register the principal outcome as verified flexible kWh shifted out of the household's actual peak window, with delivered customer cost estimated from the effective plan and measured intervals. Secondary outcomes: completed eligible actions, voluntary return after 7/28 days, successful Sparky follow-through, comfort/essential-use complaints, opt-out rate and native frame time. App opens, animation taps and planning XP are engagement signals, not savings evidence. Retailer benefit requires separately observed aggregate peak/coincident demand and settlement/system-cost analysis.

Compare the focused quest presentation with the previous card stack using randomized household assignment, fixed measurement windows and a predeclared analysis. Separate EV/solar capability, baseline consumption and missing-meter coverage; report attrition, uncertainty and adverse outcomes. Test the animation layer separately from the advice so novelty is not mistaken for the causal effect of energy guidance. A sample-size/power calculation needs baseline variance and a meaningful effect threshold from actual participants; do not invent a participant target or extrapolate the student trial's effect size.

Give a short reason for each achievable task, acknowledge measured progress without shame, and preserve user choice. No punitive streak reset, paid random rewards or rewards for unsafe heating/medical-load cuts. Test comprehension with users who cannot provide flexibility before introducing cash prizes or carbon claims.

## Optional asset generation prompts

**Quest island:** “Create a stylized mobile-game energy quest island as a single GLB. A small floating rounded hexagonal platform with one clean modern home, a solar tile, a compact EV charger and a tiny leafy tree. Warm ivory base, emerald green, solar amber and EV blue accents; friendly Kea Energy aesthetic. Isometric-readable silhouette with physically plausible depth. No text, logos, mascot, baked background, human figures or UI. Separate named meshes: platform, house, solar, ev_charger, tree. Flat unlit-friendly materials, max 6,000 triangles total, one texture atlas no larger than 512×512, embedded assets, Y up, metre units, origin centred at platform bottom. No animation required. Export ordinary glTF 2.0 GLB, no Draco or meshopt extensions.”

**Progress token:** “Create a small collectible energy token GLB: a rounded emerald hexagonal coin with an inset lightning mark, ivory bevel and restrained warm gold rim. Readable at 48 px, friendly tactile mobile-game prop. No writing, no brand logo, no reward amount, no background. Separate coin/rim/mark meshes, max 1,200 triangles, flat unlit-friendly materials, no texture needed, Y up, centred origin, ordinary glTF 2.0 GLB without compression extensions. This is a cosmetic progress token, not currency.”

These are artwork requirements proposed by Kea, not empirical research results. Before importing, validate triangle/material count, licences and file size, retain a static fallback, and test on a low-end physical phone. No generated art is needed to use this release.

## Measurement plan before production rewards

- Primary behavior: consented, verified flexible-load kWh moved to the household's actual tariff window, with complete intervals and an appropriate baseline.
- Customer outcome: tariff-weighted bill difference with uncertainty, comfort/EV readiness unchanged; distinguish forecast from retrospective evidence.
- Team outcome: independently measured coincident peak-demand reduction, not the sum of app clicks or household percentages.
- UX experiment: compare the focused quest layout with the existing page. Register the assignment, inclusion rules, missing-data handling and success criterion before running. Measure task completion, 7/28-day voluntary return and support burden; show confidence intervals and null results.
- Fairness: evaluate renters, people without EV/solar, shift workers and essential medical/heating needs. Provide alternative missions and never rank raw usage without normalization. Financial rewards remain disabled until rules, eligible data and approval exist.
- Accessibility/performance: screen reader and dynamic type, reduced motion and motion-off, touch gestures, blur/background cleanup and real-device frame time. Current export/type checks cannot substitute for phone evidence.
