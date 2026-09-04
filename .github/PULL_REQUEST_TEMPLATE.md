<!-- Title must use Conventional Commit format, e.g. feat(analytics): add weather normalisation -->

## What this changes

<!-- One paragraph, plain language. What did you do? -->

## Why

<!-- The reason. If it implements a card, say which decision it follows from. -->

Refs: KEA-

Closes #

## How it was verified

<!-- Delete what does not apply. Be specific — "ran the tests" is not evidence. -->

- [ ] `make check` passes locally (N tests)
- [ ] Ran on a second machine
- [ ] `make api-spec` regenerated `contracts/openapi.json` (endpoints changed)
- [ ] Regenerated frontend/mobile types (the contract changed)
- [ ] Mobile: Verified on iOS (Simulator / iPhone) and Android (Emulator / device)
- [ ] Mobile: Attached UI screenshot or screen recording
- [ ] Mobile: Safe area insets (Dynamic Island, notch, home indicator) checked
- [ ] Mobile: Push notification permission / payload handling checked
- [ ] Manually checked against the demo script line: ___

## Definition of Done

- [ ] Tests added for new analytics/feature functions
- [ ] Any new external figure carries a source link
- [ ] Illustrative tariff disclaimer ($) and escalate_to_human surfaced on web/mobile screens
- [ ] Docs / ADR updated if a decision changed
- [ ] No non-Kea-Energy files included in this PR
- [ ] No secrets, `.env`, credentials, or personal data added

## Notes for the reviewer

<!-- Where to look first. Anything you are unsure about. Anything deliberately left out. -->
