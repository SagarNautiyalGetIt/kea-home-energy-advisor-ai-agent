"""Regressions for defects found in the 18 Aug review.

Each test here corresponds to something that was actually broken, not something that
might be. The comments say what the failure looked like, because a test whose reason
is forgotten gets deleted the first time it is inconvenient.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.analytics import fixtures
from app.analytics.bundles import bundle_for as _bundle_for
from app.analytics.engine import UsageWindow
from app.config import Settings, get_provider
from app.main import app
from app.pipeline import _sentences
from app.schemas import Intent

client = TestClient(app, raise_server_exceptions=False)


# ---------- /chat/stream error parity ----------


def test_stream_404s_on_unknown_customer_like_chat_does():
    """Was a 500 with a half-open SSE stream.

    `_bundle_for` raised KeyError, but only after StreamingResponse had committed a 200
    and a text/event-stream content-type. /chat returned a clean 404 for the same input,
    so the frontend had to handle two different failures for one condition.
    """
    body = {"customer_id": "NOT-A-HOUSEHOLD", "message": "why is my bill high"}
    assert client.post("/api/chat", json=body).status_code == 404
    assert client.post("/api/chat/stream", json=body).status_code == 404


# ---------- sentence boundaries ----------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # The original split on ". " and then appended another "." to any chunk that
        # did not end in one — so an abbreviation produced "…, e.g." as a whole chunk.
        (
            "That is about $290 a year, e.g. roughly $24 a month.",
            ["That is about $290 a year, e.g. roughly $24 a month."],
        ),
        # Decimals must never be a boundary. This is the whole product's payload.
        ("You use 2.4 kWh a day.", ["You use 2.4 kWh a day."]),
        (
            "Your steady load is 2.4 kWh a day. That costs $290 a year.",
            ["Your steady load is 2.4 kWh a day.", "That costs $290 a year."],
        ),
        # Questions and exclamations end sentences too.
        (
            "Would you like the detail? I can send it.",
            ["Would you like the detail?", "I can send it."],
        ),
        ("", []),
    ],
)
def test_sentence_splitting(text, expected):
    """ADR-0003 has voice speaking sentence one while sentence two generates, so a bad
    boundary is audible, not cosmetic."""
    assert _sentences(text) == expected


# ---------- the intent with no analytics path ----------


def test_unbacked_intent_still_carries_caveats():
    """`compare_to_last_year` has no analytics path yet (KEA-69).

    It therefore hands the on-device model an empty FactBundle, and the number-checker
    cannot protect that case: "your usage was higher than last winter" carries no numeric
    token, so the check passes it and a fabricated comparison reaches the customer. The
    caveats are the only guard. When KEA-69 lands, replace them with facts — do not just
    delete them.

    Offline only. On the server this question now reaches a model holding the daily
    series, which can say what it does and does not have rather than being handed a
    bundle that says nothing.
    """
    bundle = _bundle_for(Intent.COMPARE_TO_LAST_YEAR, "H-JUL")
    assert bundle.facts == []
    assert bundle.caveats, "an empty bundle with no caveats is unguarded"
    assert "NO figures" in bundle.render_for_prompt()


def test_out_of_scope_bundle_is_also_guarded():
    bundle = _bundle_for(Intent.OUT_OF_SCOPE, "H-JUL")
    assert bundle.facts == []
    assert bundle.caveats


# ---------- provider lifetime ----------


def test_provider_is_constructed_once():
    """It owns the HTTP connection pool and the `last_usage` counter.

    Building a fresh one per request meant a new TCP connection every chat turn, and
    made token accounting per-request state that the cost projection could not sum.
    """
    assert get_provider() is get_provider()


# ---------- settings freshness ----------


def test_settings_reads_env_at_construction_not_import(monkeypatch):
    """`x: str = os.getenv(...)` in a dataclass body evaluates once, at class creation.

    Every later Settings() then returned the value the environment had at import time.
    The Day 6 bake-off (KEA-47) sets KEA_OLLAMA_MODEL per run — it would have
    benchmarked the same 4B model three times and recorded three results.
    """
    monkeypatch.setenv("KEA_OLLAMA_MODEL", "gemma3:27b")
    assert Settings().ollama_model == "gemma3:27b"

    monkeypatch.delenv("KEA_OLLAMA_MODEL", raising=False)
    assert Settings().ollama_model == "qwen3:4b"


def test_settings_default_survives_a_missing_env(monkeypatch):
    monkeypatch.delenv("KEA_PROVIDER", raising=False)
    # Changed from "ollama" in Sprint 3, then from "bedrock" to "gcp" when the Gemini
    # provider landed. A local model sized to whatever hardware happened to be present was
    # right for a laptop demo and wrong as an architecture — see app/providers/resolver.py.
    # Local is still reachable, but only by asking for it, and now only with a
    # tool-capable model: see OllamaProvider.supports_tools.
    assert Settings().provider == "gcp"
    assert os.environ.get("KEA_PROVIDER") is None


# ---------- the cached median ----------


def test_median_cache_matches_uncached_and_survives_long_series():
    """The median was being recomputed once per reading inside a comprehension.

    Quadratic: 26 us for 31 daily totals, 57 ms for one month of half-hourly intervals —
    which is exactly what Day 2's seeding turns the fixtures into.
    """
    import statistics

    for n in (1, 2, 31, 365, 48 * 31):
        w = UsageWindow("X", "P", [9.0 + (i % 7) for i in range(n)])
        assert w.median_kwh == statistics.median(w.daily_kwh)
        assert w.median_kwh is w.median_kwh  # cached, not recomputed


def test_real_july_window_median_unchanged():
    """The published analysis must not move because of a caching change."""
    import statistics

    w = fixtures.get_window("H-JUL")
    assert w.median_kwh == statistics.median(w.daily_kwh) == 9.2


# ---------- retry feedback ----------


def test_retry_prompt_names_the_rejected_tokens():
    """Attempt 2 used to be a byte-identical prompt at temperature 0.2, which mostly
    reproduces the identical failure. Whether naming the tokens lifts the pass rate is
    a golden-set question (KEA-46) — this only asserts the signal reaches the model.

    Offline path. The server's retry loop went with the number-checker; the device still
    has one, and it is the device that has no second chance to get an answer right.
    """
    from app.narration.prompts import build_user_prompt

    bundle = _bundle_for(Intent.WHY_HIGH, "H-JUL")

    first = build_user_prompt(bundle, "why is my bill high")
    assert "REJECTED" not in first

    retry = build_user_prompt(bundle, "why is my bill high", rejected=["$412", "63%"])
    assert "$412" in retry and "63%" in retry
    assert "REJECTED" in retry


def test_dotenv_never_overrides_a_real_environment_variable(tmp_path, monkeypatch):
    """`.env` fills gaps; it must never win over an exported variable.

    `.claude/launch.json` and CI both set variables explicitly. A loader that overwrote
    them would be a worse trap than the missing loader it replaced — the app would come
    up configured differently from how the operator asked, with nothing saying so.
    """
    from app.config import _load_dotenv

    monkeypatch.setenv("KEA_TEST_ALREADY_SET", "from-environment")
    monkeypatch.delenv("KEA_TEST_ONLY_IN_FILE", raising=False)

    env_file = tmp_path / ".env"
    env_file.write_text(
        "# a comment\n"
        "\n"
        "KEA_TEST_ALREADY_SET=from-file\n"
        "KEA_TEST_ONLY_IN_FILE=from-file\n"
        'KEA_TEST_QUOTED="quoted value"\n'
        "MALFORMED-NO-EQUALS\n"
    )
    monkeypatch.setattr(
        "app.config.pathlib.Path.resolve",
        lambda self: tmp_path / "services" / "api" / "app" / "config.py",
    )

    _load_dotenv()

    assert os.environ["KEA_TEST_ALREADY_SET"] == "from-environment"
    assert os.environ["KEA_TEST_ONLY_IN_FILE"] == "from-file"
    assert os.environ["KEA_TEST_QUOTED"] == "quoted value"


def test_dotenv_is_absent_without_a_file(tmp_path, monkeypatch):
    """A missing .env is the normal state on a fresh clone — it must not raise."""
    from app.config import _load_dotenv

    monkeypatch.setattr(
        "app.config.pathlib.Path.resolve",
        lambda self: tmp_path / "services" / "api" / "app" / "config.py",
    )
    _load_dotenv()  # no file at tmp_path/.env
