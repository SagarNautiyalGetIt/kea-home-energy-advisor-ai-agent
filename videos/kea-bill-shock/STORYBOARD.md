---
title: "Kea — the bill nobody explains"
message: "The spike everyone stares at isn't the money — and every number was computed, not written"
audience: "MIT internship pitch judges; sector-literate, sceptical of AI claims"
duration: 15
aspect: 1920x1080
fps: 30
music: none
mode: autonomous
---

# Storyboard

Six frames, 15 seconds. Silent — a presenter speaks over it. Burned text carries the story.

The spine is **problem → question → insight → proof → claim**. The insight beat (frame 03)
is the longest because the streaming answer is the product; the proof beat (frame 04) is the
one the whole pitch rests on.

---

## Frame 01 — The bill · 0.0–2.0s

- **Role:** hook
- **Blueprint:** cover / identity, held still
- **asset_candidates:** none — typographic, reconstructed statement figure
- **Content:** A statement total sits alone on the cream canvas — `$412.80` — with the eyebrow
  `JULY STATEMENT` above it and, beneath, the muted line `You paid it. Nobody told you why.`
- **Layout:** left-aligned, generous margin, the figure at `h1` scale near-black.
- **Motion:** the figure arrives with a 0.5s rise + fade; a cobalt accent line draws under the
  eyebrow. Then **everything holds still for a full beat** — the discomfort is the hook.
- **Note:** no retailer branding, no invented Kea bill chrome. It is a number on paper.

## Frame 02 — The question · 2.0–5.0s

- **Role:** turn
- **Blueprint:** split + highlight
- **asset_candidates:** none — reconstructed assistant input surface
- **Content:** The Kea assistant input. The question types itself in:
  `Why was my July bill so high?` Sparky's orbit ring spins up as it completes.
- **Layout:** the input as a tinted card (4% cobalt fill, 20% border, 12px radius), centred
  low-third; the ring to its left.
- **Motion:** character-stepped type-on (seek-safe, driven off a stepped tween — not a JS
  interval); ring scales up and begins a finite rotation as the last character lands.

## Frame 03 — The answer · 5.0–10.0s

- **Role:** insight — **the longest beat, deliberately**
- **Blueprint:** split + highlight → dashboard
- **asset_candidates:** none — reconstructed answer surface + July usage chart
- **Content:** The answer streams in, two clauses:
  - `The one-day spike cost $2.64.`
  - `The steady overshoot no one shows you costs $290 a year.`
  Beneath, a 31-bar July chart draws in: the sustained band highlighted in cobalt, the
  11 July spike deliberately *de*-emphasised in grey.
- **Layout:** answer text left, chart full-width beneath, `Illustrative 30c/kWh` as a small
  muted footnote pinned bottom-left.
- **Motion:** word-by-word reveal on the answer; each figure gets a 200ms cobalt underline
  sweep as it lands; `$290` counts up. Bars grow from the baseline, staggered left-to-right.
- **Hard rule:** both figures are the analytics engine's own output, pinned by
  `test_analytics_july.py`. The footnote is mandatory.

## Frame 04 — The proof · 10.0–13.0s

- **Role:** evidence — the beat the pitch rests on
- **Blueprint:** dashboard, single metric
- **asset_candidates:** none — reconstructed verification log headline
- **Content:** Eyebrow `VERIFICATION LOG`. Headline `12 answers · 0 fabricated figures`.
  Sub: `Every figure traced to this household's own meter data.`
- **Layout:** centred, a shield mark left of the headline, the count at `metric-value` scale.
- **Motion:** hard cut in — no transition. The card snaps to full opacity with a 4px settle;
  a cobalt hairline draws across beneath the headline over the last 1.2s.

## Frame 05 — Black · 13.0–13.4s

- **Role:** breath
- **Content:** true black. Nothing.
- **Motion:** none. **Do not shorten this.** The pause is what makes the endline land.

## Frame 06 — Endline · 13.4–15.0s

- **Role:** closer
- **Blueprint:** closing
- **asset_candidates:** none — wordmark set in the brand face
- **Content:** `Kea`, then the two-line endline:
  `The model writes the sentence.` / `It never does the maths.`
- **Layout:** centred, wordmark above, endline at `h3` scale near-black.
- **Motion:** wordmark fades up over 0.4s; the endline's second line arrives 0.3s after the
  first, so the turn lands separately. Final 0.4s is a still hold.

---

## Video direction

- **Palette:** cream canvas `#FFFFFF`, near-black ink `#1A1D2B`, one cobalt-violet accent
  `#341FCD` carried from the app's own `--shadow-button`. The accent is scarce: eyebrows,
  numerals, the chart's sustained band, one hairline. Nothing else is coloured.
- **Type:** Space Grotesk for display, every numeral, and all chrome; Inter 400 muted for
  body. Headlines near-black at −0.02em. No italic, no uppercase body, no cobalt headline.
- **Motion doctrine:** one easing curve for the whole film — `power3.out`. Every entrance is
  opacity + an ≤48px translate. **Nothing scales, nothing bounces, nothing rotates** except
  Sparky's ring, which is the one diegetic motion in the film.
- **Cuts:** hard cuts between frames. No dissolves, no wipes, no push transitions.
- **Depth:** flat. Tinted cards only (4% fill, 20% border, no shadow) — the preset's rule.
- **Silence:** no narration, no BGM, no SFX. `music: none` and no `SCRIPT.md`.
- **Claims discipline:** every numeral on screen traces to `app/analytics/engine.py`. Any
  dollar figure carries the illustrative-tariff footnote. No appliance is ever named.
