"""Which model this machine should run, decided from the machine.

## Why this exists

The team develops on three very different boxes: a MacBook Pro M4 with 48 GB of
unified memory (the demo machine), a Mac mini M5 with 16 GB (the backup), and assorted
Linux laptops. A single hardcoded `gemma3:4b` served the smallest of those and wasted
the largest — and the largest is the one the pitch is delivered on.

ADR-0005 is careful about *when* a bigger model earns its place, and its answer was
"not as a second fast model on the voice path". This is the other case that ADR left
open: **one model, sized to the machine.** Narration quality is the whole of layer 2's
job, and a 27B writes a noticeably better sentence than a 4B about the same fact
bundle. It cannot be more *correct* — layer 1 computed the figures and layer 3 checks
them either way — but it hedges better and repeats itself less.

## Why memory and not core count

Token generation on Apple Silicon is **memory-bandwidth-bound**, and the binding
constraint on which model fits at all is unified memory. A q4 quantisation needs
roughly 0.6 GB per billion parameters plus context, so the arithmetic is:

    gemma3:27b   ~17 GB    needs 32 GB+ to leave room for everything else
    gemma3:12b    ~8 GB    comfortable on 16 GB
    gemma3:4b     ~3 GB    the floor, and what CI runs

The headroom matters more than it looks. macOS will happily start a model that leaves
nothing for the OS, then swap — and a swapping model does not fail, it just answers in
40 seconds instead of 4. On a demo night that is indistinguishable from a hang.

## Non-Apple hardware is deliberately left alone

On Linux and Windows the same reasoning does not hold: memory is not unified, so
system RAM says nothing about what fits on the GPU, and this laptop's 32 GB would
select a 27B that has to run on the CPU. The floor is the honest answer there, and
`KEA_OLLAMA_MODEL` remains available for anyone who knows better than the default.

Every choice here is overridable. `KEA_OLLAMA_MODEL` wins over everything, because the
Day 6 bake-off pins a specific model per run and autodetection would silently corrupt
those results.
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess

log = logging.getLogger(__name__)

#: The floor. What CI runs, what a Linux box gets, and what any machine gets when the
#: detection cannot answer confidently.
DEFAULT_MODEL = "gemma3:4b"

#: (minimum unified memory in GB, model). Highest first — the first row that fits wins.
#: Thresholds are the model's resident size plus enough headroom that macOS is not
#: choosing between the model and the window server.
APPLE_SILICON_LADDER: tuple[tuple[int, str], ...] = (
    (32, "gemma3:27b"),
    (16, "gemma3:12b"),
    (0, DEFAULT_MODEL),
)


def is_apple_silicon() -> bool:
    """True on an arm64 Mac. `platform.machine()` reports the *interpreter's* arch, so
    a Python running under Rosetta reports x86_64 and gets the floor — which is the
    right answer anyway, since that interpreter is emulated."""
    return platform.system() == "Darwin" and platform.machine() == "arm64"


def unified_memory_gb() -> int | None:
    """Physical memory in GB, or None if it cannot be read.

    `sysctl hw.memsize` rather than `psutil`, to avoid a dependency for one number on
    one platform. None is a real answer and the caller must treat it as "assume the
    floor" — guessing large on an unknown machine is the failure that swaps.
    """
    try:
        out = subprocess.run(
            ["sysctl", "-n", "hw.memsize"],
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
        return int(out.stdout.strip()) // (1024**3)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        log.debug("could not read hw.memsize: %s", exc)
        return None


def select_ollama_model() -> str:
    """The model to narrate with on this machine.

    Order of precedence, and it matters:

    1. ``KEA_OLLAMA_MODEL`` — an explicit choice always wins. The bake-off sets it per
       run, and a detector that overrode it would turn three benchmark results into
       three copies of the same one.
    2. Apple Silicon + enough unified memory — climb the ladder.
    3. Otherwise the floor.
    """
    explicit = os.getenv("KEA_OLLAMA_MODEL")
    if explicit:
        return explicit

    if not is_apple_silicon():
        return DEFAULT_MODEL

    memory = unified_memory_gb()
    if memory is None:
        log.warning(
            "Apple Silicon detected but hw.memsize was unreadable; using %s. "
            "Set KEA_OLLAMA_MODEL to override.",
            DEFAULT_MODEL,
        )
        return DEFAULT_MODEL

    for minimum, model in APPLE_SILICON_LADDER:
        if memory >= minimum:
            log.info(
                "Apple Silicon with %d GB unified memory — narrating with %s "
                "(override with KEA_OLLAMA_MODEL)",
                memory,
                model,
            )
            return model

    return DEFAULT_MODEL


def describe() -> dict[str, object]:
    """What the detector saw, for `/health`.

    Surfaced rather than logged once at startup for the same reason the recorder and
    the data source are: "which model is actually answering" should be checkable
    before a rehearsal, not inferred from a log line that scrolled past an hour ago.
    """
    apple = is_apple_silicon()
    return {
        "platform": platform.system(),
        "arch": platform.machine(),
        "apple_silicon": apple,
        "unified_memory_gb": unified_memory_gb() if apple else None,
        "model_selected_by": "KEA_OLLAMA_MODEL" if os.getenv("KEA_OLLAMA_MODEL") else "autodetect",
    }
