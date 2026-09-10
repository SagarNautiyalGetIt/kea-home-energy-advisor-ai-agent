"""Preferences, the tier ladder, and the delivery gateways.

Everything here runs without a database, a mail server or a network. The policy layer is
pure by design — the tier decides whether a customer's phone rings, and that has to be
checkable against a table of settings rather than by sending real messages.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.alerts import render
from app.alerts.channels import (
    FileGateway,
    Notification,
    TextbeltGateway,
    TwilioVoiceGateway,
    build_registry,
)
from app.alerts.policy import CONFIDENCE_FLOORS, decide, tier_for
from app.alerts.preferences import AlertPreferences, defaults_for
from app.analytics.billshock import BillShockAssessment
from app.analytics.engine import DEFAULT_UNIT_PRICE_NZD
from app.analytics.forecast import (
    Attribution,
    CycleForecast,
    DayOfWeekMix,
    Expectation,
    ExpectationBasis,
    ForecastMethod,
    WeatherResponse,
)

CONTACTABLE = {"email": "someone@example.com", "phone_e164": "+64211234567"}


def fake_assessment(
    *,
    probabilities: dict[int, float],
    overshoot_nzd: float = 68.0,
    reasons: list[str] | None = None,
    explained: bool = True,
) -> BillShockAssessment:
    """A hand-built assessment.

    Constructed rather than computed so the policy tests state the exact probabilities
    they are about. Driving them through the real forecast would make a test of the
    escalation ladder fail whenever the regression changed, which is a different subject.
    """
    response = WeatherResponse(
        base_load_kwh_per_day=6.2,
        heating_kwh_per_hdd=0.42,
        r_squared=0.61,
        residual_sd_kwh=1.4,
        n_days=14,
        mean_hdd=9.1,
        hdd_sum_squares=42.0,
        usable=explained,
    )
    forecast = CycleForecast(
        days_elapsed=14,
        days_in_cycle=31,
        days_remaining=17,
        usage_so_far_kwh=142.0,
        cost_so_far_nzd=42.60,
        unit_price_nzd=0.30,
        projected_kwh=1040.0,
        projected_cost_nzd=312.0,
        cost_p10_nzd=288.0,
        cost_p90_nzd=336.0,
        cost_sd_nzd=18.7,
        method=ForecastMethod.WEATHER_NORMALISED if explained else ForecastMethod.STRAIGHT_LINE,
        method_detail="base load 6.2 kWh/day + 0.42 kWh per heating degree day",
        response=response,
        day_of_week=DayOfWeekMix(1.0, 1.0, False, "cycle start date unknown"),
    )
    return BillShockAssessment(
        account_ref="H-JUL",
        period="July 2026",
        forecast=forecast,
        expectation=Expectation(
            cost_nzd=244.0,
            basis=ExpectationBasis.COMPARABLE_HOMES,
            claim_rule="The comparison is against SIMILAR HOMES.",
        ),
        attribution=Attribution(
            weather_nzd=41.0 if explained else 0.0,
            behaviour_nzd=12.0 if explained else 0.0,
            everyday_load_nzd=15.0 if explained else overshoot_nzd,
            explained=explained,
        ),
        overshoot_nzd=overshoot_nzd,
        overshoot_pct=27.9,
        # No step: these tests are about the escalation ladder, and a fixture carrying a
        # step change would drag the clarifying-question path into every one of them.
        step=None,
        recent_trend_pct=12.4,
        triggered=probabilities.get(1, 0.0) >= CONFIDENCE_FLOORS[1],
        reasons=reasons if reasons is not None else ["above_expectation"],
        tier_probabilities=probabilities,
        tier_thresholds_nzd={1: 280.0, 2: 341.0, 3: 427.0},
    )


# ───────────────────────── preferences ─────────────────────────


def test_defaults_reproduce_the_old_hard_coded_ladder():
    """A preference system whose defaults change everybody's alerting is a migration,
    not a feature."""
    prefs = defaults_for("H-JUL")
    assert (prefs.tier1_pct, prefs.tier2_pct, prefs.tier3_pct) == (15.0, 40.0, 75.0)
    assert prefs.min_overshoot_nzd == 20.0


def test_a_non_monotonic_ladder_is_rejected():
    """A text at 60% and an email at 80% is not a ladder. Rejected rather than sorted,
    because silently reordering means the screen no longer describes what will happen."""
    with pytest.raises(ValueError, match="must increase"):
        AlertPreferences(account_ref="H-JUL", tier1_pct=80, tier2_pct=60, tier3_pct=90)


def test_thresholds_are_bounded():
    with pytest.raises(ValueError):
        AlertPreferences(account_ref="H-JUL", tier1_pct=1)
    with pytest.raises(ValueError):
        AlertPreferences(account_ref="H-JUL", tier3_pct=500)


def test_an_unknown_timezone_is_rejected():
    with pytest.raises(ValueError, match="unknown timezone"):
        AlertPreferences(account_ref="H-JUL", timezone="Middle/Earth")


def test_voice_is_opt_in_and_the_others_are_not():
    """An automated call is the most intrusive thing this product does and the one most
    easily mistaken for a scam."""
    prefs = defaults_for("H-JUL")
    assert prefs.email_enabled and prefs.sms_enabled
    assert not prefs.voice_enabled


def test_quiet_hours_wrap_around_midnight():
    """21:00-08:00 is two ranges on the clock and one range in a person's head. The
    obvious implementation (`start <= hour < end`) inverts the window, so the only hours
    we would text are the ones they asked us not to."""
    prefs = AlertPreferences(
        account_ref="H-JUL", quiet_hours_start=21, quiet_hours_end=8, timezone="Pacific/Auckland"
    )
    # 22:00 NZST on 15 July 2026 == 10:00 UTC.
    assert prefs.in_quiet_hours(datetime(2026, 7, 15, 10, 0, tzinfo=UTC))
    # 03:00 NZST == 15:00 UTC the previous day. Still inside.
    assert prefs.in_quiet_hours(datetime(2026, 7, 14, 15, 0, tzinfo=UTC))
    # 13:00 NZST == 01:00 UTC. Outside.
    assert not prefs.in_quiet_hours(datetime(2026, 7, 15, 1, 0, tzinfo=UTC))


def test_next_open_lands_after_the_window():
    prefs = AlertPreferences(account_ref="H-JUL", quiet_hours_start=21, quiet_hours_end=8)
    inside = datetime(2026, 7, 15, 10, 0, tzinfo=UTC)  # 22:00 NZST
    opens = prefs.next_open(inside)
    assert opens is not None
    assert opens > inside
    assert not prefs.in_quiet_hours(opens)


def test_next_open_is_none_outside_quiet_hours():
    prefs = defaults_for("H-JUL")
    assert prefs.next_open(datetime(2026, 7, 15, 1, 0, tzinfo=UTC)) is None


# ───────────────────────── the tier ladder ─────────────────────────


def test_confidence_gates_the_tier_even_when_the_overshoot_is_huge():
    """The property that makes a customer-set threshold safe to expose.

    Somebody who sets 20% across the board still cannot be rung on day four, because on
    day four no threshold has a 90% probability attached. That comes from the maths, not
    from a `if days_elapsed < 10` guard which anything constructing an assessment
    differently could bypass — and which the previous version had.
    """
    a = fake_assessment(probabilities={1: 0.99, 2: 0.95, 3: 0.62})
    tier, confidence = tier_for(a, defaults_for("H-JUL"))
    assert tier == 2
    assert confidence == 0.95


def test_nothing_fires_below_the_tier_one_floor():
    a = fake_assessment(probabilities={1: 0.40, 2: 0.10, 3: 0.01})
    assert decide(a, defaults_for("H-JUL")).tier == 0


def test_escalating_tiers_stack_rather_than_replace():
    """A tier-3 customer gets the email *and* the call. A call that goes to voicemail is
    not a substitute for the written record."""
    prefs = AlertPreferences(account_ref="H-JUL", voice_enabled=True, **CONTACTABLE)
    d = decide(fake_assessment(probabilities={1: 0.99, 2: 0.97, 3: 0.95}), prefs)
    assert d.tier == 3
    assert d.channels == ("email", "sms", "voice")


def test_a_disabled_channel_is_skipped_not_failed():
    """Recording a failed SMS when we never had a number puts 'we tried to text you' in
    a customer's record untruthfully."""
    prefs = AlertPreferences(
        account_ref="H-JUL", sms_enabled=False, email="a@example.com", phone_e164="+64211234567"
    )
    d = decide(fake_assessment(probabilities={1: 0.99, 2: 0.97, 3: 0.10}), prefs)
    assert d.tier == 2
    assert "sms" in d.channels
    assert "sms" not in d.eligible


def test_a_channel_with_no_address_is_not_eligible():
    prefs = AlertPreferences(account_ref="H-JUL", email="a@example.com", phone_e164=None)
    d = decide(fake_assessment(probabilities={1: 0.99, 2: 0.97, 3: 0.10}), prefs)
    assert d.eligible == ("email",)


def test_everything_off_suppresses_with_a_reason():
    prefs = AlertPreferences(account_ref="H-JUL", email=None, phone_e164=None)
    d = decide(fake_assessment(probabilities={1: 0.99, 2: 0.1, 3: 0.0}), prefs)
    assert d.suppressed
    assert "contact address" in (d.suppressed_because or "")


def test_the_master_switch_suppresses_everything():
    prefs = AlertPreferences(account_ref="H-JUL", enabled=False, **CONTACTABLE)
    d = decide(fake_assessment(probabilities={1: 0.99, 2: 0.99, 3: 0.99}), prefs)
    assert d.tier == 0
    assert d.suppressed


def test_hardship_suppresses_but_still_records_the_tier():
    """An automated 'you are about to spend $340' is at best useless and at worst cruel.
    The tier is still computed so the record shows we knew and chose not to send."""
    prefs = AlertPreferences(account_ref="H-JUL", **CONTACTABLE)
    d = decide(
        fake_assessment(probabilities={1: 0.99, 2: 0.97, 3: 0.10}),
        prefs,
        hardship_detected=True,
    )
    assert d.tier == 2
    assert d.suppressed
    assert d.sendable == ()
    assert "needs a person" in (d.suppressed_because or "")


def test_quiet_hours_defer_the_phone_but_never_the_email():
    """Email does not make a sound at 3am, and holding it back would delay the one
    artefact the Consumer Care Obligations expect us to be able to produce."""
    prefs = AlertPreferences(
        account_ref="H-JUL", quiet_hours_start=21, quiet_hours_end=8, **CONTACTABLE
    )
    inside = datetime(2026, 7, 15, 10, 0, tzinfo=UTC)  # 22:00 NZST
    d = decide(fake_assessment(probabilities={1: 0.99, 2: 0.97, 3: 0.10}), prefs, now=inside)

    assert "sms" in d.deferred
    assert "email" not in d.deferred
    assert d.sendable == ("email",)


# ───────────────────────── rendering ─────────────────────────


def test_the_email_carries_its_basis_disclosure():
    """An alert that leaves the app without its caveat is the regression this repo has
    already had once, on the invoice PDF.

    Asserted against the live rate rather than a pinned "30c/kWh". That literal was the
    invented illustrative rate; the price is now Kea's published Anytime Rate, and a test
    that hardcodes the number would have to be edited every time the tariff moves — which
    is exactly how a stale disclosure ends up in a customer's inbox.
    """
    a = fake_assessment(probabilities={1: 0.9, 2: 0.1, 3: 0.0})
    prefs = AlertPreferences(account_ref="H-JUL", **CONTACTABLE)
    body = render.body_for(a, decide(a, prefs))
    assert "similar homes" in body
    assert f"{DEFAULT_UNIT_PRICE_NZD * 100:.1f}c/kWh" in body
    # And it still says the daily charge is not in that figure.
    assert "daily charge" in body


def test_the_email_says_how_confident_we_are():
    a = fake_assessment(probabilities={1: 0.84, 2: 0.1, 3: 0.0})
    prefs = AlertPreferences(account_ref="H-JUL", **CONTACTABLE)
    assert "84%" in render.body_for(a, decide(a, prefs))


def test_the_email_names_the_dominant_cause_only_when_there_is_one():
    with_cause = fake_assessment(probabilities={1: 0.9, 2: 0.1, 3: 0.0}, explained=True)
    prefs = AlertPreferences(account_ref="H-JUL", **CONTACTABLE)
    assert "weather" in render.body_for(with_cause, decide(with_cause, prefs))

    without = fake_assessment(probabilities={1: 0.9, 2: 0.1, 3: 0.0}, explained=False)
    body = render.body_for(without, decide(without, prefs))
    assert "colder-than-usual" not in body


def test_the_sms_fits_a_segment_and_makes_no_comparative_claim():
    """160 characters cannot carry the basis disclosure, so the message must make no
    claim that needs one."""
    message = render.sms_for(fake_assessment(probabilities={1: 0.9, 2: 0.8, 3: 0.1}))
    assert render.sms_segments(message) <= 2
    assert "similar homes" not in message
    assert "usually pay" not in message
    assert "Kea" in message


def test_the_voice_script_identifies_itself_and_asks_for_nothing():
    """An automated call that opens with a dollar figure is indistinguishable from a
    scam, and one that asks a customer to identify themselves trains them to do it for
    the next caller, who will not be us."""
    script = render.voice_script_for(fake_assessment(probabilities={1: 0.99, 2: 0.98, 3: 0.95}))
    assert script.index("Kea Energy") < script.index("$")
    assert "never ask you for payment" in script


# ───────────────────────── gateways ─────────────────────────


async def test_the_file_gateway_writes_a_real_message_per_channel(tmp_path: Path):
    """Not a mock. For email the bytes are a valid RFC 5322 message; for SMS the file
    holds the exact payload a carrier would carry."""
    for channel, suffix in (("email", ".eml"), ("sms", ".txt"), ("voice", ".txt")):
        gateway = FileGateway(tmp_path, channel, sender="kea@example.com")
        outcome = await gateway.send(
            Notification(
                channel=channel,
                to="someone@example.com",
                subject="Heads up",
                body="Your cycle is tracking high.",
                voice_script="Hello. This is Kea Energy.",
            )
        )
        assert outcome.delivered
        written = Path(outcome.destination)
        assert written.suffix == suffix
        assert written.parent.name == channel


async def test_the_file_gateway_cannot_write_outside_the_outbox(tmp_path: Path):
    """`to` reaches a filename. Not attacker-controlled here, but it is one line and the
    failure it prevents is writing outside the outbox."""
    gateway = FileGateway(tmp_path, "sms", sender="kea@example.com")
    outcome = await gateway.send(
        Notification(channel="sms", to="../../etc/passwd", subject="s", body="b")
    )
    assert outcome.delivered
    assert tmp_path in Path(outcome.destination).parents


def test_an_unknown_backend_falls_back_to_file_rather_than_raising(tmp_path: Path):
    """A typo in an environment variable should not take the API down. It must not be
    silent either — hence the warning, and the `/health` disclosure."""
    registry = build_registry(
        outbox=tmp_path,
        email_backend="carrier-pigeon",
        sms_backend="semaphore",
        voice_backend="tin-can",
        email_from="kea@example.com",
    )
    assert registry.describe() == {"email": "file", "sms": "file", "voice": "file"}


def test_a_misconfigured_real_backend_falls_back_to_file(tmp_path: Path):
    """Twilio selected with no credentials. Falling back is right; falling back silently
    is not, which is what `describe()` on /health is for."""
    registry = build_registry(
        outbox=tmp_path,
        email_backend="file",
        sms_backend="twilio",
        voice_backend="twilio",
        email_from="kea@example.com",
    )
    assert registry.describe()["sms"] == "file"
    assert registry.describe()["voice"] == "file"


def test_textbelt_is_selectable_with_no_credentials(tmp_path: Path):
    """The one SMS path needing no account, no card and no number verification. One
    message per day is exactly enough to prove the tier-2 rung works."""
    registry = build_registry(
        outbox=tmp_path,
        email_backend="file",
        sms_backend="textbelt",
        voice_backend="file",
        email_from="kea@example.com",
    )
    gateway = registry.for_channel("sms")
    assert isinstance(gateway, TextbeltGateway)


def test_the_voice_twiml_escapes_and_speaks_new_zealand_english():
    """An unescaped `&` in a rendered figure is enough for Twilio to reject the document,
    and debugging that during a rehearsal is not how anyone should spend the morning."""
    gateway = TwilioVoiceGateway(
        account_sid="AC0", auth_token="t", from_number="+6499999999"
    )
    twiml = gateway.twiml_for("Power & heating are up <significantly>")

    assert "&amp;" in twiml
    assert "&lt;significantly&gt;" in twiml
    assert 'language="en-NZ"' in twiml
