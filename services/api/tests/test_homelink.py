"""Smart-home insights — pure, so no vendor account and no network.

The tests that matter here are the ones about what the narrator is *allowed to say*.
Getting the appliance caveat wrong in the permissive direction hands a language model
permission to name appliances in a house where it cannot identify them, which is the one
failure this whole repository is organised against.
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.homelink import connectors, insights
from app.homelink.schemas import (
    Confidence,
    Connection,
    DeviceClass,
    DeviceObservation,
    Provider,
)

DAY = dt.date(2026, 7, 14)


def observation(**overrides) -> DeviceObservation:
    base = dict(
        device_id="hw-cylinder",
        provider=Provider.MOCK,
        device_class=DeviceClass.WATER_HEATING,
        label="hot water cylinder",
        day=DAY,
        energy_kwh=6.2,
        confidence=Confidence.MEASURED,
        always_on=True,
    )
    return DeviceObservation(**{**base, **overrides})


# ───────────────────────── the atom ─────────────────────────


def test_measured_energy_is_used_directly():
    assert observation(energy_kwh=6.2).estimated_kwh == 6.2


def test_rated_energy_is_runtime_times_the_plate():
    o = observation(
        energy_kwh=None, runtime_minutes=195, rated_watts=1400, confidence=Confidence.RATED
    )
    assert o.estimated_kwh == pytest.approx(1400 * (195 / 60) / 1000, abs=1e-3)


def test_an_unquantifiable_device_returns_none_not_zero():
    """A missing figure and a zero figure mean opposite things. Collapsing them lets a
    device we cannot read shrink the attributed total, which makes the unexplained
    remainder look larger than it is."""
    assert observation(energy_kwh=None, runtime_minutes=None).estimated_kwh is None


def test_the_schema_has_nowhere_to_put_minute_level_data():
    """The privacy guarantee is structural, not a policy somebody has to remember. A
    device event stream is a record of when somebody showers and when they go to bed."""
    fields = set(DeviceObservation.model_fields)
    assert "day" in fields
    assert not fields & {"timestamp", "events", "samples", "readings", "interval"}


# ───────────────────────── summarising ─────────────────────────


def test_share_is_computed_against_the_metered_bill_not_the_device_total():
    """Dividing by the device total would make a house with one connected plug read
    "your lamp is 100% of your power" — arithmetically defensible and a lie."""
    summaries = insights.summarise(
        [observation(energy_kwh=10.0)], unit_price_nzd=0.30, total_bill_kwh=100.0
    )
    assert summaries[0].share_of_bill_pct == 10.0


def test_the_weakest_confidence_in_a_group_wins():
    """A device that measured six days and guessed one has a total that is partly a
    guess. Reporting the best of the two would launder that."""
    summaries = insights.summarise(
        [
            observation(day=DAY, confidence=Confidence.MEASURED),
            observation(
                day=DAY + dt.timedelta(days=1),
                energy_kwh=None,
                runtime_minutes=200,
                rated_watts=2000,
                confidence=Confidence.RATED,
            ),
        ],
        unit_price_nzd=0.30,
    )
    assert summaries[0].confidence is Confidence.RATED


def test_summaries_are_ordered_by_cost():
    summaries = insights.summarise(
        [
            observation(device_id="small", label="lamp", energy_kwh=0.4),
            observation(device_id="big", label="cylinder", energy_kwh=9.0),
        ],
        unit_price_nzd=0.30,
        total_bill_kwh=40.0,
    )
    assert [s.device_id for s in summaries] == ["big", "small"]


# ───────────────────────── what may be said ─────────────────────────


def test_no_connected_devices_leaves_the_appliance_ban_intact():
    assert insights.appliance_caveats([]) == [insights.NO_APPLIANCE]


def test_a_household_with_devices_but_no_usable_figures_is_unchanged():
    """Connecting a provider is not the same as having data. A household in that position
    is exactly where it was before and must not be told otherwise."""
    summaries = insights.summarise(
        [observation(energy_kwh=None, runtime_minutes=None, confidence=Confidence.INFERRED)],
        unit_price_nzd=0.30,
    )
    assert insights.appliance_caveats(summaries) == [insights.NO_APPLIANCE]


def test_the_ban_is_lifted_only_for_the_devices_that_reported():
    """The load-bearing test of the whole feature. A household with one connected heat
    pump may be told about the heat pump — everything else in that house is still
    unidentifiable, and the caveat has to keep saying so."""
    summaries = insights.summarise(
        [observation(label="hot water cylinder", energy_kwh=9.0)],
        unit_price_nzd=0.30,
        total_bill_kwh=40.0,
    )
    caveats = " ".join(insights.appliance_caveats(summaries))

    assert '"hot water cylinder"' in caveats
    assert "and only these" in caveats
    # The prohibition survives for everything else.
    assert "do not name, guess or hint at one" in caveats


def test_rated_devices_are_forced_to_be_worded_as_estimates():
    """Nameplate power is a maximum. Runtime x plate is arithmetic over two real numbers
    and still an over-estimate."""
    summaries = insights.summarise(
        [
            observation(
                label="lounge heat pump",
                energy_kwh=None,
                runtime_minutes=400,
                rated_watts=2000,
                confidence=Confidence.RATED,
            )
        ],
        unit_price_nzd=0.30,
        total_bill_kwh=40.0,
    )
    caveats = " ".join(insights.appliance_caveats(summaries))
    assert "ESTIMATES" in caveats
    assert "Never present it as measured" in caveats


def test_inferred_devices_never_produce_a_figure():
    summaries = insights.summarise(
        [observation(confidence=Confidence.INFERRED)], unit_price_nzd=0.30, total_bill_kwh=40.0
    )
    assert insights.quantified(summaries) == []
    assert insights.device_facts(summaries) == []


def test_a_device_below_the_noise_floor_is_left_out():
    """True and useless. Nobody changes their behaviour over 2% of a power bill, and
    listing it crowds out the finding that matters."""
    summaries = insights.summarise(
        [observation(label="lamp", energy_kwh=0.5)], unit_price_nzd=0.30, total_bill_kwh=100.0
    )
    assert summaries[0].share_of_bill_pct == 0.5
    assert insights.quantified(summaries) == []


def test_device_facts_are_capped_so_the_model_cannot_be_invited_to_compare():
    """A bundle listing nine devices invites the model to compare them, and comparing
    them is arithmetic — the derived-claim pass would reject the result."""
    many = [
        observation(device_id=f"d{i}", label=f"device {i}", energy_kwh=10.0)
        for i in range(9)
    ]
    facts = insights.device_facts(
        insights.summarise(many, unit_price_nzd=0.30, total_bill_kwh=200.0)
    )
    assert len({f.key.split("_")[-1] for f in facts}) <= 3


def test_every_device_fact_is_a_scalar():
    """Same rule as every other bundle: no series, ever."""
    summaries = insights.summarise(
        [observation(energy_kwh=9.0)], unit_price_nzd=0.30, total_bill_kwh=40.0
    )
    for fact in insights.device_facts(summaries):
        assert isinstance(fact.value, int | float)


# ───────────────────────── the finding worth having ─────────────────────────


def test_a_schedule_is_a_finding_and_a_single_day_is_not():
    week = [
        observation(day=DAY + dt.timedelta(days=i), always_on=i < 6) for i in range(7)
    ]
    summaries = insights.summarise(week, unit_price_nzd=0.30, total_bill_kwh=100.0)
    assert insights.actionable_findings(summaries)

    once = [
        observation(day=DAY + dt.timedelta(days=i), always_on=i == 0) for i in range(7)
    ]
    assert not insights.actionable_findings(
        insights.summarise(once, unit_price_nzd=0.30, total_bill_kwh=100.0)
    )


def test_a_working_fridge_is_not_a_finding():
    """Always-on is only interesting when somebody can act on it."""
    week = [
        observation(
            device_id="fridge",
            label="fridge",
            device_class=DeviceClass.KITCHEN,
            day=DAY + dt.timedelta(days=i),
            always_on=True,
        )
        for i in range(7)
    ]
    summaries = insights.summarise(week, unit_price_nzd=0.30, total_bill_kwh=100.0)
    assert insights.always_on_findings(summaries)  # it is detected
    assert not insights.actionable_findings(summaries)  # and correctly not surfaced


# ───────────────────────── connectors ─────────────────────────


async def test_homekit_has_no_authorize_url_and_pulls_nothing():
    """Apple publishes no server-side API. The iOS app pushes daily summaries instead —
    a constraint, not a stub, and the reason the raw accessory stream never leaves the
    phone."""
    connector = connectors.HomeKitConnector()
    connection = Connection(account_ref="H-JUL", provider=Provider.HOMEKIT, status="active")

    assert connector.authorize_url("H-JUL", "https://kea.example/cb") is None
    assert await connector.fetch(connection, DAY, DAY) == []


def test_the_mock_connector_is_off_unless_asked_for():
    """It returns invented device data, and invented data reaching a customer is the
    failure this repository is organised against."""
    assert Provider.MOCK not in connectors.build_registry().available()
    assert Provider.MOCK in connectors.build_registry(enable_mock=True).available()


def test_an_uncredentialled_provider_reports_itself_as_unavailable():
    """The connect screen greys it out rather than offering a button that dead-ends."""
    described = connectors.build_registry().describe()
    assert described["google_home"] is False
    # HomeKit is always "available" — it needs no credential, only the iOS app.
    assert described["homekit"] is True


def test_no_provider_asks_for_write_access():
    """Kea explains bills; it does not run heat pumps. Asking to control devices would be
    asking for a permission we cannot justify, and would make us liable for a house that
    got cold overnight."""
    for scopes in connectors.PROVIDER_SCOPES.values():
        for scope in scopes:
            assert not scope.startswith("w:")
            assert "write" not in scope.lower()


async def test_the_mock_home_produces_the_finding_the_feature_exists_for():
    """End to end over the fixture: a cylinder on an overnight schedule, named, costed,
    and flagged as actionable — with the heat pump's estimate correctly hedged."""
    registry = connectors.build_registry(enable_mock=True)
    connector = registry.get(Provider.MOCK)
    observations = await connector.fetch(
        Connection(account_ref="H-JUL", provider=Provider.MOCK, status="active"),
        DAY,
        DAY + dt.timedelta(days=13),
    )

    summaries = insights.summarise(observations, unit_price_nzd=0.30, total_bill_kwh=300.0)
    findings = " ".join(insights.actionable_findings(summaries))
    caveats = " ".join(insights.appliance_caveats(summaries))

    assert "hot water cylinder" in findings
    assert "fridge" not in findings
    assert "ESTIMATES" in caveats and "lounge heat pump" in caveats
