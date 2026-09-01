"""KEA-33 — the read seam.

The load-bearing test here is `test_one_bundle_builder_serves_both_paths`. Everything
else is plumbing.

Before this change `routes.py` imported `app.analytics.fixtures` directly and the
database was decorative. The risk in fixing that is not the SQL — it is ending up with
*two* bundle builders, one per source, which drift apart quietly and surface as the demo
disagreeing with the test suite. So the fixture path and the request path are asserted to
run through the same function.

What is not covered: that `DatabaseRepository` returns the same numbers as
`FixtureRepository`. That needs a seeded PostgreSQL and is the single most important
thing to check on the MacBook — `make db && make api-migrate && make api-seed`, then
compare `/api/households` with `KEA_PERSIST=0` against `KEA_PERSIST=1`. They must agree
to the last decimal.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.analytics import fixtures
from app.analytics.repository import (
    DatabaseRepository,
    FixtureRepository,
    UsageContext,
    build_repository,
)
from app.api.routes import _bundle_for, bundle_from_context
from app.config import get_repository
from app.main import app
from app.schemas import Intent


@pytest.fixture(autouse=True)
def _reset_repository_cache():
    get_repository.cache_clear()
    yield
    get_repository.cache_clear()


def test_build_repository_honours_the_flag() -> None:
    assert isinstance(build_repository(use_database=False), FixtureRepository)
    assert isinstance(build_repository(use_database=True), DatabaseRepository)


def test_both_repositories_satisfy_the_same_interface() -> None:
    """Structural check, so a method added to one is not forgotten on the other."""
    for name in ("name", "all_ids", "context"):
        assert hasattr(FixtureRepository, name), name
        assert hasattr(DatabaseRepository, name), name


async def test_fixture_repository_lists_every_demo_household() -> None:
    assert await FixtureRepository().all_ids() == fixtures.all_ids()


@pytest.mark.parametrize("customer_id", fixtures.all_ids())
async def test_fixture_context_matches_the_fixtures_exactly(customer_id: str) -> None:
    ctx = await FixtureRepository().context(customer_id)
    hdd, normal = fixtures.heating_degree_days(customer_id)

    assert ctx.window.daily_kwh == fixtures.get_window(customer_id).daily_kwh
    assert ctx.baseline == fixtures.comparison_baseline(customer_id)
    assert ctx.label == fixtures.label(customer_id)
    assert ctx.hdd == hdd
    assert ctx.normal_hdd == normal


async def test_fixture_repository_rejects_an_unknown_household() -> None:
    """Callers turn KeyError into a 404, so the type matters as much as the message."""
    with pytest.raises(KeyError):
        await FixtureRepository().context("H-NOPE")


@pytest.mark.parametrize("customer_id", fixtures.all_ids())
@pytest.mark.parametrize(
    "intent",
    [
        Intent.WHY_HIGH,
        Intent.WHAT_WILL_I_PAY,
        Intent.USING_MORE_THAN_USUAL,
        Intent.WHAT_COSTS_MOST,
        Intent.TARIFF_CHECK,
        Intent.HARDSHIP,
        Intent.COMPARE_TO_LAST_YEAR,
        Intent.OUT_OF_SCOPE,
    ],
)
async def test_one_bundle_builder_serves_both_paths(intent: Intent, customer_id: str) -> None:
    """The request path and the fixture helper must produce identical bundles.

    This is the regression that would otherwise be invisible: two builders, one per data
    source, slowly diverging until the demo and the tests disagree about a number.
    """
    ctx = await FixtureRepository().context(customer_id)
    assert bundle_from_context(intent, customer_id, ctx) == _bundle_for(intent, customer_id)


def test_health_discloses_where_the_data_came_from() -> None:
    """"fixtures" means the database is not in the request path at all. That should be
    visible before a rehearsal, not discovered during one."""
    with TestClient(app) as client:
        body = client.get("/api/health").json()
    assert body["data_source"] == "fixtures"


def test_households_endpoint_still_serves_all_five() -> None:
    with TestClient(app) as client:
        rows = client.get("/api/households").json()
    assert [r["customer_id"] for r in rows] == fixtures.all_ids()
    assert all(len(r["daily_kwh"]) == fixtures.DAYS for r in rows)


def test_unknown_household_is_a_404_not_a_500() -> None:
    with TestClient(app) as client:
        assert client.get("/api/households/H-NOPE").status_code == 404


def test_usage_context_is_frozen() -> None:
    """Layer 1 is pure and must not be able to mutate what it was handed."""
    ctx = UsageContext(
        window=fixtures.get_window("H-JUL"), baseline=7.06, label="x", hdd=[], normal_hdd=8.1
    )
    with pytest.raises(AttributeError):
        ctx.baseline = 1.0  # type: ignore[misc]
