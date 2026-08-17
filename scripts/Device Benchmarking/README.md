# Device Benchmarking

**Which machine runs the demo, and which model can it afford?**

The voice feature lives or dies on one number: how fast the machine can generate
words. Everything else in the sprint plan depends on knowing it, so this gets
measured on real hardware rather than estimated.

---

## Why machines differ so much

Generating each word means reading the **entire model** out of memory once. So
speed is set by memory bandwidth, not by how fast the chip computes:

```
words per second  ≈  memory bandwidth  ÷  model size  ×  0.5–0.7
```

Three consequences worth carrying around:

- An **M4 Pro** moves roughly twice the data per second of a base M4, so it
  generates roughly twice as fast on the same model. Confirming which variant a
  machine is matters more than any other spec.
- **Apple Silicon punches above its weight** because unified memory means the GPU
  addresses the same pool as the CPU — a 48 GB Mac holds a model that would need
  an expensive discrete GPU on a PC.
- **Smaller models are faster**, linearly. This is why the Day 6 rule is *ship the
  smallest model that passes the golden set*.

---

## The threshold that matters

| Words/sec | What it means for voice |
|---|---|
| **20+** | Usable. With sentence-streamed speech, first audio lands in about a second |
| 10–20 | Marginal. Might work with aggressive sentence streaming and short answers |
| Under 10 | Not viable. A 60-word spoken reply takes 6+ seconds and callers talk over it |

Time-to-first-word is reported separately, and for the phone channel it matters
more than raw throughput — a caller forgives a slow answer far more readily than
a long silence.

---

## Running it yourself

```bash
cd "scripts/Device Benchmarking"
bash bench-mac.sh
```

Needs Ollama running natively (`brew install --cask ollama`, then open it once).
Takes ~10 minutes including model downloads (~10 GB).

Results are written to `kea-bench-<machine>-<timestamp>.txt` in the current
directory. Move returned files into `results/`.

---

## Sending it to someone else

`bench-mac.sh` is **standalone** — it needs nothing else from this repo. Send just
that one file.

`SHARE-THIS-MESSAGE.txt` is a paste-ready message to send alongside it. It assumes
no technical background.

### The one instruction that avoids every common problem

Tell them to run it with **`bash bench-mac.sh`**, never `./bench-mac.sh`.

That single detail sidesteps all three things that normally go wrong with a file
sent over WhatsApp or email:

| Problem | Why `bash` avoids it |
|---|---|
| File isn't executable after download | `bash` doesn't need the execute bit |
| macOS quarantines downloaded files | `bash` isn't subject to Gatekeeper the way `./` is |
| WhatsApp renamed the extension | `bash` runs the contents regardless of extension |

---

## Reading the results

Each machine's file lists, per model: median words/sec, time to first word, how
long a 60-word spoken answer would take, and a yes/no on voice capability.

**A model reporting `FAILED TO RUN` is a result, not an error.** On a 16 GB
machine, a 12B model may not fit — that tells us the ceiling for that box, which
is exactly what we're trying to establish.

### What to do with the numbers

1. **Fastest machine becomes the demo machine.** Record it in the project note.
2. **Smallest model clearing 20 words/sec becomes the starting candidate** — the
   Day 6 bake-off then confirms it against the golden set.
3. If nothing clears 20, voice needs either a smaller model, harder sentence
   streaming, or a scope conversation. Better to know now than on Day 8.

---

## Related

- `../../docs/adr/0003-voice-transport-skin.md` — the latency budget these numbers feed
- `../../docs/sprint2-board.md` — cards KEA-21, KEA-22, KEA-30
