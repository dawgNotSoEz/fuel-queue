"""
FUELWISE — OpenStreetMap (Overpass) station source.

Fetches REAL CNG pumps and EV chargers from OSM (free, no API key) so the
database can be seeded with actual stations instead of synthetic dots.

  • CNG → node/way["amenity"="fuel"]["fuel:cng"="yes"]
  • EV  → node/way["amenity"="charging_station"]

The Overpass API can rate-limit; callers fall back to the curated
`station_seed.STATION_SEEDS` list when nothing comes back.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any
from urllib import error, parse, request

# Public Overpass endpoints (server-side, no CORS concerns).
MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

REQUEST_TIMEOUT_S = 15
DEFAULT_RADIUS_M = 10_000

# Pune city centre (seed anchor / fallback centre).
PUNE_CENTER = (18.5204, 73.8567)

CONNECTORS = ("CCS", "CHAdeMO", "Type 2")


def _deterministic_extra(osm_id: int, fuel_type: str) -> int:
    """Stable pseudo-random value per OSM element (id-based, no RNG drift)."""
    digest = hashlib.md5(f"{fuel_type}:{osm_id}".encode()).hexdigest()
    return int(digest[:8], 16)


def _overpass_query(query: str) -> list[dict[str, Any]]:
    """Run an Overpass QL query against mirrors; return [] on total failure."""
    last_error: Exception | None = None
    for mirror in MIRRORS:
        url = f"{mirror}?data={parse.quote(query, safe='')}"
        req = request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "FUELWISE/0.2 (+https://github.com/dawgNotSoEz/fuel-queue)",
            },
        )
        try:
            with request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
                if resp.status != 200:
                    raise OSError(f"HTTP {resp.status}")
                payload = json.loads(resp.read().decode("utf-8"))
                return payload.get("elements", [])
        except (error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(1)  # be polite to mirrors before retrying
    if last_error:
        print(f"[osm] all mirrors failed: {last_error}")
    return []


def fetch_cng(lat: float, lng: float, radius_m: int = DEFAULT_RADIUS_M) -> list[dict[str, Any]]:
    query = (
        "[out:json][timeout:25];"
        f"(node(around:{radius_m},{lat},{lng})"
        '["amenity"="fuel"]["fuel:cng"="yes"];'
        f"way(around:{radius_m},{lat},{lng})"
        '["amenity"="fuel"]["fuel:cng"="yes"];'
        ");out center;"
    )
    return _overpass_query(query)


def fetch_ev(lat: float, lng: float, radius_m: int = DEFAULT_RADIUS_M) -> list[dict[str, Any]]:
    query = (
        "[out:json][timeout:25];"
        f"(node(around:{radius_m},{lat},{lng})"
        '["amenity"="charging_station"];'
        f"way(around:{radius_m},{lat},{lng})"
        '["amenity"="charging_station"];'
        ");out center;"
    )
    return _overpass_query(query)


def _element_point(el: dict[str, Any]) -> tuple[float, float] | None:
    """Resolve a node/way element to (lat, lng)."""
    if "lat" in el and "lon" in el:
        return float(el["lat"]), float(el["lon"])
    center = el.get("center")
    if center and "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def _to_seed(el: dict[str, Any], fuel_type: str) -> dict[str, Any] | None:
    """Map a raw Overpass element → a `Station` seed dict."""
    point = _element_point(el)
    if point is None:
        return None

    osm_id = int(el.get("id", 0))
    tags = el.get("tags") or {}
    name = (
        tags.get("name")
        or tags.get("brand")
        or tags.get("operator")
        or f"{fuel_type} Station #{osm_id}"
    )
    rnd = _deterministic_extra(osm_id, fuel_type)

    if fuel_type == "EV":
        connector = CONNECTORS[rnd % len(CONNECTORS)]
        price = 17 + (rnd % 11)  # ₹/kWh
        wait = 3 + (rnd % 15)  # minutes
        operational = (rnd % 100) >= 18  # ~18% broken chargers
    else:
        connector = None
        price = 72 + (rnd % 18)  # ₹/kg
        wait = 8 + (rnd % 40)  # minutes
        operational = True

    return {
        "id": f"osm_{fuel_type.lower()}_{osm_id}",
        "name": name,
        "latitude": round(point[0], 6),
        "longitude": round(point[1], 6),
        "type": fuel_type,
        "connector_type": connector,
        "price": price,
        "capacity": 6 + (rnd % 12),
        "historical_avg_wait": wait,
        "is_operational": operational,
    }


def fetch_real_seeds(
    lat: float, lng: float, radius_m: int = DEFAULT_RADIUS_M
) -> list[dict[str, Any]]:
    """Fetch real CNG + EV stations from OSM, normalized to seed dicts."""
    seeds: list[dict[str, Any]] = []
    for el in fetch_cng(lat, lng, radius_m):
        seed = _to_seed(el, "CNG")
        if seed:
            seeds.append(seed)
    for el in fetch_ev(lat, lng, radius_m):
        seed = _to_seed(el, "EV")
        if seed:
            seeds.append(seed)
    return seeds


__all__ = [
    "DEFAULT_RADIUS_M",
    "PUNE_CENTER",
    "fetch_cng",
    "fetch_ev",
    "fetch_real_seeds",
]
