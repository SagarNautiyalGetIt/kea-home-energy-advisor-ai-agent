# AI team

## You own

| Path | What |
|---|---|
| `ml/` | Prompts workbench, the golden set, evals, benchmarks |
| `services/api/app/agent/` | The system prompt, the tool catalogue, and the loop |
| `services/api/app/narration/` | The offline pack's prompt — narrate-only, see below |
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

Read [ADR-0011](../adr/0011-agentic-tool-use.md) before touching a prompt, and
[ADR-0002](../adr/0002-narrate-only-architecture.md) after it — 0002 is superseded, but
it explains what the current design is a reaction to and what it gave up.

## The thing to internalise

**The model reads the data and answers. Two things are still not its call.**

It calls tools over the customer's own meter data and writes the answer — length, depth,
what to compare, what the question actually meant. What it does *not* get to choose:

- **which household.** `customer_id` is bound from the request and is never a tool
  parameter. If you add a tool, it must not accept one. `test_agent.py` asserts this, and
  that assertion is not negotiable in review — a prompt cannot be trusted to hold a
  security boundary.
- **the constraints that are true about the data.** One meter reads one number for the
  whole house, so it cannot identify an appliance. The tariff is illustrative. Those are
  physics and licensing, not tone, and they survived the rewrite for that reason.

**Tool descriptions are prompt engineering.** They are where most of the routing quality
now lives — "returns daily usage" tells the model nothing about *when* to reach for it
rather than `get_bill_comparison`. Write them as answers to "which question is this for".

**The offline pack is still narrate-only** and still yours: `app/analytics/bundles.py`
plus `app/narration/prompts.py`. A device with no connection cannot call a tool, so it
gets a pre-computed `FactBundle` and the number-checker. The hardest bundle there is the
**empty** one — the intent with no analytics path yet. The checker cannot protect you:
"your usage was higher than last winter" contains no numeric token, passes, and reaches
the customer as a fabrication. The caveats are the only guard. Don't remove them when
KEA-69 lands — replace them with real facts.

## Rules specific to you

- **Don't tune prompts before the golden set exists (Day 6).** Tuning without a
  measurement is vibes — you cannot distinguish an improvement from a regression, and
  neither can your reviewer. Build `ml/goldens/` first.
- **A local model needs a tool template.** `gemma3` has none: it ignores a `tools` array
  and answers from the system prompt alone, which is a fluent reply with no meter data
  behind it — the worst failure available here, because it looks exactly like a good one.
  `OllamaProvider.supports_tools` gates it. Use `qwen3` or `llama3.1`+ to run the agent
  locally.
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
