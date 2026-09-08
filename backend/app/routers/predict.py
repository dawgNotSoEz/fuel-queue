"""
FUELWISE — AI endpoints.

  POST /api/predict  →  XGBoost wait-time inference
  POST /api/report   →  store a crowd/operator telemetry sample (persists to
                        the queue_records time-series table when Postgres is
                        up, and hot-updates the in-memory baseline so the
                        model effectively "re-learns" between retrains)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import ml
from ..database import AsyncSessionLocal, db_available, get_db
from ..models import QueueRecord
from ..simulator import simulator

router = APIRouter(tags=["ai"])


# ----------------------------------------------------------------------
# Request / response schemas
# ----------------------------------------------------------------------
class PredictRequest(BaseModel):
    station_id: str | None = None
    hour: int = Field(ge=0, le=23, description="0-23")
    day_of_week: int = Field(ge=0, le=6, description="0=Monday … 6=Sunday")
    weather: str = "clear"  # clear | cloudy | rain | fog | storm
    pressure: str | None = None  # low | medium | high (overrides station)
    historical_avg: float | None = Field(None, ge=0, le=240)


class ReportRequest(BaseModel):
    station_id: str
    wait_time: float = Field(ge=0, le=240)
    pressure: str | None = None  # CNG reports only
    user_id: str | None = None


@router.post("/predict")
async def predict(req: PredictRequest) -> dict[str, Any]:
    """Predict queue wait (minutes) with the XGBoost model + confidence."""
    station = simulator.get(req.station_id) if req.station_id else None

    pressure = (req.pressure or (station or {}).get("pressure_level") or "medium")
    historical = req.historical_avg
    if historical is None:
        historical = (station or {}).get("historical_avg_wait", 20.0)
    capacity = int((station or {}).get("capacity", 10))

    predicted, confidence = ml.predict_wait(
        hour=req.hour,
        day_of_week=req.day_of_week,
        weather=req.weather,
        pressure=str(pressure),
        historical_avg=float(historical),
        capacity=capacity,
    )

    return {
        "station_id": req.station_id,
        "predicted_wait": predicted,
        "confidence": confidence,
        "model_ready": ml.is_ready(),
        "features": {
            "hour": req.hour,
            "day_of_week": req.day_of_week,
            "weather": req.weather,
            "pressure": pressure,
            "historical_avg": historical,
            "station_capacity": capacity,
        },
    }


@router.post("/report", status_code=201)
async def report(req: ReportRequest, _: Any = Depends(get_db)) -> dict[str, Any]:
    """Persist a telemetry sample + trigger an incremental model update."""
    cache_ok = simulator.apply_report(req.station_id, req.wait_time, req.pressure)

    persisted = False
    try:
        if await db_available():
            async with AsyncSessionLocal() as session:
                session.add(
                    QueueRecord(
                        station_id=req.station_id,
                        wait_time_minutes=req.wait_time,
                        pressure_level=req.pressure,
                        user_id=req.user_id,
                    )
                )
                await session.commit()
                persisted = True
    except Exception as exc:  # db transient — never fail the request
        print(f"[fuelwise] report persist failed: {exc}")

    return {
        "stored": persisted,
        "cache_updated": cache_ok,
        "retrain_pending": False,  # incremental baseline update applied instead
        "station_id": req.station_id,
    }
