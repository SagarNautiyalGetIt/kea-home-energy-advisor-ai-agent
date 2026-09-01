# 15-second hero cut — the produced version

**Companion to `demo-video-15s.md`.** That one is the safe deck clip: pure screen
recording, 45 minutes, zero risk. This one is the same 15 seconds with a live-action
opener, a voiceover and a grade — the version that looks like a product film rather than
a screencast.

**Shoot both if you can.** The deck clip is your fallback and it costs almost nothing;
this is the one you actually play. If time collapses, the deck clip ships and this
doesn't, and nobody in the room knows the difference.

**Self-shootable.** No crew, no talent, no hired grade — the notes below assume a phone,
a window, and an afternoon.

---

## The single idea

> The spike everyone stares at isn't the money. And every number you just heard was
> computed, not written.

Same idea as the deck clip. The production exists to make the *first two seconds*
land — the discomfort of a bill you don't understand — because that's the feeling the
whole product is answering, and a screen recording can't produce it.

---

## Shooting script

| # | TC | Dur | Picture | On-screen text | Audio |
|---|---|---|---|---|---|
| 1 | 00:00–00:02 | 2.0s | Macro: a power bill on a kitchen table, shallow depth of field, morning window light. Rack focus lands on the total. Hold two beats too long — the discomfort is the hook. | — | Room tone. One low sub hit as focus lands. No music yet. |
| 2 | 00:02–00:03 | 1.0s | **Match cut** — the bill total dissolves into the same figure on the Kea dashboard. Screen capture from here on. | — | Music enters: one sustained pad note, no percussion. |
| 3 | 00:03–00:06 | 3.0s | Assistant page, Sparky's ring idle. Question types in, ring spins up. | `"Why was my July bill so high?"` | Soft keystrokes. Rising filtered whoosh on the spin-up, 300ms. |
| 4 | 00:06–00:10 | 4.0s | Answer streams in word by word — **uncut, no speed ramp**. Each figure gets a 200ms violet underline sweep as it lands. | The app's own answer: spike ≈ `$2.64`, sustained ≈ `$290 a year`<br>Lower-third: `Illustrative 30c/kWh` | Soft arpeggio joins. One clean tick per figure — two ticks total, no more. |
| 5 | 00:10–00:13 | 3.0s | Hard cut to the verification log. Headline snaps in with the shield mark. | `N answers · 0 fabricated figures` | A single low-mid impact on the snap. Everything else drops out. |
| 6 | 00:13–00:15 | 2.0s | Cut to black at 00:13.0 — six full frames of true black before the logo fades up. The black is doing work; don't shorten it. | `Kea` — beat —<br>`The model writes the sentence.`<br>`It never does the maths.` | Music resolves to root and decays past the last frame. Silence under the endline. |

---

## Shooting shot 1 without a camera crew

The only live-action frame in the film, and it's two seconds. A phone shoots it fine.

- **Light:** one window, side-on, mid-morning. No overheads — kill the room lights, they
  go green on phone sensors and fight the grade.
- **Lens:** phone macro or 2× telephoto, close enough that the total fills roughly a third
  of frame. Portrait/cinematic mode gives you the shallow depth of field for free.
- **The rack focus:** if your phone won't pull focus manually, fake it — start with the
  phone slightly too close so the bill is soft, and ease back until it snaps sharp. Same
  read, no manual lens control needed.
- **The bill:** print a real one, or a plausible statement layout. It's on screen for two
  seconds at shallow focus — nobody reads it. **Do not put a fabricated Kea-branded bill
  on screen**; use a generic statement or your own, and don't show a retailer's logo.
- **Shoot 10 takes.** It's two seconds and it's free.

## The voiceover without talent

34 words, ~2.4 words/sec, leaves air.

> (00:03) "You get the bill. Nobody tells you why."
> (00:06) "The spike everyone stares at cost two dollars. The load nobody shows you costs
> two-ninety a year."
> (00:11) "Every figure, checked before you see it."

**Two ways to get it, in order of preference:**

1. **Record it yourself.** Phone voice memo, in a wardrobe or a car — soft surfaces kill
   the room reflections that make amateur VO sound amateur. Close to the mic, half a step
   quieter than feels natural. This beats synthetic VO nearly every time.
2. **Synthesise it.** The `video-toolkit` skill does AI voiceover; pick a neutral,
   non-announcer voice and slow it slightly. Acceptable, and obviously synthetic to
   anyone listening for it.

Direction either way: land "two-ninety" **flat**, no lift. The number sells itself, and
selling it twice reads as an ad.

**If the VO isn't good, cut it.** The film works silent with burned subtitles — that's
how it'll be watched on a phone anyway. A weak VO is worse than none.

---

## Grade, type, motion

**Grade** — cool, low-contrast, single violet accent pulled from the app's own token
(`--shadow-button`). The bill in shot 1 is the only warm frame in the film; that contrast
is what makes the cut to the dashboard feel like relief. This is two adjustment layers in
any NLE, not a colourist's job.

**Type** — the app's own UI font. Do not introduce a title typeface. Endline ~64px
equivalent, tight tracking, left-aligned to the logo's optical left edge.

**Motion** — every entrance is opacity + 8px translate, 240ms,
`cubic-bezier(.2,.8,.2,1)`. Nothing scales. Nothing bounces. One easing curve for the
whole film.

**Sound** — one pad, one arpeggio, one impact. Duck −6dB under VO. Use a royalty-free
bed; do not put an unlicensed track on something that goes in front of judges.

---

## Rules carried over from the deck clip — still non-negotiable

1. **Real data, seeded H-A.** `$2.64` and `$290` are pinned by `test_analytics_july.py`.
   A film about not fabricating figures cannot contain one.
2. **`Illustrative 30c/kWh` lower-third is mandatory.** Kea's tariff isn't public.
3. **Cursor hidden** except while typing. Capture at 2× and downscale — 1:1 capture of a
   HiDPI panel aliases the chart strokes.
4. **Warm the model before capture.** Cold start reads as a crash.
5. **Shot 4 stays uncut.** The streaming is the product.

## Deliverables

- `kea-15s-hero_1920x1080.mp4` — H.264, 20 Mbps, burned subtitles
- `kea-15s-social_1080x1920.mp4` — 9:16, no VO, subtitles enlarged, shot 4 reframed to
  the answer text only (the chart doesn't survive the crop)
- `kea-mvp-15s.mp4` — the deck clip from `demo-video-15s.md`, **embedded in the deck as
  the fallback**, not linked. Conference wifi.

## What's still cut, and why

The live demo's job, not the film's — see `demo-script.md`:

- **The honest refusal** (`"Which appliance caused it?"`) — your strongest beat, needs a
  spoken setup line. It's the whole 30s cut if you ever make one; shoot it in the same
  session rather than re-lighting later.
- **Hardship routing to a human.** Two seconds would trivialise it.
- **Voice / the mic.** Three seconds just to establish the channel.
- **"Runs entirely on this laptop."** Post-Connect that's only true of some channels.
  Agree the wording (`docs/roadmap.md`) before it's said anywhere.

## Order of work

1. Screen captures first — shots 2–5 are shared with the deck clip, capture once, use twice
2. Cut the deck clip, export, **put it in the deck.** Now you're safe
3. Shoot shot 1, record VO, grade, cut the hero
4. If step 3 runs out of road, you've already shipped

## Related

- `docs/sprints/sprint-2/demo-video-15s.md` — the deck clip / fallback
- `docs/sprints/sprint-2/demo-script.md` — the 7-line live demo
- `services/web/src/pages/VerificationPage.tsx` — shot 5's screen
- `services/api/app/analytics/engine.py` — where `$2.64` and `$290` come from
