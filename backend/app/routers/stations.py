"""
FUELWISE — GET /api/stations
Returns the live in-memory station snapshot (fresh every 5 s from the
simulator), optionally filtered by fuel type / radius around a point.

IMPORTANT: the in-memory cache holds the Pune station set (real CNG pumps +
EV chargers). When the caller passes a live location that is NOT near that
region, this endpoint returns an EMPTY list so the frontend falls back to
real OpenStreetMap stations around the user — never Pune pumps miles away.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query

from ..geo import haversine_km
from ..simulator import simulator

router = APIRouter(tags=["stations"])

FuelType = Literal["CNG", "EV"]

# Default search radius (km) around the user. Stations farther away than
# this are not returned, so the map only shows nearby, relevant pumps.
DEFAULT_RADIUS_KM = 10.0


@router.get("/stations")
async def list_stations(
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    radius: float | None = Query(None, ge=0, le=200, description="km"),
    type: FuelType | None = Query(None),
) -> dict:
    """List stations from the live cache (optionally spatially filtered).

    - With lat/lng: only stations within `radius` (default 10 km) of that
      point are returned, sorted nearest-first. Far-away points get [].
    - Without lat/lng: full snapshot (e.g. admin / health uses).
    """
    rows = simulator.all()

    if type is not None:
        rows = [s for s in rows if s["type"] == type]

    if lat is not None and lng is not None:
        cutoff = radius if radius is not None else DEFAULT_RADIUS_KM
        rows = [
            {
                **s,
                "distance_km": round(
                    haversine_km(lat, lng, s["latitude"], s["longitude"]), 2
                ),
            }
            for s in rows
        ]
        rows = [s for s in rows if s["distance_km"] <= cutoff]
        rows.sort(key=lambda s: s["distance_km"])

    return {
        "stations": rows,
        "count": len(rows),
        "source": "simulator-cache",
        "note": (
            None
            if rows
            else "No FUELWISE stations near this location — use OSM fallback."
        ),
    }
