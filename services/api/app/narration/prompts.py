"""Layer 2 prompts — the model's only job is to write the sentence.

Two things carry most of the quality on a small local model:

1. **Few-shot examples beat abstract instruction.** A 4B model follows a worked
   example far more reliably than a rule. Add examples per intent as the golden set
   exposes failures — that is the tuning loop, and it only works once the golden
   set exists. Do not tune before you can measure.

2. **Give it pre-formatted numbers to copy.** Every Fact carries a `display`
   string. Telling the model to reuse those verbatim, rather than formatting values
   itself, raises the layer-3 pass rate substantially and costs nothing.
"""

from __future__ import annotations

from app.schemas import FactBundle, Intent

SYSTEM = """You are Sparky, Kea Energy's home energy advisor. You explain power bills to \
New Zealand households in plain English.

Absolute rules:
- Use ONLY the figures given to you. Never calculate, estimate, infer or round to a \
new number. Copy the figures exactly as they are written.
- Never compare two figures in words either. Do not say "twice", "double", "half", \
"a third", "three times" or anything like them unless that exact comparison is one of \
the figures you were given. Working it out yourself is still calculating.
- If a figure you need is not provided, say you don't have it. Never fill the gap.
- Never name or guess an appliance. Half-hourly meter data cannot identify appliances.
- Plain language, no jargon. Say "kilowatt hours" or "units", not "kWh consumption".
- Lead with the answer. No preamble, no "Great question".
- 2 to 4 sentences. This may be read aloud over the phone, so keep sentences short.
- Warm and matter-of-fact. Never alarmed, never salesy."""


_INTENT_TASK: dict[Intent, str] = {
    Intent.WHY_HIGH: (
        "Explain what drove the bill. Lead with the steady everyday load rather than "
        "the one-off spike, because that is where the money actually is."
    ),
    Intent.WHAT_WILL_I_PAY: (
        "Give the projected amount for the full month and make clear it is an "
        "estimate based on usage so far."
    ),
    Intent.USING_MORE_THAN_USUAL: "Say whether usage is unusual, and by how much.",
    Intent.WHAT_COSTS_MOST: (
        "Explain what the steady load costs. Be explicit that you cannot identify "
        "which appliance is responsible, and say why in one short clause."
    ),
    Intent.PEAK_USAGE: (
        "Name the highest-usage day, what it used and what it cost, and say how that "
        "compares with a typical day. Do not speculate about what caused it."
    ),
    Intent.TIME_OF_DAY: (
        "You do NOT have hour-by-hour figures. Say plainly that Sparky can show which day "
        "was highest but not yet which hour of the day, then offer the highest day you "
        "were given. Do not name any time, hour or part of the day."
    ),
    Intent.COMPARE_TO_LAST_YEAR: "Compare this period with the same period last year.",
    Intent.TARIFF_CHECK: (
        "Explain what the current plan costs them. Only mention a different plan if "
        "a figure for it is provided."
    ),
    Intent.HARDSHIP: (
        "Acknowledge briefly and warmly, do not lecture, and say you are connecting "
        "them with someone who can help with payment options. Do not give financial advice."
    ),
    Intent.OUT_OF_SCOPE: (
        "Say plainly that this is outside what you can help with, and offer to "
        "connect them with the team."
    ),
}


# One worked example per intent. Grow this from golden-set failures, not from taste.
_FEW_SHOT: dict[Intent, tuple[str, str]] = {
    Intent.WHY_HIGH: (
        "Period: June 2026\n"
        "- Load running every day: 2.4 kWh a day\n"
        "- What that daily load costs over a year: $263 a year\n"
        "- Cost of the one-off spikes: $2.60\n"
        "- Share of the extra usage the spikes explain: 11%\n"
        "- Total cost for June 2026: $180",
        "Most of your bill isn't the odd busy day — it's a steady 2.4 kWh a day that "
        "runs whether you're home or not, and over a year that adds up to $263. The "
        "one-off spikes only explain 11% of the extra usage and cost about $2.60. "
        "Your total for June 2026 was $180.",
    ),
}


def build_user_prompt(
    bundle: FactBundle,
    question: str,
    rejected: list[str] | None = None,
    derived: list[str] | None = None,
) -> str:
    """`rejected` names the tokens layer 3 refused on the previous attempt.

    Retrying with a byte-identical prompt at temperature 0.2 mostly reproduces the
    same failure — the model has no way to know what was wrong. Naming the offending
    tokens is the cheapest correction signal available and costs one short paragraph.
    Whether it actually lifts the pass rate is a golden-set question (KEA-46), not a
    matter of taste: measure it before assuming.

    `derived` names the *worded comparisons* it refused — "twice as much", "half your
    bill". Kept separate from `rejected` and given its own correction, because the two
    need different instructions. "That figure is not in your data" tells a model to look
    at the list again; a model that wrote "double" is not looking at a wrong figure, it
    is looking at two right ones and dividing them, and telling it to re-check the list
    does not address that.
    """
    task = _INTENT_TASK.get(bundle.intent, _INTENT_TASK[Intent.OUT_OF_SCOPE])
    parts: list[str] = []

    example = _FEW_SHOT.get(bundle.intent)
    if example:
        facts_in, answer_out = example
        parts.append(
            "Here is an example of the style expected.\n\n"
            f"FIGURES:\n{facts_in}\n\nANSWER:\n{answer_out}\n\n---\n"
        )

    if rejected:
        offending = ", ".join(sorted(set(rejected)))
        parts.append(
            "YOUR PREVIOUS ANSWER WAS REJECTED. It contained these figures, which are "
            f"not in the data you were given: {offending}\n"
            "Write the answer again using ONLY the figures listed below, copied exactly "
            "as written. Do not calculate, convert, annualise or round to a new number. "
            "If you cannot make the point without a figure you were not given, leave the "
            "point out.\n"
        )

    if derived:
        phrases = ", ".join(f'"{p}"' for p in sorted(set(derived)))
        parts.append(
            "YOUR PREVIOUS ANSWER WAS REJECTED for comparing figures yourself. It said: "
            f"{phrases}\n"
            "That is a calculation even though it contains no number — you divided one "
            "figure by another to get it. Write the answer again and simply state the "
            "figures side by side, letting the reader see the difference for themselves. "
            "Do not characterise the size of a gap in words at all.\n"
        )

    parts.append(f"The customer asked: \"{question}\"\n")
    parts.append(f"Your task: {task}\n")
    parts.append("FIGURES (use these exact values, copy them as written):")
    parts.append(f"{bundle.render_for_prompt()}\n")
    parts.append("ANSWER:")
    return "\n".join(parts)
