"""Gemini key rotation.

The free tier is 20 requests a day per model per project, which is seven to ten customer
questions. A pool of keys is what makes it demonstrable. The tests are about the ways a
pool quietly does nothing useful: counting a duplicated key twice, retrying a bad request
across every key, or parking a key that hit a per-minute limit for the rest of the day.
"""

from __future__ import annotations

from app.providers.keypool import (
    DAILY_COOLDOWN_S,
    MINUTE_COOLDOWN_S,
    build_pool,
    is_daily_quota_error,
    is_quota_error,
)


class Boom(Exception):
    pass


MINUTE_LIMIT = Boom("429 RESOURCE_EXHAUSTED: rate limit exceeded, retryDelay: '20s'")
DAILY_LIMIT = Boom(
    "429 RESOURCE_EXHAUSTED quota_metric: GenerateRequestsPerDayPerProjectPerModel"
)
BAD_REQUEST = Boom("400 INVALID_ARGUMENT: function declaration is missing parameters")


# ---------- assembling the pool ----------


def test_all_three_sources_are_read_in_order() -> None:
    """There is no single convention people reach for, and a rotation feature that only
    read one of them would look broken to whoever guessed differently."""
    pool = build_pool(
        primary="one",
        extras="two, three",
        numbered={"GEMINI_API_KEY_2": "four"},
    )
    assert pool.configured == 4
    # The existing single key is always first, so an .env that already has one behaves
    # exactly as it did before the pool existed.
    assert pool.keys[0].label == "GEMINI_API_KEY"
    assert pool.current().value == "one"


def test_a_duplicated_key_is_counted_once() -> None:
    """Pasting the same key into GEMINI_API_KEY and GEMINI_API_KEYS is the obvious
    mistake. A pool holding it twice reports double the capacity it has and, worse,
    rotates from a key onto itself — which looks like rotation and is not."""
    pool = build_pool(primary="same", extras="same,other")
    assert pool.configured == 2
    assert [k.value for k in pool.keys] == ["same", "other"]


def test_an_empty_pool_is_not_an_error() -> None:
    """No keys means Application Default Credentials — how a deployment with a service
    account works, and how this provider behaved before the pool existed."""
    pool = build_pool()
    assert pool.configured == 0
    assert pool.current() is None


def test_blank_entries_are_ignored() -> None:
    """A commented-out or half-filled .env line must not create a key that fails on every
    request while the pool reports capacity."""
    pool = build_pool(primary="", extras=" , real , ")
    assert pool.configured == 1
    assert pool.current().value == "real"


# ---------- classifying the failure ----------


def test_a_bad_request_is_not_a_quota_error() -> None:
    """It fails identically on every key. Rotating through four of them turns one clear
    error into four confusing ones and burns the quota the pool exists to protect."""
    assert is_quota_error(BAD_REQUEST) is False


def test_a_minute_limit_and_a_daily_limit_are_told_apart() -> None:
    """Both arrive as 429 RESOURCE_EXHAUSTED; the difference is in the violation detail.

    It matters because the cooldowns differ by four orders of magnitude. Parking a
    daily-exhausted key for a minute means walking into the same wall repeatedly.
    """
    assert is_quota_error(MINUTE_LIMIT) and not is_daily_quota_error(MINUTE_LIMIT)
    assert is_quota_error(DAILY_LIMIT) and is_daily_quota_error(DAILY_LIMIT)
    assert DAILY_COOLDOWN_S > MINUTE_COOLDOWN_S * 100


# ---------- rotation ----------


def test_a_parked_key_hands_over_to_the_next() -> None:
    pool = build_pool(extras="one,two,three")
    first = pool.current()

    pool.rest(first, daily=True)
    assert pool.current() is not first
    assert pool.describe()["keys_available"] == 2
    assert pool.describe()["resting"][0]["reason"] == "daily quota exhausted"


def test_the_pool_reports_exhaustion_rather_than_looping() -> None:
    pool = build_pool(extras="one,two")
    for _ in range(2):
        pool.rest(pool.current(), daily=True)

    assert pool.current() is None
    assert pool.describe()["keys_available"] == 0


def test_a_minute_cooldown_expires_and_the_key_comes_back() -> None:
    import time

    pool = build_pool(extras="one,two")
    first = pool.current()
    pool.rest(first, daily=False)
    assert pool.current() is not first

    # Rewind the deadline rather than sleeping seventy seconds.
    first.rested_until = time.monotonic() - 1
    assert first.available


def test_the_health_view_never_carries_a_key() -> None:
    """This goes to /health, which is polled and logged. A rotation feature that printed
    credentials into a log file would be a worse problem than the quota it solves."""
    pool = build_pool(primary="AIzaSyVERYSECRET", extras="AIzaSyALSOSECRET")
    rendered = repr(pool.describe())

    assert "SECRET" not in rendered
    assert "GEMINI_API_KEY" in rendered


# ---------- the provider seam ----------


def test_the_provider_rotates_only_on_quota() -> None:
    """`_rotate` is the whole policy, so it is tested directly rather than through a
    mocked SDK — the google-genai client is not installed in every checkout."""
    from app.providers.gcp import GCPProvider

    provider = GCPProvider(model="gemini-3.5-flash", keys=build_pool(extras="one,two"))

    assert provider._rotate(BAD_REQUEST) is False, "a bad request must not burn a key"
    assert provider.keys.describe()["keys_available"] == 2

    assert provider._rotate(MINUTE_LIMIT) is True
    assert provider.keys.describe()["keys_available"] == 1

    # Last key gone: nothing left to rotate to, and the caller is told so rather than
    # being handed a key that is also resting.
    assert provider._rotate(DAILY_LIMIT) is False
    assert provider.keys.current() is None


def test_the_provider_describes_its_key_source() -> None:
    from app.providers.gcp import GCPProvider

    with_keys = GCPProvider(keys=build_pool(extras="one,two"))
    assert with_keys.describe_keys()["source"] == "api keys"
    assert with_keys.describe_keys()["keys_configured"] == 2

    adc = GCPProvider()
    assert adc.describe_keys()["keys_configured"] == 0
    assert "default credentials" in adc.describe_keys()["source"]
