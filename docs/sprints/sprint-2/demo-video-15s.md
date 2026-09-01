# 15-second MVP clip — for the pitch deck

**What this is:** one 15s screen recording of the app as it actually runs, to sit in the
deck and to act as the fallback if the live demo dies in the room.
**What this is not:** an ad. No live-action, no voice talent, no music licensing, no grade.

**Capture:** MacBook Pro M4 Pro, browser at 1440×900, screen recording at 2×, exported
1920×1080 / 25fps. One unbroken take if you can get it.
**Budget:** ~45 minutes including retakes.

---

## The single idea

> The spike everyone stares at isn't the money — and every number you just saw was
> computed, not written.

Fifteen seconds buys one idea and one proof. The idea is the insight; the proof is the
verification log. Everything else waits for the live demo.

---

## The take

| # | TC | Duration | What happens on screen | Text you add in post |
|---|---|---|---|---|
| 1 | 00:00–00:02 | 2.0s | Open on the dashboard, H-A, July. The chart is already drawn — no page load, no spinner. Let it sit still for a full beat before anything moves. | Title card overlay, top-left, fades in and out: `July. $290 over.` |
| 2 | 00:02–00:05 | 3.0s | Cut (or navigate) to the assistant. Type the question live at a normal pace. Sparky's orbit ring spins up as you hit enter. | — (the typed question is the text) |
| 3 | 00:05–00:10 | 5.0s | **The answer streams in. Do not cut, do not speed-ramp, do not trim.** This is the longest beat in the clip on purpose — the streaming is the product. | Nothing. Let the app's own text carry it. Add a small lower-third: `Illustrative 30c/kWh` |
| 4 | 00:10–00:13 | 3.0s | Cut to the Verification page. The headline row is already populated — you ran questions before recording. | Highlight box (violet, 2px) drawn around the headline for the last 1.5s |
| 5 | 00:13–00:15 | 2.0s | Cut to a plain slide: Kea mark, endline. | `The model writes the sentence.`<br>`It never does the maths.` |

**The question to type in shot 2:** `Why was my July bill so high?` — demo line 1, the one
the rest of the pitch is built on.

**What the answer must contain** (shot 3, from H-A's real analytics):
- the one-day spike ≈ **$2.64**
- the sustained overshoot ≈ **$290 a year**

**What the verification headline must read** (shot 4): `N answers · 0 fabricated figures`.
Run enough questions before you hit record that N is a believable number — 8 to 12. An
`N` of 1 undersells it and an obviously round 20 looks staged.

---

## Rules that are not negotiable

1. **Real data, seeded household H-A.** A clip about not fabricating figures cannot
   contain a fabricated figure. `$2.64` and `$290` are pinned by `test_analytics_july.py`
   — if what's on screen doesn't match, fix the seed, not the video.
2. **The `Illustrative 30c/kWh` lower-third is mandatory.** Kea's tariff is not public and
   every surface showing a dollar figure has to say so. This is the same rule the deck
   follows.
3. **Hide the cursor** except while typing in shot 2. A cursor drifting around makes it a
   screencast; a still frame makes it a product.
4. **Warm the model before you record.** Cold start pulls several GB off disk and reads as
   a crash. Ask it one throwaway question first.

---

## Post

Minimal. Anything more is time you don't have.

- Cuts only — no transitions, no dissolves, no zooms.
- Text overlays: the app's own UI font, fade in over 200ms, no motion.
- **No music.** It plays in a room with a presenter talking over it. Export silent.
- Export: `kea-mvp-15s.mp4`, H.264, 1920×1080. Put it in the deck as an embedded file,
  not a link — conference wifi.

---

## What's deliberately not in it

These are the live demo's job, not the clip's — see `demo-script.md`:

- **The honest refusal** (`"Which appliance caused it?"`). The strongest moment in the
  product, and it needs a spoken setup line to land. Say it in the room.
- **Hardship routing to a human.** Two seconds would trivialise it.
- **Voice.** Costs three seconds just to establish the channel.
- **"Runs entirely on this laptop."** Post-Connect that's only true of some channels.
  Agree the wording (`docs/roadmap.md`) before it's said anywhere, including here.

## Before you hit record

- [ ] Model warmed with a throwaway question
- [ ] H-A seeded; confirm `$2.64` and `$290` render exactly
- [ ] 8–12 real questions asked, so the verification log is populated
- [ ] Browser at 1440×900, bookmarks bar hidden, notifications off (macOS Focus)
- [ ] Cursor hidden in the recorder's settings

## Related

- `docs/sprints/sprint-2/demo-script.md` — the 7-line live demo this clip compresses
- `services/web/src/pages/VerificationPage.tsx` — shot 4's screen
- `services/api/app/analytics/engine.py` — where `$2.64` and `$290` come from
