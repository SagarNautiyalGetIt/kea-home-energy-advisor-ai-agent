"""The model ladder — `app.hardware`.

Runs on Linux in CI, so every Apple Silicon path here is exercised through monkeypatch
rather than by asking the machine. That is the point: the interesting cases are the
demo machines, and CI is neither of them.

The load-bearing test is `test_explicit_model_wins_over_detection`. The Day 6 bake-off
sets `KEA_OLLAMA_MODEL` per run to benchmark different models; a detector that
overrode it would return three copies of one result and nobody would notice until the
numbers were already in the deck.
"""

from __future__ import annotations

import pytest

from app import hardware


@pytest.fixture(autouse=True)
def _no_ambient_override(monkeypatch: pytest.MonkeyPatch):
    """A developer with KEA_OLLAMA_MODEL in their .env would otherwise pass every test
    for the wrong reason."""
    monkeypatch.delenv("KEA_OLLAMA_MODEL", raising=False)


def test_explicit_model_wins_over_detection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KEA_OLLAMA_MODEL", "qwen3:4b")
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: True)
    monkeypatch.setattr(hardware, "unified_memory_gb", lambda: 48)

    assert hardware.select_ollama_model() == "qwen3:4b"


def test_non_apple_hardware_gets_the_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    """Memory is not unified off Apple Silicon, so system RAM says nothing about what
    fits on the GPU. A 32 GB Linux laptop selecting a 27B would run it on the CPU."""
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: False)
    assert hardware.select_ollama_model() == hardware.DEFAULT_MODEL


@pytest.mark.parametrize(
    ("memory_gb", "expected"),
    [
        (48, "gemma3:27b"),  # MacBook Pro M4 — the demo machine
        (36, "gemma3:27b"),
        (32, "gemma3:27b"),  # exactly on the threshold
        (24, "gemma3:12b"),
        (16, "gemma3:12b"),  # Mac mini M5 — the backup machine
        (8, "gemma3:4b"),
    ],
)
def test_the_ladder_picks_by_unified_memory(
    monkeypatch: pytest.MonkeyPatch, memory_gb: int, expected: str
) -> None:
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: True)
    monkeypatch.setattr(hardware, "unified_memory_gb", lambda: memory_gb)

    assert hardware.select_ollama_model() == expected


def test_unreadable_memory_falls_to_the_floor_not_the_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The direction of this failure is the whole point.

    Guessing large on a machine we could not measure starts a 17 GB model on a box
    that may have 8 GB. It does not error — macOS swaps, and the answer arrives in 40
    seconds instead of 4, which on a demo night is indistinguishable from a hang.
    """
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: True)
    monkeypatch.setattr(hardware, "unified_memory_gb", lambda: None)

    assert hardware.select_ollama_model() == hardware.DEFAULT_MODEL


def test_the_ladder_is_ordered_high_to_low() -> None:
    """`select_ollama_model` takes the first row that fits, so an out-of-order ladder
    would silently hand a 48 GB machine the 4B floor."""
    thresholds = [minimum for minimum, _ in hardware.APPLE_SILICON_LADDER]
    assert thresholds == sorted(thresholds, reverse=True)
    assert thresholds[-1] == 0, "the ladder needs a catch-all row or it can fall through"


def test_describe_reports_how_the_model_was_chosen(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: False)
    assert hardware.describe()["model_selected_by"] == "autodetect"

    monkeypatch.setenv("KEA_OLLAMA_MODEL", "gemma3:12b")
    assert hardware.describe()["model_selected_by"] == "KEA_OLLAMA_MODEL"
