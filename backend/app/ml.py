"""
FUELWISE — XGBoost model gateway (load + predict).

Model artifacts (written by scripts/train_model.py):
  backend/models/xgboost_model.pkl
  backend/models/encoders.pkl
  backend/models/metrics.json

`predict_wait()` falls back to a lightweight analytical heuristic when the
model has not been trained yet, so the API is always usable during a demo.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import joblib
import numpy as np

BACKEND_DIR = Path(__file__).resolve().parent.parent  # backend/

MODEL_DIR = Path(
    os.getenv("FUELWISE_MODELS_DIR", BACKEND_DIR / "models")
).resolve()


def _resolve_artifact(env_key: str, default: Path) -> Path:
    """Resolve an env path relative to the models dir when not absolute."""
    raw = os.getenv(env_key)
    if not raw:
        return default
    p = Path(raw).expanduser()
    return p if p.is_absolute() else (MODEL_DIR / p)


XGB_PATH = _resolve_artifact("MODEL_PATH", MODEL_DIR / "xgboost_model.pkl")
ENC_PATH = _resolve_artifact("ENCODER_PATH", MODEL_DIR / "encoders.pkl")
METRICS_PATH = _resolve_artifact("METRICS_PATH", MODEL_DIR / "metrics.json")

# Canonical categorical vocabularies (train script encodes with these).
WEATHER_LEVELS = ["clear", "cloudy", "rain", "fog", "storm"]
PRESSURE_LEVELS = ["low", "medium", "high"]

_model: Any = None
_encoders: dict[str, Any] = {}
_metrics: dict[str, float] = {}


def load_models() -> bool:
    """Load model + encoders + metrics. Idempotent; never raises."""
    global _model, _encoders, _metrics
    try:
        _model = joblib.load(XGB_PATH)
        _encoders = joblib.load(ENC_PATH)
        if METRICS_PATH.exists():
            _metrics = json.loads(METRICS_PATH.read_text())
        return _model is not None
    except Exception as exc:  # noqa: BLE001
        print(f"[fuelwise] model not loaded ({exc}) — heuristic fallback active")
        return False


def is_ready() -> bool:
    return _model is not None


def _encode(col: str, value: str) -> int:
    enc = _encoders.get(col)
    if enc is None:
        return -1
    try:
        return int(enc.transform([value])[0])
    except Exception:  # unknown category -> safest known token
        return int(enc.transform([enc.classes_[0]])[0])


def _clip(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ----------------------------------------------------------------------
# Analytical fallback (peak-hour demand curve, weather & pressure factors)
# ----------------------------------------------------------------------
def _heuristic(
    hour: int,
    day_of_week: int,
    weather: str,
    pressure: str,
    historical_avg: float,
    capacity: int,
) -> float:
    def peak(h: float) -> float:
        # commuting peaks ≈ 08:30 and ≈ 18:30
        return 1.0 + 0.45 * math.exp(-(((h - 8.2) ** 2) / (2 * 1.9 ** 2))) \
            + 0.55 * math.exp(-(((h - 18.4) ** 2) / (2 * 2.2 ** 2)))

    weather_factor = {
        "clear": 1.0, "cloudy": 1.03, "rain": 1.18, "fog": 1.10, "storm": 1.32,
    }.get(weather, 1.0)
    pressure_factor = {"low": 1.28, "medium": 1.0, "high": 0.84}.get(pressure, 1.0)
    weekend = 0.92 if day_of_week >= 5 else 1.0
    crowding = 1.0 + 90.0 / max(capacity, 1)  # smaller stations queue longer
    return _clip(
        historical_avg * peak(hour) * weather_factor * pressure_factor
        * weekend * crowding * 0.35,
        1,
        120,
    )


def predict_wait(
    *,
    hour: int,
    day_of_week: int,
    weather: str,
    pressure: str,
    historical_avg: float,
    capacity: int,
) -> tuple[float, float]:
    """Return (predicted_wait_minutes, confidence 0..1)."""
    weather = weather.lower() if weather in WEATHER_LEVELS or weather.lower() in WEATHER_LEVELS else "clear"
    pressure = pressure.lower() if pressure in PRESSURE_LEVELS or pressure.lower() in PRESSURE_LEVELS else "medium"

    if _model is not None:
        try:
            row = np.array([[
                float(hour),
                float(day_of_week),
                1.0 if day_of_week >= 5 else 0.0,
                float(historical_avg),
                float(capacity),
                float(_encode("weather_condition", weather)),
                float(_encode("pressure_level", pressure)),
            ]], dtype=np.float32)
            pred = float(_model.predict(row)[0])
            pred = _clip(pred, 0, 120)
            conf = float(_metrics.get("within_20pct", 0.85))
            return round(pred, 1), round(conf, 3)
        except Exception:  # malformed row → heuristic
            pass

    fallback = _heuristic(hour, day_of_week, weather, pressure, historical_avg, capacity)
    return round(fallback, 1), 0.62  # transparent about heuristic mode


__all__ = [
    "XGB_PATH",
    "is_ready",
    "load_models",
    "predict_wait",
]
