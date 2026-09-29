"""Choose a local Ollama model that can use Sparky's household tools.

The old memory ladder selected Gemma 3, which could narrate a fact bundle but
could not call the tools used by the current agent. A larger, fluent model that
silently skips lookups is worse than a smaller one that can ground its answer.
The measured qwen3:4b build is therefore the default on every machine; an
operator can deliberately override it with KEA_OLLAMA_MODEL after testing.
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess

log = logging.getLogger(__name__)

DEFAULT_MODEL = "qwen3:4b"


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
    """Keep the tested tool-capable default unless the operator explicitly overrides it."""
    return os.getenv("KEA_OLLAMA_MODEL") or DEFAULT_MODEL


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
        "model_selected_by": "KEA_OLLAMA_MODEL" if os.getenv("KEA_OLLAMA_MODEL") else "default",
    }
