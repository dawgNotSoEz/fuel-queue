"""
FUELWISE - "who is actually around this pump" engine (backend mirror).

The frontend reads the real people-generating places around each station from
OpenStreetMap (`frontend/src/utils/crowdContext.ts`) and sends the resulting
category weights here, so the backend histogram is built from the SAME
station-specific mix. Without this mirror the API would fall back to a
city-wide curve and every pump would look identical again.

Categories and their weekly/hourly rhythms are duplicated 1:1 from the
frontend so both sides produce the same bars.

NOTE: no free source of measured footfall exists (Google's popular times are
not in the public Places API), so the *mix* - which categories, how many, how
close - is real OSM geography, while each category's hourly rhythm is a model.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

HOURS_PER_DAY = 24
DAYS_PER_WEEK = 7

CROWD_CATEGORIES: tuple[str, ...] = (
    "transport",
    "office",
    "retail",
    "market",
    "education",
    "dining",
    "health",
    "leisure",
    "residential",
    "industry",
    "worship",
    "highway",
)

CROWD_LABELS: dict[str, str] = {
    "transport": "transit stops",
    "office": "offices",
    "retail": "shops",
    "market": "markets",
    "education": "schools",
    "dining": "restaurants",
    "health": "clinics",
    "leisure": "leisure spots",
    "residential": "homes",
    "industry": "industry",
    "worship": "places of worship",
    "highway": "the highway",
}

EMPTY_MIX: dict[str, float] = {c: 0.0 for c in CROWD_CATEGORIES}


# ----------------------------------------------------------------------
# Hourly helpers (identical maths to the frontend)
# ----------------------------------------------------------------------
def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _hour_distance(a: float, b: float) -> float:
    raw = abs(a - b) % HOURS_PER_DAY
    return min(raw, HOURS_PER_DAY - raw)


def _bump(hour: float, centre: float, width: float, height: float) -> float:
    d = _hour_distance(hour, centre)
    return height * math.exp(-(d * d) / (2 * width * width))


def _week(values: tuple[float, ...]):
    """Weekday strength by JS day index (0 = Sunday) from a Mon-first tuple."""

    def get(day: int) -> float:
        return values[(day + 6) % DAYS_PER_WEEK]

    return get


#: `week` arrays are written Mon..Sun here; `_week` maps them to JS day index.
CROWD_PATTERN: dict[str, dict[str, Any]] = {
    "transport": {
        "week": _week((1.0, 1.0, 1.0, 1.0, 1.08, 0.95, 0.9)),
        "hours": lambda h: 0.45
        + _bump(h, 8.5, 1.6, 1.0)
        + _bump(h, 18.4, 1.9, 1.1)
        + _bump(h, 13.0, 1.8, 0.45),
        "pump_weight": 1.0,
    },
    "office": {
        "week": _week((1.0, 1.0, 1.0, 0.97, 0.88, 0.1, 0.07)),
        "hours": lambda h: 0.05
        + _bump(h, 9.6, 1.5, 1.0)
        + _bump(h, 13.0, 1.3, 0.5)
        + _bump(h, 17.6, 1.5, 0.8),
        "pump_weight": 0.62,
    },
    "retail": {
        "week": _week((0.78, 0.78, 0.84, 0.9, 1.0, 1.12, 0.82)),
        "hours": lambda h: 0.15 + _bump(h, 12.0, 2.0, 0.7) + _bump(h, 18.2, 2.4, 1.0),
        "pump_weight": 0.72,
    },
    "market": {
        "week": _week((0.88, 0.9, 0.92, 0.96, 1.02, 1.18, 1.05)),
        "hours": lambda h: 0.1 + _bump(h, 8.6, 1.9, 1.25) + _bump(h, 17.5, 1.6, 0.35),
        "pump_weight": 0.7,
    },
    "education": {
        "week": _week((1.0, 1.0, 1.0, 1.0, 0.82, 0.06, 0.05)),
        "hours": lambda h: 0.05
        + _bump(h, 8.0, 1.1, 1.0)
        + _bump(h, 12.6, 1.3, 0.7)
        + _bump(h, 15.4, 1.5, 0.55),
        "pump_weight": 0.52,
    },
    "dining": {
        "week": _week((0.82, 0.84, 0.9, 0.96, 1.12, 1.18, 1.0)),
        "hours": lambda h: 0.15 + _bump(h, 13.0, 1.4, 0.85) + _bump(h, 20.5, 1.8, 1.0),
        "pump_weight": 0.5,
    },
    "health": {
        "week": _week((1.0, 1.0, 1.0, 1.0, 0.98, 0.5, 0.32)),
        "hours": lambda h: 0.1 + _bump(h, 11.0, 2.6, 0.9),
        "pump_weight": 0.42,
    },
    "leisure": {
        "week": _week((0.68, 0.7, 0.76, 0.86, 1.0, 1.22, 1.08)),
        "hours": lambda h: 0.15 + _bump(h, 11.0, 2.6, 0.6) + _bump(h, 18.8, 2.1, 0.95),
        "pump_weight": 0.55,
    },
    "residential": {
        "week": _week((1.0, 0.99, 1.0, 1.0, 1.06, 1.04, 1.06)),
        "hours": lambda h: 0.55 + _bump(h, 8.6, 1.7, 0.85) + _bump(h, 19.0, 2.2, 1.15),
        "pump_weight": 0.85,
    },
    "industry": {
        "week": _week((1.0, 1.0, 1.0, 1.0, 0.95, 0.4, 0.35)),
        "hours": lambda h: 0.1 + _bump(h, 9.0, 2.0, 0.9) + _bump(h, 14.5, 2.1, 0.8),
        "pump_weight": 0.48,
    },
    "worship": {
        "week": _week((0.42, 0.42, 0.45, 0.5, 0.85, 0.9, 1.25)),
        "hours": lambda h: 0.05 + _bump(h, 8.2, 1.6, 1.0) + _bump(h, 18.6, 1.4, 0.55),
        "pump_weight": 0.35,
    },
    "highway": {
        "week": _week((0.88, 0.88, 0.9, 0.96, 1.06, 1.18, 1.12)),
        "hours": lambda h: 0.5 + _bump(h, 9.0, 2.6, 0.6) + _bump(h, 18.0, 2.6, 0.65),
        "pump_weight": 0.9,
    },
}

#: Generic city mix used only to season sparse areas (never dominant).
CITY_BASELINE_MIX: dict[str, float] = {
    **EMPTY_MIX,
    "residential": 0.3,
    "transport": 0.25,
    "retail": 0.2,
    "office": 0.15,
    "dining": 0.1,
}


# ----------------------------------------------------------------------
# Mix helpers
# ----------------------------------------------------------------------
def normalise_mix(raw: Mapping[str, float]) -> dict[str, float]:
    """Normalise raw category weights into a 0..1 mix that sums to 1."""
    total = sum(max(0.0, float(raw.get(c) or 0.0)) for c in CROWD_CATEGORIES)
    mix = dict(EMPTY_MIX)
    if total <= 0:
        return mix
    for category in CROWD_CATEGORIES:
        mix[category] = max(0.0, float(raw.get(category) or 0.0)) / total
    return mix


def blend_mix(a: Mapping[str, float], b: Mapping[str, float], weight_of_b: float) -> dict[str, float]:
    raw = {
        c: a.get(c, 0.0) * (1 - weight_of_b) + b.get(c, 0.0) * weight_of_b
        for c in CROWD_CATEGORIES
    }
    return normalise_mix(raw)


def station_crowd_mix(crowd: Mapping[str, float] | None) -> dict[str, float]:
    """Blend the station's real OSM mix with the baseline so sparse data works."""
    if not crowd:
        return normalise_mix(CITY_BASELINE_MIX)
    return blend_mix(normalise_mix(crowd), CITY_BASELINE_MIX, 0.25)


def dominant_category(mix: Mapping[str, float]) -> str | None:
    """Strongest crowd source around a station, e.g. 'markets'."""
    best: str | None = None
    best_value = 0.12  # ignore a flat/empty mix
    for category in CROWD_CATEGORIES:
        value = mix.get(category, 0.0)
        if value > best_value:
            best_value = value
            best = category
    return best


def parse_crowd(value: str | None) -> dict[str, float]:
    """Parse `transport:0.34,retail:0.22` into a weight map."""
    if not value:
        return {}
    weights: dict[str, float] = {}
    for chunk in value.split(","):
        key, _, raw = chunk.partition(":")
        category = key.strip()
        if category not in CROWD_CATEGORIES:
            continue
        try:
            weights[category] = max(0.0, float(raw))
        except ValueError:
            continue
    return weights


# ----------------------------------------------------------------------
# Curve construction - what makes every station & day unique
# ----------------------------------------------------------------------
def _mix_key(mix: Mapping[str, float]) -> tuple[int, ...]:
    return tuple(int(round(mix.get(c, 0.0) * 1000)) for c in CROWD_CATEGORIES)


_WEEKLY_CACHE: dict[tuple[int, ...], dict[str, Any]] = {}


def crowd_weekly_profile(mix: Mapping[str, float]) -> dict[str, Any]:
    """
    Build the station's own weekly crowd curve from its mix.

    Returns `raw` (unnormalised activity), `peak` (weekly maximum) and
    `shape` (each day's mean normalised to 1.0) - the same structure the
    frontend derives in `crowdWeeklyProfile()`.
    """
    key = _mix_key(mix)
    cached = _WEEKLY_CACHE.get(key)
    if cached is not None:
        return cached

    raw: list[list[float]] = []
    shape: list[list[float]] = []
    peak = 0.0

    for day in range(DAYS_PER_WEEK):
        hours: list[float] = []
        for hour in range(HOURS_PER_DAY):
            value = 0.0
            for category in CROWD_CATEGORIES:
                weight = mix.get(category, 0.0)
                if weight <= 0:
                    continue
                pattern = CROWD_PATTERN[category]
                value += weight * pattern["week"](day) * pattern["hours"](hour)
            hours.append(value)
            peak = max(peak, value)
        raw.append(hours)

        mean = sum(hours) / HOURS_PER_DAY
        shape.append([v / mean for v in hours] if mean > 0 else [1.0] * HOURS_PER_DAY)

    profile = {"raw": raw, "peak": peak, "shape": shape}
    if len(_WEEKLY_CACHE) > 256:
        _WEEKLY_CACHE.clear()
    _WEEKLY_CACHE[key] = profile
    return profile


__all__ = [
    "CROWD_CATEGORIES",
    "CROWD_LABELS",
    "CROWD_PATTERN",
    "DAYS_PER_WEEK",
    "EMPTY_MIX",
    "HOURS_PER_DAY",
    "blend_mix",
    "crowd_weekly_profile",
    "dominant_category",
    "normalise_mix",
    "parse_crowd",
    "station_crowd_mix",
]
