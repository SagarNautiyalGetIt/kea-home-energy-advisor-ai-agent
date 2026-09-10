"""Read an electricity bill from a photo or a PDF.

## Why this sits outside `LLMProvider`

The provider Protocol is text in, text out, and every provider implements it. Bills are
a different modality, so widening the Protocol would make Bedrock, Ollama and the
cassette recorder all carry a method only one feature uses. `voice/stt_gemini.py` faced
the same choice for audio and resolved it the same way: talk to Gemini directly, on the
credential the project already has, and keep the Protocol for the thing every provider
really does.

## The trust story here is NOT the trust story everywhere else

Every other figure in this product comes from a row of the customer's own metered data,
and the answer names the lookup that produced it. **These figures come from a model
reading a photograph.** That is a genuinely weaker claim and it has to be labelled as
one, because the failure mode is specific and plausible: a smudged 8 read as a 3, a
GST-inclusive total read as ex-GST, a two-month bill read as one month.

Three things follow, and none of them is optional:

1. **Every extracted field carries the model's own confidence**, and anything it could
   not read comes back null rather than guessed. A bill reader that always returns a
   number is a bill reader that invents one.
2. **The customer is shown what was read before anything is concluded from it.** They
   are holding the bill; they are the cheapest and most reliable validator available.
3. **The comparison is arithmetic, not judgement.** Once the usage is extracted, their
   kWh is priced against Kea's published plans by `analytics/plans.py` — the same code
   that prices a Kea customer's own usage. Nothing about "is their retailer bad" is left
   to the model.

## On recommending ourselves

This feature exists to convert somebody, which is exactly why it needs the tighter leash
rather than the looser one. `app/bills/compare.py` decides whether Kea is actually
cheaper on the customer's own numbers, and the model is not given room to argue when it
is not — see the guardrail in `docs/sprints/sprint-3/plans-and-terms.md`: a term credit
may never turn a more expensive plan into a saving.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

#: One HTTPS round trip against a hosted model with an image attached. Longer than the
#: voice budget because a PDF page is a lot more tokens than eight seconds of speech,
#: and short enough that a customer is not left watching a spinner indefinitely.
READ_TIMEOUT_S = 30.0

#: Bills arrive as phone photos. 12 MB covers a high-resolution capture with room to
#: spare; past that it is a video frame grab or somebody's holiday album, and sending it
#: costs the customer latency for an answer that will not improve.
MAX_BYTES = 12 * 1024 * 1024

ACCEPTED = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "application/pdf": "pdf",
}

#: Extraction only. The model is told in the strongest terms available not to reason
#: about the bill, because everything downstream assumes these numbers came off the page
#: rather than out of an opinion about it. `null` is a first-class answer and the prompt
#: says so twice — the tempting failure is a plausible number for a field that is simply
#: not printed on this particular retailer's layout.
_PROMPT = """You are reading a New Zealand electricity bill from an image or PDF.

Extract ONLY what is printed. Do not calculate, infer, estimate or convert anything. If
a field is not clearly legible on the page, return null for it — null is the correct
answer and a plausible guess is not. Do not answer questions about the bill and do not
comment on whether it is good value.

Return JSON matching this shape exactly:

{
  "is_electricity_bill": boolean,
  "retailer": string or null,
  "period_start": "YYYY-MM-DD" or null,
  "period_end": "YYYY-MM-DD" or null,
  "days_in_period": integer or null,
  "total_due_nzd": number or null,
  "total_kwh": number or null,
  "unit_rate_nzd_per_kwh": number or null,
  "daily_charge_nzd": number or null,
  "is_gst_inclusive": boolean or null,
  "has_time_of_use_rates": boolean or null,
  "confidence": "high" | "medium" | "low",
  "unreadable_fields": [string],
  "notes": string or null
}

Rules:
- Rates in cents must be converted to dollars ONLY where the page states the unit
  (e.g. "32.5c/kWh" -> 0.325). If the unit is ambiguous, return null.
- `total_kwh` is the metered electricity for the period. Do not add gas or other lines.
- `is_electricity_bill` is false for anything that is not an electricity bill. Say so
  rather than extracting fields from a gas bill or a receipt.
- `confidence` is about the page, not about you: "low" for a blurred or partial photo.
"""


@dataclass(frozen=True)
class BillReading:
    """What was read off the page. Every money field may be None."""

    is_electricity_bill: bool
    retailer: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    days_in_period: int | None = None
    total_due_nzd: float | None = None
    total_kwh: float | None = None
    unit_rate_nzd_per_kwh: float | None = None
    daily_charge_nzd: float | None = None
    is_gst_inclusive: bool | None = None
    has_time_of_use_rates: bool | None = None
    confidence: str = "low"
    unreadable_fields: list[str] = field(default_factory=list)
    notes: str | None = None
    latency_ms: int = 0

    @property
    def is_comparable(self) -> bool:
        """Enough on the page to price their usage against a Kea plan.

        Usage and a period. Without both, a comparison is not a weaker comparison — it
        is a different household's, and the honest move is to ask for a clearer photo.
        """
        return bool(
            self.is_electricity_bill
            and self.total_kwh
            and self.total_kwh > 0
            and (self.days_in_period or (self.period_start and self.period_end))
        )

    def as_payload(self) -> dict[str, Any]:
        return {
            "is_electricity_bill": self.is_electricity_bill,
            "retailer": self.retailer,
            "period_start": self.period_start,
            "period_end": self.period_end,
            "days_in_period": self.days_in_period,
            "total_due_nzd": self.total_due_nzd,
            "total_kwh": self.total_kwh,
            "unit_rate_nzd_per_kwh": self.unit_rate_nzd_per_kwh,
            "daily_charge_nzd": self.daily_charge_nzd,
            "is_gst_inclusive": self.is_gst_inclusive,
            "has_time_of_use_rates": self.has_time_of_use_rates,
            "confidence": self.confidence,
            "unreadable_fields": list(self.unreadable_fields),
            "notes": self.notes,
        }


class BillReadError(RuntimeError):
    """Something the customer can act on: wrong file, too big, unreadable page."""


def _client():
    from google import genai

    return genai.Client()


def _coerce(raw: dict[str, Any], latency_ms: int) -> BillReading:
    """Model JSON into the dataclass, dropping anything of the wrong type.

    The model is asked for a schema and usually honours it. `_num` exists for the times
    it does not: a rate returned as "32.5c" must become None rather than raise on the
    first multiplication three modules away, where the traceback would say nothing about
    a photograph.
    """

    def _num(key: str) -> float | None:
        value = raw.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return float(value)

    def _int(key: str) -> int | None:
        value = _num(key)
        return int(value) if value is not None else None

    def _str(key: str) -> str | None:
        value = raw.get(key)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def _bool(key: str) -> bool | None:
        value = raw.get(key)
        return value if isinstance(value, bool) else None

    confidence = _str("confidence") or "low"
    return BillReading(
        is_electricity_bill=bool(raw.get("is_electricity_bill")),
        retailer=_str("retailer"),
        period_start=_str("period_start"),
        period_end=_str("period_end"),
        days_in_period=_int("days_in_period"),
        total_due_nzd=_num("total_due_nzd"),
        total_kwh=_num("total_kwh"),
        unit_rate_nzd_per_kwh=_num("unit_rate_nzd_per_kwh"),
        daily_charge_nzd=_num("daily_charge_nzd"),
        is_gst_inclusive=_bool("is_gst_inclusive"),
        has_time_of_use_rates=_bool("has_time_of_use_rates"),
        confidence=confidence if confidence in {"high", "medium", "low"} else "low",
        unreadable_fields=[s for s in raw.get("unreadable_fields", []) if isinstance(s, str)],
        notes=_str("notes"),
        latency_ms=latency_ms,
    )


async def read_bill(data: bytes, content_type: str) -> BillReading:
    """Bytes of a bill in, structured reading out.

    Raises `BillReadError` for anything the customer can fix — an unsupported file, one
    too large, a page the model could not parse. The caller turns that into a message
    rather than a stack trace.
    """
    if content_type not in ACCEPTED:
        raise BillReadError(
            f"Sparky can read a photo or a PDF of your bill. "
            f"{content_type or 'That file'} is not one it can open."
        )
    if not data:
        raise BillReadError("That file was empty.")
    if len(data) > MAX_BYTES:
        raise BillReadError(
            f"That file is {len(data) / 1_000_000:.0f} MB. Please send one under "
            f"{MAX_BYTES // 1_000_000} MB — a normal phone photo is well inside that."
        )

    from google.genai import types

    from app.config import settings

    started = time.perf_counter()
    client = _client()

    def _call():
        return client.models.generate_content(
            model=settings.gcp_model,
            contents=[
                types.Part.from_bytes(data=data, mime_type=content_type),
                types.Part.from_text(text=_PROMPT),
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                # Extraction, not composition. The default sampling temperature invents
                # a digit often enough to matter on a page of digits.
                temperature=0.0,
            ),
        )

    try:
        response = await asyncio.wait_for(asyncio.to_thread(_call), timeout=READ_TIMEOUT_S)
    except TimeoutError as exc:
        raise BillReadError(
            "Reading that bill took too long. Please try again, or ask your question in "
            "words."
        ) from exc
    except Exception as exc:  # noqa: BLE001
        log.warning("bill read failed", exc_info=True)
        raise BillReadError(
            "Sparky could not read that file. A clearer photo of the whole page usually "
            "works."
        ) from exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    text = (getattr(response, "text", "") or "").strip()
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        log.warning("bill read returned non-JSON: %r", text[:200])
        raise BillReadError(
            "Sparky could not make sense of that page. A clearer photo usually works."
        ) from exc

    if not isinstance(raw, dict):
        raise BillReadError("Sparky could not make sense of that page.")

    reading = _coerce(raw, latency_ms)
    log.info(
        "bill read retailer=%r kwh=%s total=%s confidence=%s ms=%d",
        reading.retailer,
        reading.total_kwh,
        reading.total_due_nzd,
        reading.confidence,
        latency_ms,
    )
    return reading
