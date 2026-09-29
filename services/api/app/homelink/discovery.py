"""Finding the smart devices already on the customer's network.

`connectors.py` reaches a customer's devices through a vendor cloud, which needs an OAuth
flow, a registered project and — for Google — a one-off fee. That is the right long-term
integration and it is a poor first step: a household cannot see any value until after they
have signed into something.

This module is the step before it. Devices on a home network announce themselves over
mDNS, continuously, to anybody on the same LAN — it is how a phone finds a Chromecast
without being told about it. Listening for those announcements needs no account, no
credential and no vendor relationship, and it answers the question a customer actually asks
first: *do you even know what I've got?*

## What discovery is, and firmly is not

**It names devices. It does not read energy.** An mDNS announcement carries a service type,
a hostname and some text records. There is no power figure anywhere in it, and there is no
way to derive one. So the output of this module is a list of what is there, and the honest
next sentence is always "connect one of these and I can tell you what it used".

Getting that boundary wrong would be the worst failure available to this feature: a list of
device names is exactly the raw material from which a plausible "your heat pump used about
40 kWh" could be assembled, and it would be a fabrication with a device name stapled to it.
`insights.py` still governs everything that becomes a figure, and nothing here produces a
`DeviceObservation`.

## Two implementations, one interface

`zeroconf` when it is installed: it speaks the whole protocol, browses continuously, and
resolves SRV and TXT records properly.

A stdlib one-shot query when it is not, because this must work on a fresh clone with no
extra install — the demo is the point, and a feature that needs `pip install zeroconf`
first is a feature that will not be running when it matters. It sends one multicast
question per service type and parses what comes back, which finds anything that answers
promptly and misses devices that only announce on a slow cycle. That is a real limitation
and it is reported in the result rather than hidden, so a household with a quiet device is
told the scan was shallow rather than told they have nothing.

## Privacy

This runs only when the customer asks for it — there is no background scan and no schedule.
It reads announcements that every device on the network is already broadcasting to every
other device on it; it does not port-scan, probe, or connect to anything. Nothing is
persisted: the result is returned to the conversation that asked for it and then dropped.
The one thing that would change all of that is storing a device inventory per household,
which is deliberately not done here.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import struct
from contextlib import suppress
from dataclasses import dataclass, field

from app.homelink.schemas import DeviceClass, Provider

log = logging.getLogger(__name__)

MDNS_GROUP = "224.0.0.251"
MDNS_PORT = 5353

#: How long to listen. Two and a half seconds catches devices that answer promptly, which
#: is most of them — mDNS responders are supposed to reply within a second. Longer would
#: catch a few more and would also mean a customer watching a spinner in a chat window,
#: which is the wrong trade for a feature whose answer is "here is roughly what you have".
DEFAULT_TIMEOUT_S = 2.5


@dataclass(frozen=True)
class ServiceType:
    """One mDNS service, and what finding it tells us.

    `provider` is which connector could take it further, and it is the reason discovery is
    worth doing at all: "you have three Google devices, connecting Google Home would let me
    read them" is an actionable sentence, while a list of hostnames is not.
    """

    service: str
    label: str
    provider: Provider | None
    device_class: DeviceClass = DeviceClass.OTHER
    note: str = ""


#: What we ask for. Chosen for what is actually in New Zealand homes and for what maps onto
#: a connector we could then offer — not for coverage. A service type nobody here owns is a
#: question on the wire and a line in this list that nothing ever matches.
SERVICE_TYPES: tuple[ServiceType, ...] = (
    ServiceType(
        "_googlecast._tcp.local.",
        "Google Cast device",
        Provider.GOOGLE_HOME,
        note=(
            "Chromecast, Google TV, Nest speaker or display. Cast itself carries no energy "
            "data — it means this household is in the Google Home ecosystem, and Google "
            "Device Access is the connector that could reach any thermostats on it."
        ),
    ),
    ServiceType(
        "_hap._tcp.local.",
        "Apple HomeKit accessory",
        Provider.HOMEKIT,
        note=(
            "HomeKit Accessory Protocol. Note this is the accessory advertising itself on "
            "the network, not the Home hub — Apple publishes no cloud API, so the only "
            "route to this data is the iOS app reading HomeKit locally and posting daily "
            "totals."
        ),
    ),
    ServiceType(
        "_matter._tcp.local.",
        "Matter device (commissioned)",
        Provider.MATTER,
        note="Already paired to a controller. The best case — Matter can report real "
        "per-device energy.",
    ),
    ServiceType(
        "_matterc._udp.local.",
        "Matter device (awaiting setup)",
        Provider.MATTER,
        note="Advertising for commissioning — it has been powered on but not yet paired.",
    ),
    ServiceType(
        "_hue._tcp.local.",
        "Philips Hue bridge",
        Provider.MATTER,
        DeviceClass.LIGHTING,
        note="Recent bridges expose Matter, which is the route to reading them.",
    ),
    ServiceType(
        "_shelly._tcp.local.",
        "Shelly device",
        Provider.MATTER,
        note=(
            "Shelly relays and plugs meter their own energy and expose it locally. Along "
            "with Home Assistant this is the cheapest path to MEASURED confidence."
        ),
    ),
    ServiceType(
        "_tasmota._tcp.local.",
        "Tasmota device",
        Provider.MATTER,
        note="Open firmware, usually on a smart plug, and usually energy-metering.",
    ),
    ServiceType(
        "_home-assistant._tcp.local.",
        "Home Assistant",
        Provider.HOME_ASSISTANT,
        note=(
            "The single most valuable thing to find. Home Assistant already normalises "
            "every device in the house and keeps long-term per-device energy statistics, "
            "so one connection reaches everything at once."
        ),
    ),
    ServiceType(
        "_smartthings._tcp.local.",
        "SmartThings hub",
        Provider.SMARTTHINGS,
        note="Samsung's hub. Cloud OAuth from here, and the widest device coverage in NZ "
        "retail.",
    ),
    ServiceType(
        "_miio._udp.local.",
        "Xiaomi / Mi Home device",
        None,
        note="No connector for this yet — worth knowing it is there, nothing more.",
    ),
    ServiceType(
        "_workstation._tcp.local.",
        "Computer or NAS",
        None,
        note=(
            "Not a smart-home device. Reported because a NAS or a desktop left on is a "
            "real always-on load, and it is the kind of thing a household forgets about "
            "when wondering what their overnight draw is."
        ),
    ),
)

_BY_SERVICE = {s.service: s for s in SERVICE_TYPES}


@dataclass(frozen=True)
class DiscoveredDevice:
    """One thing that answered. Deliberately thin — see the module docstring.

    There is no energy field and there must not be one. An mDNS announcement carries no
    power figure and no way to derive one, and a field here would be a place for somebody
    to put an estimate.
    """

    name: str
    service: str
    label: str
    provider: str | None
    device_class: str
    note: str = ""
    host: str | None = None
    """Hostname or address, where the response carried one. Useful to a person doing the
    connecting; never shown as an identifier for the device."""


@dataclass
class DiscoveryResult:
    devices: list[DiscoveredDevice] = field(default_factory=list)
    method: str = ""
    scanned_seconds: float = 0.0
    shallow: bool = False
    """True for the stdlib one-shot scan, which finds devices that answer promptly and
    misses ones that only announce on a slow cycle. Reported rather than hidden: a
    household with a quiet device must be told the scan was shallow, not told they have
    nothing."""

    error: str | None = None

    @property
    def by_provider(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for device in self.devices:
            if device.provider:
                counts[device.provider] = counts.get(device.provider, 0) + 1
        return counts


# ---------------------------------------------------------------------------
# The stdlib path
# ---------------------------------------------------------------------------
#
# One multicast question per service type, then listen. Enough DNS to write a PTR question
# and read a PTR answer, and no more — this is not a resolver and should not grow into one.


def _encode_name(name: str) -> bytes:
    """A dotted name as DNS length-prefixed labels."""
    out = b""
    for label in name.rstrip(".").split("."):
        encoded = label.encode("utf-8")
        out += bytes([len(encoded)]) + encoded
    return out + b"\x00"


def _build_query(services: list[str]) -> bytes:
    """One query carrying every question, with the unicast-response bit set.

    All the questions in one packet rather than one packet each: it is a single send, and
    mDNS responders handle multi-question queries.

    The QU bit (0x8000 on the class) asks responders to reply directly to our ephemeral
    port rather than to the multicast group. Without it we would have to bind port 5353,
    which is usually already held by avahi or mDNSResponder on the machines this runs on —
    and a discovery feature that only works when the system's own mDNS daemon is stopped is
    a discovery feature that does not work.
    """
    header = struct.pack(
        ">HHHHHH",
        0,  # transaction id — mDNS ignores it
        0,  # flags: standard query
        len(services),
        0,
        0,
        0,
    )
    body = b""
    for service in services:
        body += _encode_name(service) + struct.pack(">HH", 12, 0x8001)  # PTR, IN + QU
    return header + body


def _read_name(data: bytes, offset: int) -> tuple[str, int]:
    """Decode a possibly-compressed DNS name. Returns the name and the offset after it.

    Compression pointers are the reason this cannot be a one-liner: a name may end with a
    two-byte pointer into an earlier part of the packet, and PTR answers use them heavily
    because every record repeats the service name.
    """
    labels: list[str] = []
    jumped = False
    end = offset
    # Bounded rather than `while True`: a packet with a pointer loop would otherwise hang
    # the request, and a malformed packet is exactly what an untrusted network sends.
    for _ in range(128):
        if offset >= len(data):
            break
        length = data[offset]
        if length == 0:
            offset += 1
            if not jumped:
                end = offset
            break
        if length & 0xC0 == 0xC0:
            if offset + 1 >= len(data):
                break
            pointer = struct.unpack(">H", data[offset : offset + 2])[0] & 0x3FFF
            if not jumped:
                end = offset + 2
            jumped = True
            offset = pointer
            continue
        offset += 1
        labels.append(data[offset : offset + length].decode("utf-8", "replace"))
        offset += length
        if not jumped:
            end = offset
    return ".".join(labels), end


def _parse_answers(data: bytes) -> list[tuple[str, str, str | None]]:
    """(service, instance name, host) for every PTR/SRV answer in one response.

    Never raises. A malformed packet from something on the network is not an error worth
    failing a customer's request over — it is one device that will not appear in the list.
    """
    out: list[tuple[str, str, str | None]] = []
    try:
        if len(data) < 12:
            return out
        _, _, qd, an, ns, ar = struct.unpack(">HHHHHH", data[:12])
        offset = 12
        for _ in range(qd):
            _, offset = _read_name(data, offset)
            offset += 4

        for _ in range(an + ns + ar):
            name, offset = _read_name(data, offset)
            if offset + 10 > len(data):
                break
            rtype, _rclass, _ttl, rdlength = struct.unpack(
                ">HHIH", data[offset : offset + 10]
            )
            offset += 10
            rdata_start = offset
            offset += rdlength

            if rtype == 12:  # PTR
                instance, _ = _read_name(data, rdata_start)
                out.append((name.rstrip(".") + ".", instance, None))
            elif rtype == 33 and rdlength > 6:  # SRV — carries the host
                host, _ = _read_name(data, rdata_start + 6)
                out.append((name.rstrip(".") + ".", name, host))
    except Exception:  # noqa: BLE001 - a bad packet is one missing device, not a failure
        log.debug("could not parse an mDNS response", exc_info=True)
    return out


def _open_socket() -> tuple[socket.socket, bool]:
    """A socket that can actually hear the answers. Returns it and whether we got port 5353.

    This is the part that decides whether the whole feature works, and the obvious version
    does not.

    The QU bit in the query asks responders to answer directly to our ephemeral port, and
    an ephemeral socket is much easier to open — port 5353 is usually already held by
    avahi or mDNSResponder. But **the QU bit is a request, not a requirement**, and plenty
    of responders ignore it and answer to the multicast group regardless. A client
    listening only on an ephemeral port never hears those, which on this machine meant a
    scan that ran cleanly, reported no error, and found nothing — the worst possible
    outcome, because it is indistinguishable from a house with no smart devices.

    So: bind 5353 with the reuse flags and join the group, which hears multicast answers
    even when something else on the machine also holds the port. Fall back to an ephemeral
    port only if that fails, where the QU bit is all we have.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    with suppress(AttributeError, OSError):
        # Not on every platform, and the bind below still works without it as long as
        # nothing else holds the port.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)

    try:
        sock.bind(("", MDNS_PORT))
        mreq = struct.pack("4sl", socket.inet_aton(MDNS_GROUP), socket.INADDR_ANY)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        sock.settimeout(0.4)
        return sock, True
    except OSError:
        log.debug("could not bind 5353; falling back to an ephemeral port", exc_info=True)
        sock.close()

    fallback = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    fallback.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    fallback.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    fallback.bind(("", 0))
    fallback.settimeout(0.4)
    return fallback, False


def _scan_blocking(timeout: float) -> DiscoveryResult:
    """Send the questions and collect answers until the timeout. Runs off the event loop."""
    result = DiscoveryResult(method="mdns-oneshot", shallow=True, scanned_seconds=timeout)
    sock = None
    try:
        sock, on_5353 = _open_socket()
        result.method = "mdns-oneshot" if on_5353 else "mdns-oneshot-unicast-only"

        query = _build_query([s.service for s in SERVICE_TYPES])
        # Sent twice, half a second apart. mDNS is UDP over a wireless network and a lost
        # question is a device that silently does not exist; a second ask is cheap and
        # roughly halves that.
        sock.sendto(query, (MDNS_GROUP, MDNS_PORT))

        import time

        deadline = time.monotonic() + timeout
        resent = False
        seen: set[tuple[str, str]] = set()

        while time.monotonic() < deadline:
            if not resent and time.monotonic() > deadline - timeout / 2:
                sock.sendto(query, (MDNS_GROUP, MDNS_PORT))
                resent = True
            try:
                data, addr = sock.recvfrom(9000)
            except TimeoutError:
                continue
            except OSError:
                break

            for service, instance, host in _parse_answers(data):
                spec = _BY_SERVICE.get(service)
                if spec is None:
                    continue
                pretty = _pretty(instance, spec.service)
                if (service, pretty) in seen:
                    continue
                seen.add((service, pretty))
                result.devices.append(
                    DiscoveredDevice(
                        name=pretty,
                        service=spec.service,
                        label=spec.label,
                        provider=spec.provider.value if spec.provider else None,
                        device_class=spec.device_class.value,
                        note=spec.note,
                        host=host or addr[0],
                    )
                )
    except OSError as exc:
        # No multicast route, a container with host networking off, a firewall. All of
        # them mean the same thing to a customer — the scan could not run — and none of
        # them should reach them as a traceback.
        log.info("mDNS discovery could not run: %s", exc)
        result.error = (
            "the network scan could not run on this machine — multicast is unavailable, "
            "which is normal in a container or on a locked-down network"
        )
    finally:
        if sock is not None:
            sock.close()
    return result


def _pretty(instance: str, service: str) -> str:
    """"Living Room TV._googlecast._tcp.local." -> "Living Room TV"."""
    suffix = "." + service.rstrip(".")
    name = instance.rstrip(".")
    if name.endswith(suffix.rstrip(".")):
        name = name[: -len(suffix.rstrip("."))].rstrip(".")
    return name.replace("\\032", " ").strip() or instance.rstrip(".")


# ---------------------------------------------------------------------------
# The zeroconf path
# ---------------------------------------------------------------------------


def _scan_zeroconf(timeout: float) -> DiscoveryResult:
    """Proper protocol handling when the library is present.

    Not shallow: `ServiceBrowser` keeps listening and picks up devices that announce on a
    slow cycle, which the one-shot query misses.
    """
    from zeroconf import ServiceBrowser, Zeroconf

    result = DiscoveryResult(method="zeroconf", shallow=False, scanned_seconds=timeout)
    found: dict[tuple[str, str], DiscoveredDevice] = {}

    class Listener:
        def add_service(self, zc, service_type, name):
            spec = _BY_SERVICE.get(service_type)
            if spec is None:
                return
            host = None
            try:
                info = zc.get_service_info(service_type, name, timeout=800)
                if info is not None:
                    addresses = info.parsed_addresses()
                    host = addresses[0] if addresses else info.server
            except Exception:  # noqa: BLE001 - a device that will not resolve still exists
                log.debug("could not resolve %s", name, exc_info=True)
            pretty = _pretty(name, service_type)
            found[(service_type, pretty)] = DiscoveredDevice(
                name=pretty,
                service=service_type,
                label=spec.label,
                provider=spec.provider.value if spec.provider else None,
                device_class=spec.device_class.value,
                note=spec.note,
                host=host,
            )

        def update_service(self, zc, service_type, name):
            pass

        def remove_service(self, zc, service_type, name):
            pass

    zc = None
    try:
        import time

        zc = Zeroconf()
        ServiceBrowser(zc, [s.service for s in SERVICE_TYPES], Listener())
        time.sleep(timeout)
    except OSError as exc:
        log.info("zeroconf discovery could not run: %s", exc)
        result.error = "the network scan could not run on this machine"
    finally:
        if zc is not None:
            zc.close()

    result.devices = list(found.values())
    return result


async def discover(timeout: float = DEFAULT_TIMEOUT_S) -> DiscoveryResult:
    """Scan the local network. Never raises.

    Runs the blocking socket work in a thread: the API is a single async process and a
    two-and-a-half second `recvfrom` loop on the event loop would stall every other
    request, including the rest of the conversation this was called from.
    """
    try:
        import zeroconf  # noqa: F401

        scan = _scan_zeroconf
    except ImportError:
        scan = _scan_blocking

    try:
        return await asyncio.to_thread(scan, timeout)
    except Exception as exc:  # noqa: BLE001 - discovery must never cost the customer a turn
        log.warning("discovery failed", exc_info=True)
        return DiscoveryResult(
            method="failed", error=f"the network scan failed: {exc}", shallow=True
        )


def summarise(result: DiscoveryResult) -> dict[str, object]:
    """What the tool and the API both return. One shape, so they cannot drift."""
    counts = result.by_provider
    connectable = sorted(counts)

    return {
        "scanned": result.error is None,
        "error": result.error,
        "method": result.method,
        "scan_was_shallow": result.shallow,
        "devices_found": len(result.devices),
        "devices": [
            {
                "name": d.name,
                "kind": d.label,
                "service": d.service,
                "could_connect_via": d.provider,
                "note": d.note,
                "address": d.host,
            }
            for d in result.devices
        ],
        "by_platform": counts,
        "platforms_worth_connecting": connectable,
    }
