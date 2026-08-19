# AI team

## You own

| Path | What |
|---|---|
| `ml/` | Prompts workbench, the golden set, evals, benchmarks |
| `services/api/app/narration/` | The prompt and narrator that actually run |
| `services/api/app/providers/` | Ollama today, Bedrock in Sprint 3 |

The runtime code lives in the backend service because the API imports it per request.
CODEOWNERS routes those paths to you anyway — you review changes to them wherever they
sit.

## First hour

```bash
make setup
make ml-pull          # gemma3:4b, qwen3:4b — NATIVE ollama, not Docker
make ml-bench         # words/sec on this machine
make api-dev
```

Read [ADR-0002](../adr/0002-narrate-only-architecture.md) and
[ADR-0005](../adr/0005-two-speed-models.md) before touching a prompt.

## The thing to internalise

**The model narrates. It does not decide, and it does not calculate.**

Layer 0 (Python) picks the intent. Layer 1 (Python) computes the facts. You get layer 2:
turn a `FactBundle` into 2–4 sentences. Layer 3 (Python) then rejects any figure in your
output that doesn't trace back to layer 1.

Tool *selection* is the hardest task for a small local model, so we removed it entirely.
If a proposal starts with "what if the model chose which…", the answer is in ADR-0002 and
the bar for reopening it is an ADR, not a PR.

The hardest bundle to get right is the **empty** one — the intent with no analytics path
yet. Layer 3 cannot protect you there: "your usage was higher than last winter" contains
no numeric token, passes the number-checker, and reaches the customer as a fabrication.
The caveats in that bundle are the only guard. Don't remove them when KEA-69 lands —
replace them with real facts.

## Rules specific to you

- **Don't tune prompts before the golden set exists (Day 6).** Tuning without a
  measurement is vibes — you cannot distinguish an improvement from a regression, and
  neither can your reviewer. Build `ml/goldens/` first.
- **Ollama runs natively, never in Docker.** Docker Desktop on macOS is a Linux VM with
  no Apple GPU access, so a containerised model server silently drops to CPU speed —
  78 words/sec becomes single digits, mid-demo.
- **Never name an appliance.** The refusal is deliberate. If a prompt change makes the
  model start guessing at appliances, that is a regression, not a feature.
- Record bake-off results in `ml/evals/`, with the model, the machine and the date. A
  words/sec number without a machine attached is not a result.

## Related

- [`../../ml/README.md`](../../ml/README.md)
- [`../adr/0004-llm-provider-interface.md`](../adr/0004-llm-provider-interface.md)
- [`../../ml/benchmarks/device/results/VERDICT.md`](../../ml/benchmarks/device/results/VERDICT.md)
