"""Answering when the customer has no connection.

## The case this exists for

A rural household on the end of a bad line. They can reach the app most evenings and not
at all during a storm — which is exactly when a bill-shock warning is worth having. A
server-side model fallback does nothing for them: with no connection they cannot reach
this API at all, so the question is not *which model we run* but *what is already on the
phone*.

## The design, and the constraint it has to respect

The rule that governs this whole system is that **the numbers are computed by code and
the model only writes the sentence**. An on-device model is the easiest place to lose
that. Handing a phone a month of meter readings and a 1B model, and asking it "what will
my bill be", is asking a small model to do arithmetic — the single thing small models are
worst at, on the single question where a wrong answer destroys the product's claim.

So the device never computes either. The pack below contains **fact bundles that the
server already computed**, one per supported intent, each with its caveats. Offline, the
phone does exactly what the server does, minus layer 1:

    layer 0   route the question to an intent      rules, ~2 KB of regex, no model
    layer 1   look the bundle up in the pack       a dictionary read, not arithmetic
    layer 2   narrate from that bundle             the on-device model
    layer 3   check every figure against the pack  the same number checker, ported

Layers 0, 1 and 3 are identical in kind to the server's. Only layer 2 differs, and layer
2 is the layer that was never allowed to touch a number anyway. That is what makes an
offline answer trustworthy rather than a downgrade with a disclaimer.

## What the customer is told, and when

Nothing is downloaded to anybody's phone by default. A ~1 GB model on a metered
connection, pushed to a customer who has perfect coverage, is a cost we have imposed on
them for our convenience. The app asks once, at sign-up, and only records the answer —
`AlertPreferences.offline_model_opt_in`. The server never pushes; the client fetches when
the customer has said yes and is on wifi.

The pack is **stamped and stale-able**. Every bundle carries the period it was computed
for and the time it was built, and the client is required to show that date on any answer
served from it. "Your July bill was $312" is true; "your bill is $312" said in September
from a July pack is not, and the difference is a label the UI is not allowed to omit.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, Field

from app.analytics.bundles import bundle_from_context
from app.analytics.repository import UsageContext
from app.schemas import FactBundle, Intent

#: Intents whose answers can be precomputed without knowing the question.
#:
#: HARDSHIP is deliberately absent, and it is the most important omission here. A
#: household in payment difficulty needs a person, and the escalation path to one runs
#: over the network. An offline model producing a warm, fluent, self-contained reply about
#: payment options would *replace* that handoff with a dead end — the customer would feel
#: heard and nobody would be told. Offline, the app must say it cannot help with this
#: until it reconnects, and say it plainly.
#:
#: OUT_OF_SCOPE is absent for the ordinary reason: there is nothing to precompute.
OFFLINE_INTENTS: tuple[Intent, ...] = (
    Intent.WHY_HIGH,
    Intent.WHAT_WILL_I_PAY,
    Intent.USING_MORE_THAN_USUAL,
    Intent.WHAT_COSTS_MOST,
    Intent.PEAK_USAGE,
    Intent.TIME_OF_DAY,
    Intent.TARIFF_CHECK,
)

#: How long an offline pack may be presented as current before the app must warn. Slightly
#: longer than a billing cycle, so a customer who syncs once a month is not permanently
#: looking at a staleness banner — but short enough that it cannot silently span two.
PACK_FRESHNESS_DAYS = 35


class OfflineModelOption(BaseModel):
    """One downloadable on-device model.

    Sizes are the quantised download, not the parameter count, because that is the number
    the customer is agreeing to spend. Quoting "1B parameters" to somebody deciding
    whether to use their data is not an answer to the question they asked.
    """

    id: str
    label: str
    download_mb: int
    ram_required_mb: int
    quantisation: str
    languages: list[str] = Field(default_factory=lambda: ["en"])
    notes: str | None = None


#: Deliberately small. The device model narrates from a fact bundle — three sentences from
#: a list of pre-formatted numbers — which is the least demanding thing any model in this
#: system does. Shipping a 7B model to do it would quadruple the download for output
#: nobody can tell apart, and would exclude the mid-range Android hardware this feature
#: exists for.
#:
#: Sizes below are the published quantised artefact sizes and must be re-checked against
#: the distribution actually bundled — a figure quoted to a customer before a download is
#: a figure that has to be right.
OFFLINE_MODELS: list[OfflineModelOption] = [
    OfflineModelOption(
        id="gemma3-1b-it-q4",
        label="Standard (recommended)",
        download_mb=530,
        ram_required_mb=1400,
        quantisation="int4",
        notes="Runs on most phones from the last four years.",
    ),
    OfflineModelOption(
        id="gemma3-4b-it-q4",
        label="Better answers, larger download",
        download_mb=1800,
        ram_required_mb=4000,
        quantisation="int4",
        notes="Noticeably more fluent. Needs a recent phone and about 2 GB of space.",
    ),
]


class OfflineAnswer(BaseModel):
    """One precomputed intent, ready for the device to narrate."""

    intent: Intent
    bundle: FactBundle
    #: The exact prose the device must fall back to if its model is unavailable or its
    #: verification pass rejects the draft. Computed server-side so an offline device is
    #: never left with nothing — and so the fallback text is itself verified.
    template: str


class OfflinePack(BaseModel):
    """Everything a device needs to answer without a network.

    Carries no raw meter series, and that is deliberate rather than a size optimisation.
    A device holding `daily_kwh` is a device whose model can be asked to add it up, and
    the first time someone wires the chat box straight to the readings "to make offline
    smarter", the no-arithmetic guarantee is gone on the platform where it is hardest to
    audit.
    """

    customer_id: str
    period: str
    built_at: datetime
    fresh_until: datetime
    answers: list[OfflineAnswer]

    #: Copied from `app.narration.prompts.SYSTEM` so the device narrates under the same
    #: rules the server does. Shipped rather than embedded in the app binary because a
    #: prompt change has to be able to reach devices without an app-store release.
    system_prompt: str

    #: The bill-shock state as at the last sync. Read-only offline: the device shows it
    #: with its date and does not re-evaluate, because re-evaluating needs readings the
    #: pack does not carry.
    bill_shock: dict | None = None

    schema_version: int = Field(
        default=1,
        description=(
            "Bumped when the pack's shape changes. A device on an older app must refuse a "
            "pack it does not understand rather than reading fields positionally — the "
            "failure mode otherwise is a stale answer with confident wrong numbers."
        ),
    )


@dataclass(frozen=True)
class PackBuilder:
    """Builds a pack from a usage context. Pure apart from the clock.

    Takes the context rather than fetching it so this is testable without a database, and
    so the pack is built from the identical `UsageContext` the online path uses — one
    source of facts, whether the answer is composed in Sydney or on a phone in Taumarunui.
    """

    system_prompt: str

    def build(
        self,
        customer_id: str,
        ctx: UsageContext,
        *,
        bill_shock: dict | None = None,
        now: datetime | None = None,
    ) -> OfflinePack:
        from app.verification.number_checker import template_fallback

        built = now or datetime.now(UTC)
        answers = [
            OfflineAnswer(
                intent=intent,
                bundle=(bundle := bundle_from_context(intent, customer_id, ctx)),
                template=template_fallback(bundle),
            )
            for intent in OFFLINE_INTENTS
        ]

        return OfflinePack(
            customer_id=customer_id,
            period=ctx.window.period,
            built_at=built,
            fresh_until=built.replace(microsecond=0) + timedelta(days=PACK_FRESHNESS_DAYS),
            answers=answers,
            system_prompt=self.system_prompt,
            bill_shock=bill_shock,
        )
