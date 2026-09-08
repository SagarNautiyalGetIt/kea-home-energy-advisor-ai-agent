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
from app.analytics.bundles import bundle_for as _bundle_for
from app.analytics.bundles import bundle_from_context
from app.analytics.repository import (
    CompositeRepository,
    DatabaseRepository,
    FixtureRepository,
    MartRepository,
    UsageContext,
    build_repository,
)
from app.config import get_repository
from app.main import app
from app.schemas import Intent


@pytest.fixture(autouse=True)
def _reset_repository_cache():
    get_repository.cache_clear()
    yield
    get_repository.cache_clear()


def test_build_repository_honours_the_flag() -> None:
    """With a database, both sources are live: the five demo households in `public.*`
    and Harvey's nine fixture accounts in `kea.*`. One login page serves all fourteen,
    so the composite is what `persist` now selects."""
    assert isinstance(build_repository(use_database=False), FixtureRepository)
    assert isinstance(build_repository(use_database=True), CompositeRepository)


def test_every_repository_satisfies_the_same_interface() -> None:
    """Structural, so a method added to one is not forgotten on the others."""
    for repo in (FixtureRepository, DatabaseRepository, MartRepository, CompositeRepository):
        for name in ("name", "all_ids", "context"):
            assert hasattr(repo, name), f"{repo.__name__} is missing {name}"


def test_the_composite_prefers_demo_households_over_mart_accounts() -> None:
    """Order is not cosmetic. The rehearsed demo lines run against the five hand-shaped
    households, so an id collision has to resolve to the household the script expects
    rather than to a fixture account that happens to share it."""
    sources = CompositeRepository()._sources
    assert isinstance(sources[0], DatabaseRepository)
    assert isinstance(sources[1], MartRepository)


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


def test_observed_heating_demand_uses_the_same_base_as_the_normals() -> None:
    """KEA-147. The bug this guards is silent, so it needs a test that is not.

    `mart_daily_usage.heating_degree_days` is base 16 — the warehouse standard, set by
    `hdd_base_c` in dbt_project.yml. `climate._NORMALS` is base 18. Reading the column
    and comparing it to the table put the two sides of every weather attribution on
    different scales, and base 16 is always the smaller number, so every winter month
    read as warmer than typical and the driver clamped to $0.00.

    Nothing crashed and no figure looked absurd. The only symptom was the assistant
    telling people it was not the weather, in June.
    """
    from app.analytics import climate

    # A day at 10.5 °C. The two conventions genuinely disagree, which is the whole risk.
    assert climate.heating_degree_day(10.5) == 7.5  # base 18
    assert climate.heating_degree_day(10.5) != round(max(16.0 - 10.5, 0.0), 2)

    # Warm enough that neither base sees heating demand: still not negative.
    assert climate.heating_degree_day(25.0) == 0.0

    # A missing weather join is a day that cannot explain a rise, not a crash.
    assert climate.heating_degree_day(None) == 0.0

    # The comparison the whole attribution rests on has to be a like-for-like one. If
    # someone reverts the repository to the warehouse column, this is what breaks:
    # a July day at the base-18 normal must read as roughly normal, not as balmy.
    auckland_july_normal = climate.normal_hdd_per_day("auckland", 7)
    temp_at_that_normal = climate.HDD_BASE_C - auckland_july_normal
    assert climate.heating_degree_day(temp_at_that_normal) == pytest.approx(
        auckland_july_normal, abs=0.01
    )
