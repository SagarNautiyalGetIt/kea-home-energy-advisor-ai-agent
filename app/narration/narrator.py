"""Layers 2 + 3 wired together: generate, verify, and degrade gracefully.

The policy in one line: draft -> verify -> on failure regenerate once -> on second
failure fall back to a deterministic template. A boring correct answer always beats
a fluent unverified one.

Every rejection is logged with the offending token. That log is the evidence behind
"N prompts, 0 fabricated figures" — it is not debug output, it is the deliverable.
"""

from __future__ import annotations

import logging

from app.narration.prompts import SYSTEM, build_user_prompt
from app.providers.base import LLMProvider
from app.schemas import FactBundle, VerificationReport
from app.verification.number_checker import template_fallback, verify

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 2


async def _generate(provider: LLMProvider, bundle: FactBundle, question: str) -> str:
    chunks: list[str] = []
    async for piece in provider.narrate(
        system=SYSTEM,
        user=build_user_prompt(bundle, question),
        max_tokens=300,
    ):
        chunks.append(piece)
    return "".join(chunks).strip()


async def narrate_verified(
    provider: LLMProvider,
    bundle: FactBundle,
    question: str,
) -> tuple[str, VerificationReport]:
    """Produce prose that is guaranteed not to contain an uncomputed number."""
    report = VerificationReport(passed=False)

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            draft = await _generate(provider, bundle, question)
        except Exception as exc:  # noqa: BLE001 - any provider failure degrades, never 500s
            # Model unreachable, throttled, or timed out. A boring correct answer beats
            # a stack trace, and it means the frontend can integrate before anyone has
            # a model installed.
            log.error("provider %s unavailable (%s) — serving template", provider.name, exc)
            report.fell_back_to_template = True
            return template_fallback(bundle), report

        report = verify(draft, bundle)
        report.regenerated = attempt > 1

        if report.passed:
            return draft, report

        log.warning(
            "number-checker rejected draft (attempt %d/%d) intent=%s customer=%s unverified=%s",
            attempt,
            MAX_ATTEMPTS,
            bundle.intent,
            bundle.customer_id,
            report.unverified,
        )

    report.fell_back_to_template = True
    log.error(
        "falling back to template after %d rejected drafts intent=%s customer=%s",
        MAX_ATTEMPTS,
        bundle.intent,
        bundle.customer_id,
    )
    return template_fallback(bundle), report
