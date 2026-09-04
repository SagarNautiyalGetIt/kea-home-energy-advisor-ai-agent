"""Talking to the platforms. One protocol, several very different realities.

Every connector returns `DeviceObservation` and nothing else, so `insights.py` and
everything above it is written once. Below that line the four platforms have almost
nothing in common, and the differences are not incidental — one of them determines the
shape of the whole feature.

## Apple HomeKit has no cloud API, and that is the design constraint worth planning around

This is the thing most integration plans get wrong. HomeKit accessory state lives on the
user's devices and in an end-to-end-encrypted iCloud container. Apple publishes no
server-side API, no OAuth flow and no webhook — by design, not by omission. There is no
credential we could hold that would let this backend read a HomeKit home, and any plan
that assumes otherwise is planning a service that cannot be built.

So the HomeKit integration is **inverted**: the iOS app reads HomeKit locally through the
`HomeKit` framework, aggregates to daily totals *on the phone*, and posts the result to
`POST /api/homelink/observations`. The backend is a sink, never a client.

Three consequences, all of them good:

* **The raw event stream never leaves the device.** Minute-level accessory state is the
  most intrusive data in this whole system, and under this design we never hold it. That
  is a stronger privacy position than any consent screen, and it is free.
* **It works the same way the offline model does.** Both are "the phone computes, the
  server stores facts", so they share the mobile architecture rather than each having
  their own.
* **It only works when the app is installed.** Web-only customers cannot connect HomeKit.
  Say so on the connect screen rather than showing a button that fails.

Google Home and SmartThings are ordinary cloud-to-cloud OAuth and work the way people
expect. Matter runs through a local controller the customer already owns. The
asymmetry is the point of writing it down.

## What every connector must do before returning

**Aggregate to a day.** `DeviceObservation` has no field finer than a day, so a connector
that pulls minute-level state must reduce it before constructing one. That is enforced by
the schema rather than by a rule someone has to remember.

**Set `confidence` honestly.** A device with its own energy meter is `MEASURED`. Runtime
plus a nameplate rating is `RATED` and will be worded as an estimate everywhere it
appears. Anything else is `INFERRED` and will never become a dollar figure. Marking a
guess as a measurement is the one failure in this package that reaches a customer as a
confident wrong number.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Protocol

from app.homelink.schemas import (
    Confidence,
    Connection,
    DeviceClass,
    DeviceObservation,
    Provider,
)

log = logging.getLogger(__name__)

#: OAuth scopes we ask for, per provider. Deliberately read-only and deliberately narrow.
#:
#: Kea has no reason to *control* a customer's devices — the product explains bills, it
#: does not run heat pumps — and asking for write access would be asking for a permission
#: we cannot justify on a consent screen. It would also make us liable for a house that
#: got cold overnight. Read-only is both the correct scope and the easier conversation.
PROVIDER_SCOPES: dict[Provider, list[str]] = {
    Provider.GOOGLE_HOME: ["https://www.googleapis.com/auth/sdm.service"],
    Provider.SMARTTHINGS: ["r:devices:*", "r:deviceprofiles:*"],
    Provider.MATTER: ["local:read"],
    # Nothing to request. The customer grants access to the app in iOS Settings, on the
    # phone, and this backend never holds a credential at all.
    Provider.HOMEKIT: [],
    Provider.MOCK: [],
}

#: Which providers may be offered without a mobile app. HomeKit cannot: there is nothing
#: for a browser to connect to, and a connect button that cannot work is worse than an
#: explanation of why it is not there.
WEB_CONNECTABLE: frozenset[Provider] = frozenset(
    {Provider.GOOGLE_HOME, Provider.SMARTTHINGS, Provider.MATTER, Provider.MOCK}
)


class Connector(Protocol):
    provider: Provider

    def authorize_url(self, account_ref: str, redirect_uri: str) -> str | None:
        """Where to send the customer to grant access, or None if there is no such place.

        None is HomeKit's answer and is a real one, not a stub — see the module docstring.
        """
        ...

    async def fetch(
        self, connection: Connection, since: dt.date, until: dt.date
    ) -> list[DeviceObservation]:
        """Daily observations for the window. Aggregated before it returns."""
        ...


class HomeKitConnector:
    """A sink, not a client. The iOS app pushes; this backend never pulls.

    `fetch` returns nothing and that is correct behaviour rather than an unimplemented
    method — there is no endpoint on Apple's side to call. Observations arrive at
    `POST /api/homelink/observations`, signed by the customer's session, and are stored
    the same way every other provider's are.

    Raising NotImplementedError here instead would push a `if provider is HOMEKIT` branch
    into the sync scheduler, which is the wrong place to encode a fact about Apple's API
    surface.
    """

    provider = Provider.HOMEKIT

    def authorize_url(self, account_ref: str, redirect_uri: str) -> str | None:
        return None

    async def fetch(
        self, connection: Connection, since: dt.date, until: dt.date
    ) -> list[DeviceObservation]:
        log.debug("homekit is push-only; nothing to pull for %s", connection.account_ref)
        return []


class GoogleHomeConnector:
    """Google Device Access (Smart Device Management). Cloud-to-cloud OAuth.

    Two things to know before finishing this:

    * **Device Access charges a one-off registration fee per project.** It is not free
      like the rest of this stack, and that has to be a deliberate decision rather than a
      surprise at integration time.
    * **The SDM API reports device *state*, not energy.** A thermostat says what it is
      doing, not what it is drawing. So Google Home devices are `RATED` at best — runtime
      derived from state transitions, multiplied by a nameplate figure the customer
      supplies or we look up by model. Every figure from this provider is an estimate and
      is worded as one.
    """

    provider = Provider.GOOGLE_HOME

    def __init__(self, client_id: str = "", project_id: str = "") -> None:
        self._client_id = client_id
        self._project_id = project_id

    def authorize_url(self, account_ref: str, redirect_uri: str) -> str | None:
        if not (self._client_id and self._project_id):
            return None
        scopes = "+".join(PROVIDER_SCOPES[self.provider])
        return (
            f"https://nestservices.google.com/partnerconnections/{self._project_id}/auth"
            f"?redirect_uri={redirect_uri}&access_type=offline&prompt=consent"
            f"&client_id={self._client_id}&response_type=code&scope={scopes}"
            # `state` carries the household so the callback knows whose connection this
            # is without trusting anything in the redirect.
            f"&state={account_ref}"
        )

    async def fetch(
        self, connection: Connection, since: dt.date, until: dt.date
    ) -> list[DeviceObservation]:
        raise NotImplementedError(
            "Google Device Access integration is not wired. Needs a registered project "
            "(one-off fee), an OAuth client, and a token store. See "
            "docs/adr/0009-smart-home-integration.md for the sequencing."
        )


class MatterConnector:
    """Matter over a local controller the customer already owns.

    The most interesting of the four for this product's actual customers, and the one an
    integration plan usually puts last. Matter is local, open, and vendor-neutral; a
    household running Home Assistant already has every device normalised and a long-term
    statistics database with per-device energy in it.

    That makes it the **only provider that can reach `MEASURED` confidence for free**, and
    measured energy is what lets an answer say "your heat pump used 41 kWh" rather than
    "about 41 kWh, probably less". For a product whose entire claim is that figures are
    real, the provider that supplies real figures is the one to build first.
    """

    provider = Provider.MATTER

    def __init__(self, controller_url: str = "") -> None:
        self._controller_url = controller_url

    def authorize_url(self, account_ref: str, redirect_uri: str) -> str | None:
        # A long-lived token generated by the customer in their own controller. There is
        # no hosted consent screen because there is no vendor cloud in the path — which
        # is the whole appeal.
        return None

    async def fetch(
        self, connection: Connection, since: dt.date, until: dt.date
    ) -> list[DeviceObservation]:
        raise NotImplementedError(
            "Matter/Home Assistant integration is not wired. Reads the controller's "
            "long-term statistics API for per-device energy. See "
            "docs/adr/0009-smart-home-integration.md."
        )


class SmartThingsConnector:
    """Samsung SmartThings. Ordinary OAuth, and the widest device coverage in NZ retail."""

    provider = Provider.SMARTTHINGS

    def __init__(self, client_id: str = "") -> None:
        self._client_id = client_id

    def authorize_url(self, account_ref: str, redirect_uri: str) -> str | None:
        if not self._client_id:
            return None
        scopes = "+".join(PROVIDER_SCOPES[self.provider])
        return (
            "https://api.smartthings.com/oauth/authorize"
            f"?client_id={self._client_id}&response_type=code&scope={scopes}"
            f"&redirect_uri={redirect_uri}&state={account_ref}"
        )

    async def fetch(
        self, connection: Connection, since: dt.date, until: dt.date
    ) -> list[DeviceObservation]:
        raise NotImplementedError(
            "SmartThings integration is not wired. See "
            "docs/adr/0009-smart-home-integration.md."
        )


class MockConnector:
    """A connected home for the demo, and the fixture the tests run against.

    Shaped to make the feature's actual finding visible: a hot water cylinder running to
    an overnight schedule nobody set, at `MEASURED` confidence, plus a heat pump that
    reports runtime but not energy so the `RATED` estimate wording is exercised, plus a
    fridge that is always on and correctly produces no finding because nobody can act on
    a working fridge.

    Never reachable in a deployment — `build_registry` only includes it when explicitly
    enabled, and `/health` reports when it is.
    """

    provider = Provider.MOCK

    def authorize_url(self, account_ref: str, redirect_uri: str) -> str | None:
        return f"{redirect_uri}?code=mock&state={account_ref}"

    async def fetch(
        self, connection: Connection, since: dt.date, until: dt.date
    ) -> list[DeviceObservation]:
        days = (until - since).days + 1
        out: list[DeviceObservation] = []
        for offset in range(max(0, days)):
            day = since + dt.timedelta(days=offset)
            out.append(
                DeviceObservation(
                    device_id="hw-cylinder",
                    provider=self.provider,
                    device_class=DeviceClass.WATER_HEATING,
                    label="hot water cylinder",
                    day=day,
                    runtime_minutes=310,
                    energy_kwh=6.2,
                    confidence=Confidence.MEASURED,
                    always_on=True,
                )
            )
            out.append(
                DeviceObservation(
                    device_id="lounge-heatpump",
                    provider=self.provider,
                    device_class=DeviceClass.SPACE_HEATING,
                    label="lounge heat pump",
                    day=day,
                    runtime_minutes=195,
                    rated_watts=1400,
                    confidence=Confidence.RATED,
                    always_on=False,
                )
            )
            out.append(
                DeviceObservation(
                    device_id="kitchen-fridge",
                    provider=self.provider,
                    device_class=DeviceClass.KITCHEN,
                    label="fridge",
                    day=day,
                    runtime_minutes=1440,
                    rated_watts=90,
                    confidence=Confidence.RATED,
                    always_on=True,
                )
            )
        return out


class ConnectorRegistry:
    """Provider -> connector. The only place one is constructed."""

    def __init__(self, connectors: dict[Provider, Connector]) -> None:
        self._connectors = connectors

    def get(self, provider: Provider) -> Connector | None:
        return self._connectors.get(provider)

    def available(self) -> list[Provider]:
        return list(self._connectors)

    def describe(self) -> dict[str, bool]:
        """Which providers are configured well enough to offer a connect flow.

        `False` means present but not credentialled — the connect screen must grey it out
        rather than offering a button that dead-ends on a missing client id.
        """
        return {
            provider.value: connector.authorize_url("probe", "https://example.invalid")
            is not None
            or provider is Provider.HOMEKIT
            for provider, connector in self._connectors.items()
        }


def build_registry(
    *,
    google_client_id: str = "",
    google_project_id: str = "",
    smartthings_client_id: str = "",
    matter_controller_url: str = "",
    enable_mock: bool = False,
) -> ConnectorRegistry:
    connectors: dict[Provider, Connector] = {
        Provider.HOMEKIT: HomeKitConnector(),
        Provider.GOOGLE_HOME: GoogleHomeConnector(
            client_id=google_client_id, project_id=google_project_id
        ),
        Provider.MATTER: MatterConnector(controller_url=matter_controller_url),
        Provider.SMARTTHINGS: SmartThingsConnector(client_id=smartthings_client_id),
    }
    if enable_mock:
        # Behind a flag rather than behind a `if not production` check: this connector
        # returns invented device data, and invented data reaching a customer is the
        # failure this whole repository is organised against.
        connectors[Provider.MOCK] = MockConnector()
    return ConnectorRegistry(connectors)
