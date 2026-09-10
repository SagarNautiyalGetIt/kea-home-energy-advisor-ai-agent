"""Turning the driver decomposition into a question worth asking.

## Why the chat path needed its own bridge

`detect.find_gaps` works over a daily kWh series and a weather fit, which is what the
bill-shock endpoint has. The chat explainer has something better: a decomposition that
has already tried every cause it knows and named, in dollars, exactly how much it could
not account for. `delta_unexplained` **is** the quantified gap — the thing
`clarify.select` needs and the thing the old chat path had no way to produce.

So this is a translation, not a second detector. It hands the existing catalogue the same
`DetectedGap` shape it already consumes, and every rule about what may be asked, how
often, and never during hardship stays exactly where it was.

## The rule this keeps

**A question that cannot change the answer is never asked.** The decomposition makes that
cheap to enforce honestly: if the residual is small, the bill is explained and there is
nothing to ask about. An assistant that finds a question every time is running an intake
form, and the fastest way to get one is to trigger on "the model felt unsure" rather than
on an amount.

## Hot water, and the one appliance we are allowed to raise

Everywhere else in this service, naming an appliance is a fabrication — a whole-house
meter reads one number. The controlled-load register is the exception, and for a physical
reason rather than a statistical one: it is separately metered, the network switches it,
and in most New Zealand homes it is the hot-water cylinder.

That still does not let us *say* the cylinder did it. It lets us **ask**, which is what a
strong-but-not-conclusive signal is actually good for. When `controlled_load_shift` shows
that circuit moved, the hot-water hypothesis is promoted from the bottom of the ladder —
where it sits because people rarely know the answer — to the front, because now there is
a reading behind the question rather than a guess.
"""

from __future__ import annotations

from app.analytics.account import AccountContext
from app.analytics.drivers import Confidence, Decomposition
from app.clarify.detect import DetectedGap
from app.clarify.schemas import Gap, Hypothesis

#: Below this, the residual is not worth a question. A customer asked about $3 has been
#: interrupted for nothing, and the payoff line ("this would explain about $3") makes the
#: assistant look worse than saying nothing.
MIN_WORTH_ASKING_NZD = 8.0

#: How much the controlled circuit must move, in kWh a day, before it counts as a signal
#: rather than noise. Roughly a third of a typical cylinder's daily draw — small enough to
#: catch a thermostat nudged up, large enough not to fire on seasonal inlet-temperature
#: drift.
CONTROLLED_SHIFT_KWH_PER_DAY = 0.8


def gaps_from_decomposition(
    result: Decomposition, ctx: AccountContext
) -> list[DetectedGap]:
    """What the decomposition could not explain, as gaps the catalogue understands.

    Ordered by how much each would re-attribute, so `clarify.select` asks about the
    biggest one first. Empty is the common and correct result: a bill whose drivers
    account for it has nothing to ask about.
    """
    gaps: list[DetectedGap] = []

    # 1. The residual. The decomposition tried period length, price, weather, base load
    #    and everything else it knows; whatever is left is, by construction, the part only
    #    the household can explain.
    residual = abs(result.unexplained_nzd)
    if residual >= MIN_WORTH_ASKING_NZD:
        gaps.append(
            DetectedGap(
                gap=Gap.UNEXPLAINED_REMAINDER,
                explains_nzd=round(residual, 2),
                detail=(
                    f"{residual:.0f} of the {abs(result.total_delta_nzd):.0f} change is "
                    f"not accounted for by any measured cause"
                ),
            )
        )

    # 2. A base-load step. The everyday floor moving is the strongest thing to ask about,
    #    because it is the one a household can usually name — something arrived, someone
    #    moved in, the cylinder changed.
    base = next((d for d in result.drivers if d.key == "base_load"), None)
    if base is not None and base.magnitude >= MIN_WORTH_ASKING_NZD and base.amount_nzd > 0:
        gaps.append(
            DetectedGap(
                gap=Gap.BASE_LOAD_STEP,
                explains_nzd=round(base.magnitude, 2),
                detail="the always-on draw rose and stayed up",
            )
        )

    # 3. No weather fit. Without the household's own heating sensitivity there is no
    #    weather driver at all, so a cold period looks like behaviour. Worth asking
    #    whether they heat with electricity — a house that does not has no temperature
    #    response to fit and we should stop looking for one every cycle.
    fitted = any(
        d.key == "weather" and d.confidence is Confidence.MODELLED for d in result.drivers
    )
    if not fitted and ctx.heating_sensitivity_kwh_per_hdd is None:
        movable = abs(result.total_delta_nzd) - abs(result.unexplained_nzd)
        if abs(result.total_delta_nzd) >= MIN_WORTH_ASKING_NZD:
            gaps.append(
                DetectedGap(
                    gap=Gap.NO_WEATHER_FIT,
                    explains_nzd=round(max(movable, 0.0), 2),
                    detail="no usable relationship between usage and temperature",
                )
            )

    gaps.sort(key=lambda g: g.explains_nzd, reverse=True)
    return gaps


def hot_water_is_evidenced(ctx: AccountContext) -> bool:
    """Did the separately-metered controlled circuit actually move?

    The difference between a targeted question and a fishing expedition. Without this,
    "has anything changed with your hot water?" is one of three guesses we rotate through;
    with it, it is a question about a reading.
    """
    shift = ctx.controlled_load_shift()
    return shift is not None and shift >= CONTROLLED_SHIFT_KWH_PER_DAY


def preferred_hypothesis(ctx: AccountContext) -> Hypothesis | None:
    """A hypothesis the *data* points at, to jump the ladder's default ordering.

    `questions._STEP_LADDER` puts hot water last, and the comment there says why: it is
    the least likely and the one people are least able to answer. That ordering is right
    when we have nothing but a step in the whole-house total.

    It is wrong when the controlled register itself moved, which is a different kind of
    evidence and the only appliance-shaped signal in this service that is not an
    inference. Returning it here lets `select` ask the question the meter is pointing at
    instead of the one that is usually right.
    """
    return Hypothesis.HOT_WATER_CHANGE if hot_water_is_evidenced(ctx) else None
