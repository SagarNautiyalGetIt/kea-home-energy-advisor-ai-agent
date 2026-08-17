# ADR-0004 — One provider interface: Ollama now, Bedrock later

**Date:** 2026-08-17 · **Status:** Accepted · **Owner:** Akash

## Context

Sprint 2 runs entirely locally — no cloud, no API keys, no network at demo time. The
pitch narrative is AWS Bedrock. Those are different runtimes with different SDKs, and
the migration happens in Sprint 3 under deadline pressure.

## Decision

Every model call goes through a single `Protocol` in `app/providers/base.py`. Nothing
above the provider layer may import `ollama`, `httpx`-to-Ollama, `boto3`, or
`anthropic`.

```python
class LLMProvider(Protocol):
    name: str
    model: str
    async def narrate(self, *, system, user, max_tokens, temperature) -> AsyncIterator[str]: ...
    async def health(self) -> bool: ...
```

`OllamaProvider` is live. `BedrockProvider` exists as a stub with implementation notes
and raises `NotImplementedError` — written now, unused, specifically so the seam is
proven rather than assumed. `app/config.py::get_provider()` is the only place a
concrete provider is constructed.

**Prompt construction lives outside the provider.** The provider transports; it does
not decide.

## Consequences

- Sprint 3's migration is one new class, not a refactor.
- We can A/B a local model against a hosted one on the same golden set — *"same
  architecture, two backends, here is the quality and cost difference"* is a real
  slide that only exists because of this seam.
- Cost of the abstraction: one indirection, roughly thirty minutes.

## Token accounting is not optional

Running locally means there is no invoice to measure, so the cost-to-serve argument
becomes a **projection**: measured tokens × published Bedrock rates. That only works
if tokens are logged from the first call, so `OllamaProvider` captures
`prompt_eval_count` and `eval_count` from Ollama's final chunk into `last_usage`.

Present it as *"measured token usage across N conversations × published rate"*, with
the pricing page cited — never as a measured cost. Do not quote first-party Anthropic
prices as Bedrock prices; Bedrock is separately priced.

## Bedrock notes for Sprint 3

- Client is `AnthropicBedrockMantle(aws_region=...)`; model ids take an `anthropic.`
  prefix (`anthropic.claude-sonnet-5`). A first-party id will 400.
- Model access is opt-in per account **per region** — enable it in the console before
  the first call. Verify which models are served in `ap-southeast-2`.
- Prompt caching works; *automatic* caching does not. Place `cache_control` by hand,
  keep the stable prefix cached, and put per-customer facts **after** the last
  breakpoint — that boundary is simultaneously the cache-sharing boundary and the
  privacy boundary.
- Batches, Files API and Managed Agents are unavailable on Bedrock. None are needed.
