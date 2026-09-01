# ml/ — AI team

Everything about **how the model behaves** that is not the running service.

## Why the narration code is not in here

`app/narration/` and `app/providers/` live in `services/api/` because they are imported
by the FastAPI process at request time — moving them here would mean a Python package
that imports across service boundaries for no benefit. The AI team **owns those paths**
via `.github/CODEOWNERS`; ownership is a review rule, not a directory.

So: runtime code in `services/api/app/narration/`, everything you measure and iterate on
in here.

| Path | What goes in it |
|---|---|
| `prompts/` | Prompt experiments and versions. The one in production lives in `app/narration/prompts.py` — this is the workbench |
| `goldens/` | The golden set: question → expected facts → acceptable answers. **Landed** — 36 prompts, 14 drafts, runs in CI. See [`goldens/README.md`](goldens/README.md) |
| `evals/` | The harness that scores a model against the golden set, and its results |
| `benchmarks/` | Speed measurements per device and per model |

## The standing rule

> **Don't tune prompts before the golden set exists.**

Tuning without a measurement is vibes. It feels productive and it is unfalsifiable — you
cannot tell an improvement from a regression, and neither can a reviewer. Build
`goldens/` first, then change prompts against it.

## Benchmarks

```bash
make ml-pull     # download the candidate models
make ml-bench    # measure words/sec on this machine
```

Ollama runs **natively**, never in Docker. Docker Desktop on macOS is a Linux VM with no
access to the Apple GPU, so a containerised model server silently drops to CPU speed —
on the demo machine that is 78 words/sec versus single digits. Results and the verdict
are in [`benchmarks/device/results/`](benchmarks/device/results/).

## Related

- [`../docs/adr/0002-narrate-only-architecture.md`](../docs/adr/0002-narrate-only-architecture.md) — the model narrates, Python decides
- [`../docs/adr/0004-llm-provider-interface.md`](../docs/adr/0004-llm-provider-interface.md) — one provider interface
- [`../docs/adr/0005-two-speed-models.md`](../docs/adr/0005-two-speed-models.md) — why there is no second "fast" model
- [`../docs/teams/ai.md`](../docs/teams/ai.md) — team onboarding
