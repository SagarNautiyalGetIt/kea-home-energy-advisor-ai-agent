# ADR-0011 — The model reads the data and answers; Python serves it

**Date:** 2026-09-08 · **Status:** Accepted · **Owner:** Akash ·
**Supersedes:** [ADR-0002](0002-narrate-only-architecture.md)

## Context

ADR-0002 chose narrate-only: Python routed the question to one of a fixed set of
intents, computed a `FactBundle`, and the model wrote two to four sentences from it
which a number-checker then verified. That was the right call for what it was built
for — a 4B local model on laptop hardware, where tool selection was measurably the
hardest thing to ask of it, and where "the numbers are calculated by code" answered
the survey's largest concern directly.

Two things changed. The default provider is a frontier model on a cloud account, so
the constraint the design was built around no longer holds. And the architecture's
predicted cost — ADR-0002 listed it under *Accepted*, plainly — arrived:

> The agent cannot answer a question we did not anticipate. It routes to out-of-scope
> and offers a human.

In use that reads as one product complaint with two halves.

**Every answer sounded the same.** Layer 0 was keyword matching over a closed set of
26 intents. Anything it did not recognise fell through to an empty `FactBundle` whose
caveat instructed the model to say it could not help and offer the team, so questions
the data could answer perfectly well came back as a handoff. The ones that *did* route
produced near-identical restatements of a fixed fact list, because that is exactly
what the prompt asked for.

**Nothing could be explained in depth.** The system prompt capped answers at two to
four sentences and forbade the model from calculating, comparing, inferring, or
characterising a difference in words. A customer asking why their bill jumped $80 got
a headline. Asking for more got the handoff sentence, because there was no mechanism
for more — and the sentence it produced, *"if you'd like this explained in more detail
I can connect you with our team"*, is a strange thing for an AI advisor to say about
its own subject matter.

Neither is fixable by prompt tuning. Both are the architecture working as designed.

## Options considered

**A. Keep narrate-only, widen the intent set.** Add intents until the router
recognises more. Rejected: it does not converge — the space of things a customer might
ask is not enumerable, and each addition costs four coordinated changes (router rule,
analytics path, narration prompt, golden-set cases). The 26th intent did not make the
27th cheaper.

**B. Hybrid** — Python routing for known intents, model tool-calling for the rest.
This was ADR-0002's own "revisit in Sprint 3" suggestion. Rejected on reflection: it
keeps both mechanisms and their failure modes, and the router is still the thing that
decides which one runs — so a misroute still lands on the narrow path. Two systems,
one of them still the bottleneck.

**C. Model-driven tool use.** The model reads the question, decides what it needs,
fetches it through typed tools, and writes the answer.

## Decision

**Option C.**

    build_context()   fetch this household's data once   (I/O, scoped server-side)
    run_agent()       model reads, calls tools, answers  (app/agent/)

Eight tools over the customer's own data: account summary, daily usage, bill
comparison, hourly profile, peer comparison, plan options, bill projection, and a
handoff. Up to six rounds; the last is answered without tools so hitting the cap still
produces an answer.

### What Python still owns, and why that is not the middleman we removed

- **Scope.** `customer_id` is bound from the authenticated request and is never a tool
  parameter. No argument the model can pass reaches another household's data. This one
  must not be a matter of prompting, and `test_agent.py` asserts the schemas make it
  unsayable.
- **Retrieval.** SQL, mart selection, timezone handling, `Decimal` conversion at the
  boundary. A model writing its own SQL against `kea.*` is a worse version of a job dbt
  already did.
- **The forecast.** `project_this_bill` runs the weather-normalised regression with its
  published prediction interval. Asking a language model to eyeball a trend line
  instead would be a downgrade dressed as autonomy. It is offered as a tool the model
  *may* call — the difference from the old pipeline is that the model decides whether a
  projection is relevant rather than having one forced on it.

### What the trust claim became

The old claim was *"the model cannot state a figure Python did not compute"*, enforced
by never letting the model see any data, and measured by the number-checker.

The new claim is *"every figure traces to a row the model actually read, and the read
is recorded"*. `app.agent_tool_call` stores each call with its arguments and its whole
result; the answer names its sources in the response and in the UI.

This is not a relaxation. The number-checker matched tokens against a list of permitted
values — which is a strong guarantee about *fabrication* and says nothing about whether
the figure meant anything, and which would now reject the arithmetic that makes an
explanation an explanation ("your bill rose 14%", "$263 a year"). Recorded provenance
is what a customer disputing a figure actually needs, and it survives the model getting
better at arithmetic.

## Consequences

**Accepted:**

- **A wrong answer is now possible in a way it was not before.** The model can
  misread data it can see. The old design made that structurally impossible by making
  reading impossible. This is a real trade and it is the one being made deliberately:
  a system that cannot be wrong because it cannot answer is not obviously safer for the
  customer than one that can do both.
- **No offline story here.** A device with no connection cannot call tools. The offline
  pack keeps narrate-only — see `app/analytics/bundles.py` and
  [ADR-0008](0008-offline-first-narration.md). Both architectures live in the
  repository, each where it is correct.
- **Cost per turn is up.** Three to four model calls instead of one, and the tool
  results are in context on every subsequent round. Measured in `app.token_usage` as
  before; the accumulated total is recorded, not just the final call's.
- **Local models need a tool template.** `gemma3` has none: it ignores a `tools` array
  and answers from the system prompt alone, which is a fluent reply with no data behind
  it — the worst failure available here. `OllamaProvider.supports_tools` gates this and
  the chain refuses rather than faking it.
- **No template fallback.** A provider outage is now no answer plus an honest message,
  where before it was a template built from the bundle. That template worked because
  the model was formatting figures Python had already computed. Nothing stands in for
  reasoning.

**Gained:**

- Questions nobody anticipated get real answers, and partial ones get partial answers
  with the gap named — *"I can show which day was highest but not which hour, because
  this account has no half-hourly profile"* instead of a handoff.
- Answers have depth, and length matched to the question.
- Follow-ups work: conversation history reaches the model, so "what about last month?"
  resolves against the turn before it. The old pipeline routed and answered every
  question in isolation.
- One mart that was modelled and never read (`kea.mart_hourly_profile`) is now
  answerable for the accounts that have one. The old blanket refusal on time-of-day was
  correct for the seeded households and was being applied to every account.
- Adding a capability is one tool with a good description, not four coordinated
  changes across a router, analytics, a prompt and a golden set.

## Notes

ADR-0002 was not wrong and this is not a correction of it. Read its *Consequences*
section: it named the cost of the design accurately on day one and chose it anyway,
for reasons that held at the time. This ADR exists because those reasons stopped
holding, which is the situation ADRs are for.

Voice remains a transport skin ([ADR-0003](0003-voice-transport-skin.md)) — all
channels call `app.pipeline`, and none has its own copy of the loop. The provider
interface ([ADR-0004](0004-llm-provider-interface.md)) gained `converse()` alongside
`narrate()`; both are implemented for Bedrock, Gemini and Ollama.

The one thing worth watching: ADR-0005 decided against a second "fast" model partly
because layer 0 could produce an intent in ~0 ms, which gave voice something to say
instantly. There is no intent now, so the spoken acknowledgement is one generic line.
That is a small, real loss and it is recorded in `app/voice/tts.py` rather than
pretended away.
