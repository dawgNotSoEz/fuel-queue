"""
FUELWISE - Google-Maps-style "popular times" engine (backend mirror).

`GET /api/busyness` serves the hourly busyness histogram plus the derived
windows that the frontend renders.

How the histogram is derived from real data
-------------------------------------------
1. The frontend reads the ACTUAL places around the station from OpenStreetMap
   (`frontend/src/utils/crowdContext.ts`) - retail, offices, markets, transit
   stops, schools, restaurants, clinics, homes, industry and through-traffic -
   and sends the resulting category mix plus intensity to this endpoint.
2. `crowd.py` mirrors the frontend's per-category weekly/hourly rhythms, so
   the backend histogram is built from the SAME station-specific mix. Summing
   the categories a station really sits in gives that station its own curve,
   and its own shape for every weekday.
3. The station's own past data (`historical_avg_wait`, a rolling mean that
   crowd reports keep updating) sets the absolute scale, adjusted by how
   crowded the surrounding area actually is.
4. Bars are percentages of the station's weekly peak - exactly how Google
   normalises "popular times" - so days stay comparable.

Where the model comes in
------------------------
`ml.predict_wait` is a *minute* predictor, so it seasons the SHAPE of the day
rather than owning it: its 24 hourly predictions are normalised into a demand
curve and blended at a low weight, clamped tightly so it can never flatten the
station's real character. The past-data mean keeps owning the absolute scale.

Free data only: no API keys and no paid traffic feeds.
"""

from __future__ import annotations

import math
import time
from collections.abc import Mapping
from typing import Any

from . import crowd as crowd_model
from . import ml

HOURS_PER_DAY = 24
DAYS_PER_WEEK = 7

#: Typical day-long wait bands per fuel type (used when history is absent).
TYPICAL_BANDS: dict[str, tuple[float, float]] = {"CNG": (12.0, 38.0), "EV": (5.0, 22.0)}

#: Weather multipliers - rain and storms lengthen queues (free Open-Meteo).
WEATHER_FACTOR: dict[str, float] = {
    "clear": 1.0,
    "cloudy": 1.03,
    "rain": 1.18,
    "fog": 1.10,
    "storm": 1.32,
}

#: Default stall/connector counts when the caller does not know the station.
DEFAULT_CAPACITY: dict[str, int] = {"CNG": 10, "EV": 8}

#: Weight of the model-derived curve in the blended shape (0 = pure curve).
MODEL_SHAPE_WEIGHT = 0.25

#: The model may only season the analytic curve by this much per hour, so the
#: histogram keeps its double-peak contrast and never contradicts the offline
#: curve the frontend uses when this endpoint is unreachable. The weight and
#: the clamp are tuned to keep the two implementations within ~3 percentage
#: points per bar and ~6% per minute for the stations in `station_seed.py`.
MODEL_SHAPE_CLAMP = (0.9, 1.1)

#: A profile is pure maths + 24 cheap model calls - cache it briefly so the
#: frontend's 5-second live ticks do not re-derive it every time.
_CACHE_TTL_SECONDS = 300.0
_cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}


# ----------------------------------------------------------------------
# Small deterministic helpers (mirrors of the frontend implementation)
# ----------------------------------------------------------------------
def _wrap_int32(value: int) -> int:
    """Reproduce JavaScript's `value | 0` (int32 truncation)."""
    return ((value + 0x80000000) & 0xFFFFFFFF) - 0x80000000


def stable_hash(value: str) -> int:
    """32-bit string hash - stable per station id, matches the frontend."""
    acc = 0
    for char in value:
        acc = _wrap_int32(acc * 31 + ord(char))
    return abs(acc)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _hour_distance(a: float, b: float) -> float:
    """Shortest distance between two hours on a 24-hour clock."""
    raw = abs(a - b) % HOURS_PER_DAY
    return min(raw, HOURS_PER_DAY - raw)


def _bump(hour: float, centre: float, width: float, height: float) -> float:
    """Gaussian bump centred on `centre` (hours), wrapping past midnight."""
    d = _hour_distance(hour, centre)
    return height * math.exp(-(d * d) / (2 * width * width))


# ----------------------------------------------------------------------
# Demand curve
# ----------------------------------------------------------------------
def demand_shape(day_of_week: int, hour: float) -> float:
    """Raw (unnormalised) demand. 0 = Sunday ... 6 = Saturday, as in JS."""
    is_sunday = day_of_week == 0
    is_saturday = day_of_week == 6

    if not is_sunday and not is_saturday:
        # Weekday: sharp morning commute, light lunch bump, dominant evening.
        return (
            0.45
            + _bump(hour, 8.5, 1.5, 0.95)
            + _bump(hour, 13.2, 1.4, 0.34)
            + _bump(hour, 18.4, 1.9, 1.12)
            + _bump(hour, 11.2, 2.2, 0.12)
        )

    # Weekend: later start, broad mid-day plateau, softer late-afternoon bump.
    return (
        (0.5 if is_sunday else 0.55)
        + _bump(hour, 11.4, 2.4, 0.95)
        + _bump(hour, 17.2, 2.0, 0.5)
        + _bump(hour, 9.0, 1.6, 0.18 if is_sunday else 0.28)
    )


_DEMAND_CACHE: dict[int, list[float]] = {}


def hourly_demand(day_of_week: int) -> list[float]:
    """Normalised demand curve for a day (mean over 24 h = 1.0)."""
    day = ((day_of_week % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK
    cached = _DEMAND_CACHE.get(day)
    if cached is not None:
        return cached

    raw = [demand_shape(day, hour) for hour in range(HOURS_PER_DAY)]
    mean = sum(raw) / HOURS_PER_DAY
    normalised = [value / mean for value in raw]
    _DEMAND_CACHE[day] = normalised
    return normalised


def _weekly_peak_shape() -> float:
    """Busiest hour of the whole week, on the `hourly_demand` scale."""
    peak = 0.0
    for day in range(DAYS_PER_WEEK):
        peak = max(peak, max(hourly_demand(day)))
    return peak


WEEKLY_PEAK_SHAPE = _weekly_peak_shape()


def city_activity(day_of_week: int, hour: int) -> float:
    """0..1 "how busy is the city right now" scalar (1 = weekly peak)."""
    curve = hourly_demand(day_of_week)[hour % HOURS_PER_DAY]
    return _clamp(curve / WEEKLY_PEAK_SHAPE, 0.0, 1.0)


# ----------------------------------------------------------------------
# Per-station past-data scale
# ----------------------------------------------------------------------
def _normalise_fuel(fuel_type: str | None) -> str:
    return "EV" if (fuel_type or "").upper() == "EV" else "CNG"


def station_typical_wait(
    station_id: str, fuel_type: str, historical_avg: float | None
) -> float:
    """Past-data mean wait for a station (minutes)."""
    if historical_avg is not None and historical_avg > 0:
        return round(float(historical_avg), 1)

    # No history yet (e.g. a brand-new OSM station): spread deterministically
    # inside the fuel type's band so the profile is still stable per station.
    low, high = TYPICAL_BANDS[_normalise_fuel(fuel_type)]
    span = round((high - low) * 10)
    offset = (stable_hash(station_id) % (span + 1)) / 10
    return round(low + offset, 1)


def _model_shape(
    day_of_week: int,
    weather: str,
    pressure: str,
    typical_wait: float,
    capacity: int,
) -> list[float] | None:
    """
    The model's own demand curve for one day: 24 wait predictions normalised
    to a mean of 1.0. Returns `None` when the model cannot be reached.
    """
    try:
        predictions = [
            ml.predict_wait(
                hour=hour,
                day_of_week=day_of_week,
                weather=weather,
                pressure=pressure,
                historical_avg=typical_wait,
                capacity=capacity,
            )[0]
            for hour in range(HOURS_PER_DAY)
        ]
    except Exception as exc:  # never let the model break the endpoint
        print(f"[fuelwise] busyness model shape failed: {exc}")
        return None

    mean = sum(predictions) / HOURS_PER_DAY
    if mean <= 0:
        return None
    return [value / mean for value in predictions]


def effective_shape(
    base_shape: list[float],
    day_of_week: int,
    *,
    weather: str = "clear",
    pressure: str = "medium",
    typical_wait: float = 20.0,
    capacity: int = 10,
    weight: float = MODEL_SHAPE_WEIGHT,
    clamp: tuple[float, float] = MODEL_SHAPE_CLAMP,
) -> tuple[list[float], bool]:
    """
    Season a station's real crowd curve with the model's own curve.

    `base_shape` is the station's crowd-derived day shape (mean 1.0). The
    model's predictions are clamped to within `clamp` of that base at every
    hour, so it can only nudge the profile - never flatten the station's real
    character or change its scale.
    """
    modelled = _model_shape(
        ((day_of_week + 6) % 7),  # ml.predict_wait expects 0 = Monday
        weather,
        pressure,
        typical_wait,
        capacity,
    )
    if modelled is None:
        return base_shape, False

    low, high = clamp
    blended = []
    for hour in range(HOURS_PER_DAY):
        base = base_shape[hour]
        ratio = _clamp(modelled[hour] / base if base > 0 else 1.0, low, high)
        blended.append(base * (1.0 - weight) + base * ratio * weight)

    mean = sum(blended) / HOURS_PER_DAY
    if mean <= 0:
        return base_shape, False
    return [value / mean for value in blended], True


# ----------------------------------------------------------------------
# Windows
# ----------------------------------------------------------------------
def quietest_window(curve: list[float], length: int = 2) -> dict[str, int]:
    """Quietest `length`-hour window, ignoring the small hours."""
    best_start = 5
    best_sum = math.inf
    for start in range(5, 22 - length + 1):
        total = sum(curve[start : start + length])
        if total < best_sum:
            best_sum = total
            best_start = start
    return {"start": best_start, "end": best_start + length}


def busiest_window(curve: list[float], length: int = 2) -> dict[str, int]:
    """Busiest `length`-hour window of the day."""
    best_start = 0
    best_sum = -math.inf
    for start in range(0, HOURS_PER_DAY - length + 1):
        total = sum(curve[start : start + length])
        if total > best_sum:
            best_sum = total
            best_start = start
    return {"start": best_start, "end": best_start + length}


# ----------------------------------------------------------------------
# Profile
# ----------------------------------------------------------------------
def _apply_crowd_scale(
    base: float,
    fuel: str,
    historical_avg: float | None,
    intensity: float | None,
) -> float:
    """
    Scale a station's baseline wait by how crowded its surroundings really are.

    Mirrors `stationTypicalWait()` on the frontend: reported history stays
    authoritative but is nudged towards the crowd; with no history the crowd
    owns the scale outright.
    """
    if intensity is None or intensity <= 0:
        return base

    scale = (
        1 + (intensity - 1) * 0.5
        if (historical_avg is not None and historical_avg > 0)
        else intensity
    )
    low, high = TYPICAL_BANDS[fuel]
    return round(min(max(base * scale, low * 0.4), high * 2.4), 1)


def build_profile(
    *,
    station_id: str,
    fuel_type: str,
    day_of_week: int,
    weather: str = "clear",
    historical_avg: float | None = None,
    capacity: int | None = None,
    pressure: str = "medium",
    crowd: Mapping[str, float] | None = None,
    crowd_intensity: float | None = None,
) -> dict[str, Any]:
    """
    Build the full histogram payload (`ApiBusynessRow` on the frontend).

    `crowd` carries the real OpenStreetMap category mix around this station and
    `crowd_intensity` how crowded that area is, so every station gets its own
    weekly histogram instead of one shared city curve.

    Weather is intentionally NOT folded into `expected_wait`: the histogram
    describes typical past data, while the live comparison and the weather
    chip report the conditions of the moment separately.
    """
    day = ((day_of_week % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK
    fuel = _normalise_fuel(fuel_type)
    condition = weather if weather in WEATHER_FACTOR else "clear"
    stalls = int(capacity) if capacity and capacity > 0 else DEFAULT_CAPACITY[fuel]

    typical = station_typical_wait(station_id, fuel, historical_avg)
    typical = _apply_crowd_scale(typical, fuel, historical_avg, crowd_intensity)

    # The station's own crowd curve owns the shape of every day.
    mix = crowd_model.station_crowd_mix(crowd)
    crowd_profile = crowd_model.crowd_weekly_profile(mix)
    base_days: list[list[float]] = crowd_profile["shape"]
    crowd_peak = crowd_profile["raw"]

    shape, model_used = effective_shape(
        base_days[day],
        day,
        weather=condition,
        pressure=pressure,
        typical_wait=typical,
        capacity=stalls,
    )

    daily = [
        int(_clamp(round(100 * value / (crowd_profile["peak"] or 1)), 2, 100))
        for value in crowd_peak[day]
    ]
    expected_wait = [round(typical * value, 1) for value in shape]

    # Every other day uses its own crowd curve - that is why weekdays no
    # longer look identical to each other or to the weekend.
    weekly: list[list[int]] = []
    for d in range(DAYS_PER_WEEK):
        weekly.append(
            [
                int(_clamp(round(100 * value / (crowd_profile["peak"] or 1)), 2, 100))
                for value in crowd_peak[d]
            ]
        )

    peak_hour = max(range(HOURS_PER_DAY), key=lambda hour: shape[hour])
    peak_shape = max(max(day_hours) for day_hours in base_days)

    dominant = crowd_model.dominant_category(mix)

    return {
        "station_id": station_id,
        "fuel_type": fuel,
        "day_of_week": day,
        "weekly": weekly,
        "daily": daily,
        "expected_wait": expected_wait,
        "typical_wait_minutes": typical,
        "weekly_peak_minutes": round(typical * peak_shape, 1),
        "peak_hour": peak_hour,
        "busiest_window": busiest_window(shape, 2),
        "quiet_window": quietest_window(shape, 2),
        "weather": condition,
        "weather_queue_factor": round(WEATHER_FACTOR[condition] - 1.0, 3),
        "shape_source": "crowd+model" if model_used else "crowd",
        "source": "ml" if ml.is_ready() else "model",
        "model_ready": ml.is_ready(),
        "crowd": {c: round(mix[c], 4) for c in crowd_model.CROWD_CATEGORIES},
        "crowd_dominant": dominant,
        "crowd_label": crowd_model.CROWD_LABELS.get(dominant or "", None),
        "crowd_intensity": crowd_intensity,
    }


def get_profile(
    *,
    station_id: str,
    fuel_type: str,
    day_of_week: int,
    weather: str = "clear",
    historical_avg: float | None = None,
    capacity: int | None = None,
    pressure: str = "medium",
    crowd: Mapping[str, float] | None = None,
    crowd_intensity: float | None = None,
) -> dict[str, Any]:
    """Cached `build_profile` - safe for the frontend's 5-second live ticks."""
    mix_key = tuple(
        round(float((crowd or {}).get(c) or 0.0), 3)
        for c in crowd_model.CROWD_CATEGORIES
    )
    key = (
        station_id,
        fuel_type,
        day_of_week,
        weather,
        round(historical_avg, 1) if historical_avg else None,
        capacity,
        pressure,
        mix_key,
        round(crowd_intensity, 2) if crowd_intensity else None,
    )
    now = time.monotonic()
    cached = _cache.get(key)
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    profile = build_profile(
        station_id=station_id,
        fuel_type=fuel_type,
        day_of_week=day_of_week,
        weather=weather,
        historical_avg=historical_avg,
        capacity=capacity,
        pressure=pressure,
        crowd=crowd,
        crowd_intensity=crowd_intensity,
    )

    if len(_cache) > 512:  # bound the cache for long-running servers
        _cache.clear()
    _cache[key] = (now, profile)
    return profile


__all__ = [
    "DAYS_PER_WEEK",
    "HOURS_PER_DAY",
    "MODEL_SHAPE_WEIGHT",
    "TYPICAL_BANDS",
    "WEATHER_FACTOR",
    "WEEKLY_PEAK_SHAPE",
    "build_profile",
    "busiest_window",
    "city_activity",
    "demand_shape",
    "effective_shape",
    "get_profile",
    "hourly_demand",
    "quietest_window",
    "stable_hash",
    "station_typical_wait",
]
