"""Sprint 3 provider — Claude on Amazon Bedrock. NOT USED IN SPRINT 2.

Deliberately written now, even though it is unused, so that ADR-04 is real rather
than aspirational: if this file can be filled in without touching anything above
the provider layer, the seam holds.

Notes for whoever finishes this:

* Client is ``AnthropicBedrockMantle(aws_region=...)`` from the ``anthropic`` SDK.
* Bedrock model ids carry an ``anthropic.`` prefix — ``anthropic.claude-sonnet-5``.
  A first-party id will 400.
* Model access is opt-in per account, per region: enable it in the Bedrock console
  before the first call. Verify which models are actually served in
  ``ap-southeast-2`` (Sydney) — NZ data residency is a pitch point, and regional
  availability varies.
* Prompt caching works on Bedrock, but *automatic* caching does not — place
  ``cache_control`` breakpoints by hand. Keep the stable prefix (system prompt,
  tone rules) cached and put per-customer facts AFTER the last breakpoint: that is
  both the cache-sharing boundary and the privacy boundary.
* Do not disable thinking outright on Sonnet 5 — set a low ``effort`` instead.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from app.providers.base import TokenUsage


class BedrockProvider:
    name = "bedrock"

    def __init__(
        self,
        model: str = "anthropic.claude-sonnet-5",
        aws_region: str = "ap-southeast-2",
    ) -> None:
        self.model = model
        self.aws_region = aws_region
        self.last_usage = TokenUsage()

    async def narrate(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 300,
        temperature: float = 0.2,
    ) -> AsyncIterator[str]:
        raise NotImplementedError(
            "Sprint 3. Implement with AnthropicBedrockMantle(aws_region=self.aws_region) "
            "and .messages.stream(); populate self.last_usage from the final message."
        )
        yield ""  # pragma: no cover - keeps the async-generator signature honest

    async def health(self) -> bool:
        return False
