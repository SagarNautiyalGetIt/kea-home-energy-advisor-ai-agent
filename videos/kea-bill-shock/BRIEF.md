---
workflow: product-launch-video
flow: automation
storyboard: no
message: "The spike everyone stares at isn't the money — and every number was computed, not written"
destination: deck-embed
aspect: 1920x1080
language: en
audience: "MIT internship pitch judges, CS778 AWS Challenge; sector-literate, sceptical of AI claims"
length: 15s
angle: proof
style_preset: blue-professional
---

## Intent

A 15-second product film for the Kea Energy bill-shock agent (Scenario 9, Team HAKAS),
to sit in the pitch deck and to act as the fallback if the live demo dies in the room.

The register is consulting-grade, not startup-hype. The audience is judges who have
watched a dozen teams claim an AI does something; the differentiator is that this one
can *prove* it didn't make the numbers up. So the film ends on evidence, not on a
feature list.

Silent by design — a presenter talks over it. Burned text carries the whole story.

## Assets

- No captured assets. The product is a local-only app (Postgres + Ollama on the demo
  laptop); there is no public URL to crawl. The UI is reconstructed in HTML from the
  real components, tokens, and pinned figures.

## Customizations

- **Every figure on screen must be one the analytics engine actually produces.** The
  spike is `$2.64`; the sustained overshoot is `$290 a year`. Both are pinned by
  `services/api/tests/test_analytics_july.py`. A film about not fabricating numbers
  cannot contain a fabricated number.
- **`Illustrative 30c/kWh` must appear** on any frame showing a dollar figure. Kea's
  real tariff is not public and every surface in the pitch carries this.
- Count-up on the `$290` as it lands.
- The answer beat is the longest in the film — the streaming answer is the product.
- Final frame endline: "The model writes the sentence. It never does the maths."

## Notes

- **This is a designed recreation of the UI, not a screen capture.** It is honest as a
  product film, but it must not be described to judges as a recording of the running
  app. The real screen recording is a separate deliverable — see
  `docs/sprints/sprint-2/demo-video-15s.md`.
- Do **not** say "runs entirely on this laptop" anywhere. Post-Amazon-Connect that is
  only true of some channels; the wording is unresolved in `docs/roadmap.md`.
- Do not name an appliance, ever. Half-hourly meter data cannot identify appliances and
  the refusal is a deliberate product position.
- No fabricated Kea branding on a bill; no third-party retailer logo.
- Silent: no narration, no BGM, no SFX.
