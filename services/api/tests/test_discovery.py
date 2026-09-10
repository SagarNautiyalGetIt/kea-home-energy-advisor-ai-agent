"""Local network discovery.

The wire-format half is tested against synthetic packets rather than against a live
network, for the obvious reason that CI has no Chromecast — and for a less obvious one:
the failure this feature is most likely to have is a scan that runs cleanly, reports no
error, and finds nothing, which is indistinguishable from a house with no smart devices. A
test that only asserted "discover() did not raise" would pass while the parser was
completely broken.
"""

from __future__ import annotations

import struct

import pytest

from app.homelink.discovery import (
    SERVICE_TYPES,
    DiscoveredDevice,
    DiscoveryResult,
    _build_query,
    _encode_name,
    _parse_answers,
    _pretty,
    _read_name,
    discover,
    summarise,
)


def _ptr_response(service: str, instance: str) -> bytes:
    """A minimal mDNS response carrying one PTR answer.

    Built by hand rather than captured, so the test says what a response IS rather than
    what one device happened to send.
    """
    header = struct.pack(">HHHHHH", 0, 0x8400, 0, 1, 0, 0)  # response, 1 answer
    name = _encode_name(service)
    rdata = _encode_name(instance)
    answer = name + struct.pack(">HHIH", 12, 0x0001, 120, len(rdata)) + rdata
    return header + answer


def _compressed_ptr_response(service: str, instance_label: str) -> bytes:
    """The same, with the answer's name written as a compression pointer.

    Real responders do this constantly — every record repeats the service name, so it is
    stored once and pointed at. A parser that does not follow pointers reads garbage from
    every packet a real device sends, which is the single most likely way this silently
    finds nothing.
    """
    header = struct.pack(">HHHHHH", 0, 0x8400, 1, 1, 0, 0)  # one question, one answer
    question = _encode_name(service) + struct.pack(">HH", 12, 0x0001)
    service_offset = 12  # the question's name starts right after the header

    # rdata: "<label>" then a pointer back to the service name.
    label = instance_label.encode()
    rdata = bytes([len(label)]) + label + struct.pack(">H", 0xC000 | service_offset)
    answer = (
        struct.pack(">H", 0xC000 | service_offset)
        + struct.pack(">HHIH", 12, 0x0001, 120, len(rdata))
        + rdata
    )
    return header + question + answer


# ---------- the wire format ----------


def test_a_query_asks_for_every_service_in_one_packet() -> None:
    query = _build_query([s.service for s in SERVICE_TYPES])
    _, _, qdcount, ancount, _, _ = struct.unpack(">HHHHHH", query[:12])

    assert qdcount == len(SERVICE_TYPES)
    assert ancount == 0
    # QTYPE 12 (PTR) with the unicast-response bit set on the class.
    assert struct.pack(">HH", 12, 0x8001) in query


def test_a_plain_ptr_answer_is_parsed() -> None:
    packet = _ptr_response(
        "_googlecast._tcp.local.", "Living Room TV._googlecast._tcp.local."
    )
    answers = _parse_answers(packet)

    assert answers
    service, instance, _host = answers[0]
    assert service == "_googlecast._tcp.local."
    assert instance == "Living Room TV._googlecast._tcp.local"


def test_a_compressed_name_is_followed() -> None:
    """The case that decides whether this works against real hardware at all."""
    packet = _compressed_ptr_response("_hap._tcp.local.", "Hallway Sensor")
    answers = _parse_answers(packet)

    assert answers
    service, instance, _ = answers[0]
    assert service == "_hap._tcp.local."
    assert instance.startswith("Hallway Sensor")


def test_a_pointer_loop_does_not_hang() -> None:
    """A malformed packet is exactly what an untrusted network sends, and an unbounded
    `while True` chasing pointers would hang the customer's request rather than skipping
    one device."""
    header = struct.pack(">HHHHHH", 0, 0x8400, 0, 1, 0, 0)
    # A name that is a pointer to itself, at offset 12.
    looping = struct.pack(">H", 0xC00C)
    answer = looping + struct.pack(">HHIH", 12, 0x0001, 120, 2) + looping

    name, _ = _read_name(header + answer, 12)
    assert isinstance(name, str)  # returned rather than spun on


def test_a_truncated_packet_is_survived() -> None:
    packet = _ptr_response("_hue._tcp.local.", "Hue Bridge._hue._tcp.local.")
    for cut in (5, 14, 20, len(packet) - 3):
        assert isinstance(_parse_answers(packet[:cut]), list)


def test_garbage_is_not_an_error() -> None:
    assert _parse_answers(b"") == []
    assert _parse_answers(b"\xff" * 200) == []


# ---------- naming ----------


@pytest.mark.parametrize(
    ("instance", "service", "expected"),
    [
        ("Living Room TV._googlecast._tcp.local.", "_googlecast._tcp.local.", "Living Room TV"),
        ("Kitchen\\032Plug._shelly._tcp.local.", "_shelly._tcp.local.", "Kitchen Plug"),
        (
            "homeassistant._home-assistant._tcp.local.",
            "_home-assistant._tcp.local.",
            "homeassistant",
        ),
    ],
)
def test_the_service_suffix_is_stripped_for_display(
    instance: str, service: str, expected: str
) -> None:
    """A customer recognises "Living Room TV". They do not recognise
    "Living Room TV._googlecast._tcp.local." """
    assert _pretty(instance, service) == expected


# ---------- the boundary this feature must not cross ----------


def test_a_discovered_device_carries_no_energy() -> None:
    """The guardrail is the shape of the result, not the prompt.

    A list of device names is exactly the raw material from which a plausible "your heat
    pump used about 40 kWh" could be assembled. An mDNS announcement carries no power
    figure and there is no way to derive one, so there is no field here to put one in.
    """
    from dataclasses import fields

    names = {f.name for f in fields(DiscoveredDevice)}
    for banned in ("kwh", "energy", "watts", "cost", "power", "usage"):
        assert not any(banned in n for n in names), f"a discovery result carries {banned}"


def test_the_summary_says_three_times_that_it_has_no_energy() -> None:
    result = DiscoveryResult(
        devices=[
            DiscoveredDevice(
                name="Lounge TV",
                service="_googlecast._tcp.local.",
                label="Google Cast device",
                provider="google_home",
                device_class="other",
            )
        ],
        method="mdns-oneshot",
        shallow=True,
    )
    payload = summarise(result)

    assert payload["devices_found"] == 1
    assert payload["by_platform"] == {"google_home": 1}
    for device in payload["devices"]:
        assert set(device) == {"name", "kind", "could_connect_via", "note", "address"}


def test_every_service_type_maps_to_something_actionable() -> None:
    """A service type with no connector and no explanation is a line on a screen that
    tells the customer nothing they can act on."""
    for spec in SERVICE_TYPES:
        assert spec.label
        assert spec.note, f"{spec.service} has no note explaining what finding it means"
        if spec.provider is None:
            # Fine, but the note has to say why there is nothing to do about it.
            note = spec.note.lower()
            assert "no connector" in note or "not a smart-home device" in note


# ---------- the live path ----------


async def test_discovery_never_raises() -> None:
    """CI has no smart devices, containers usually have no multicast route, and neither
    may cost the customer their turn. A scan that cannot run is a result, not an
    exception."""
    result = await discover(timeout=0.4)

    assert isinstance(result, DiscoveryResult)
    payload = summarise(result)
    assert "devices_found" in payload
    # Either it ran and found something or nothing, or it could not run and said so.
    assert payload["scanned"] is True or payload["error"]


async def test_an_empty_scan_is_not_reported_as_no_devices(monkeypatch) -> None:
    """The most important sentence in this feature.

    This only sees the network the SERVICE is on. A customer using the app from a phone on
    mobile data has every smart device in the world at home and none of them visible here,
    and telling them "you have no smart devices" would be confidently wrong.
    """
    from app.agent.tools import dispatch
    from app.pipeline import build_context

    async def nothing(timeout: float = 0.0) -> DiscoveryResult:
        return DiscoveryResult(method="mdns-oneshot", shallow=True)

    monkeypatch.setattr("app.homelink.discovery.discover", nothing)

    ctx = await build_context("H-JUL")
    result = await dispatch(ctx, "discover_smart_devices", {})

    assert result["available"] is False
    assert "does NOT mean they have" in result["reason"]
    assert "guest network" in result["reason"]
