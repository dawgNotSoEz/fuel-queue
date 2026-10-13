"""
FUELWISE - busyness endpoint.

  GET /api/busyness -> Google-Maps-style "popular times" histogram for one
                       station, plus the busiest/quietest windows the UI
                       annotates the chart with.

The frontend calls this on every station view and day switch, and falls back
to its own local demand curve (identical maths, `utils/busyness.ts`) when the
backend is unreachable - so this endpoint is an upgrade, never a dependency.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Query

from ..busyness import DAYS_PER_WEEK, HOURS_PER_DAY, WEATHER_FACTOR, get_profile
from ..crowd import parse_crowd
from ..simulator import simulator

router = APIRouter(tags=["ai"])

FuelType = Literal["CNG", "EV"]


@router.get("/busyness")
async def busyness(
    station_id: str = Query(..., min_length=1, description="Station identifier"),
    type: FuelType = Query(..., description="CNG or EV"),
    hour: int = Query(..., ge=0, le=23, description="Current local hour (0-23)"),
    day_of_week: int = Query(
        ..., ge=0, le=6, description="0 = Sunday ... 6 = Saturday (JS convention)"
    ),
    weather: str = Query("clear", description="clear | cloudy | rain | fog | storm"),
    historical_avg: float | None = Query(
        None, ge=0, le=240, description="Past-data mean wait (minutes)"
    ),
    capacity: int | None = Query(None, ge=1, le=200, description="Stalls/connectors"),
    crowd: str | None = Query(
        None,
        description=(
            "Real OpenStreetMap crowd mix around this station, e.g. "
            "'transport:0.34,retail:0.22,office:0.2'. Drives the per-station "
            "histogram shape so no two pumps share a curve."
        ),
    ),
    crowd_intensity: float | None = Query(
        None,
        ge=0.3,
        le=2.5,
        description="How crowded the area around the station is (0.55-1.75).",
    ),
) -> dict[str, Any]:
    """
    Hourly busyness for a station, derived from its past data and the model.

    `weekly[dow][hour]`, `daily`, and `expected_wait` mirror the frontend's
    `BusynessProfile`; bars are 0-100 relative to the station's weekly peak.
    Unknown stations (e.g. freshly discovered OSM pumps) are still served -
    their scale is derived deterministically from the id instead.
    """
    station = simulator.get(station_id) or {}
    condition = weather if weather in WEATHER_FACTOR else "clear"

    profile = get_profile(
        station_id=station_id,
        fuel_type=type,
        day_of_week=day_of_week,
        weather=condition,
        historical_avg=(
            historical_avg
            if historical_avg is not None
            else station.get("historical_avg_wait")
        ),
        capacity=capacity if capacity is not None else station.get("capacity"),
        pressure=str(station.get("pressure_level") or "medium"),
        crowd=parse_crowd(crowd),
        crowd_intensity=crowd_intensity,
    )

    return {
        **profile,
        "hour": hour,
        "known_station": bool(station),
        "stations": simulator.count(),
        "grid": {"days": DAYS_PER_WEEK, "hours": HOURS_PER_DAY},
        "caveat": (
            "Busyness is modelled from the real places mapped around the "
            "station (OpenStreetMap), its past-data mean and the ML wait "
            "model - not a live footfall sensor feed."
        ),
    }


__all__ = ["router"]
