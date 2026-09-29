"""Local default must use tools; an explicit benchmark override still wins."""

from __future__ import annotations

import pytest

from app import hardware


@pytest.fixture(autouse=True)
def _no_ambient_override(monkeypatch: pytest.MonkeyPatch):
    """A developer with KEA_OLLAMA_MODEL in their .env would otherwise pass every test
    for the wrong reason."""
    monkeypatch.delenv("KEA_OLLAMA_MODEL", raising=False)


def test_explicit_model_wins_over_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KEA_OLLAMA_MODEL", "qwen3:8b")
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: True)
    monkeypatch.setattr(hardware, "unified_memory_gb", lambda: 48)

    assert hardware.select_ollama_model() == "qwen3:8b"


def test_non_apple_hardware_gets_the_tool_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: False)
    assert hardware.select_ollama_model() == hardware.DEFAULT_MODEL


@pytest.mark.parametrize("memory_gb", [8, 16, 48])
def test_apple_hardware_keeps_the_tested_default(
    monkeypatch: pytest.MonkeyPatch, memory_gb: int
) -> None:
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: True)
    monkeypatch.setattr(hardware, "unified_memory_gb", lambda: memory_gb)

    assert hardware.select_ollama_model() == hardware.DEFAULT_MODEL


def test_unreadable_memory_keeps_the_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: True)
    monkeypatch.setattr(hardware, "unified_memory_gb", lambda: None)

    assert hardware.select_ollama_model() == hardware.DEFAULT_MODEL


def test_describe_reports_how_the_model_was_chosen(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hardware, "is_apple_silicon", lambda: False)
    assert hardware.describe()["model_selected_by"] == "default"

    monkeypatch.setenv("KEA_OLLAMA_MODEL", "gemma3:12b")
    assert hardware.describe()["model_selected_by"] == "KEA_OLLAMA_MODEL"
