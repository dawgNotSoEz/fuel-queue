"""
FUELWISE — GET /api/recommend
Demand Distribution Algorithm endpoint.

Scores operational stations of the requested type near the user by
    Total Time = Drive Time (Haversine → minutes) + Predicted Wait (XGBoost)
then returns the sorted list with `is_best_choice` / `is_worst_choice`
flags — the exact AI story we demo on stage.

Only stations within SERVED_RADIUS_KM of the requested point are ranked, so
the endpoint never recommends Pune demo pumps to a user who is far away.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Query

from .. import ml
from ..geo import drive_time_minutes, haversine_km
from ..simulator import simulator
from .stations import DEFAULT_RADIUS_KM

router = APIRouter(tags=["recommend"])

FuelType = Literal["CNG", "EV"]


def _rank_rows(stations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flag best/worst among operational stations (lowest/highest total)."""
    rows = list(stations)
    candidates = [s for s in rows if s["is_operational"]]
    if len(candidates) >= 2:
        ordered = sorted(candidates, key=lambda s: s["total_time"])
        for s in rows:
            s["is_best_choice"] = s["id"] == ordered[0]["id"]
            s["is_worst_choice"] = s["id"] == ordered[-1]["id"]
    elif len(candidates) == 1:
        for s in rows:
            s["is_best_choice"] = s["id"] == candidates[0]["id"]
    return rows


@router.get("/recommend")
async def recommend(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    type: FuelType = Query(...),
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = [
        s
        for s in simulator.all()
        if s["type"] == type
        and haversine_km(lat, lng, s["latitude"], s["longitude"])
        <= DEFAULT_RADIUS_KM
    ]

    enriched: list[dict[str, Any]] = []
    for s in rows:
        distance = haversine_km(lat, lng, s["latitude"], s["longitude"])
        drive = drive_time_minutes(distance)

        # Prefer a live crowd sample when present; else ask the model.
        if s["is_operational"]:
            now = datetime.now()
            predicted_wait, confidence = ml.predict_wait(
                hour=now.hour,
                day_of_week=now.weekday(),
                weather="clear",
                pressure=str(s.get("pressure_level") or "medium"),
                historical_avg=float(s.get("historical_avg_wait", 20.0)),
                capacity=int(s.get("capacity", 10)),
            )
        else:
            predicted_wait, confidence = 0.0, 0.0

        enriched.append(
            {
                **s,
                "distance_km": round(distance, 2),
                "drive_time_min": drive,
                "predicted_wait": predicted_wait,
                "confidence": confidence,
                "total_time": round(drive + predicted_wait, 1),
                "is_best_choice": False,
                "is_worst_choice": False,
            }
        )

    enriched.sort(key=lambda s: (not s["is_operational"], s["total_time"]))
    ranked = _rank_rows(enriched)

    return {
        "stations": ranked,
        "count": len(ranked),
        "algorithm": "drive_time + predicted_wait",
        "model_ready": ml.is_ready(),
    }
