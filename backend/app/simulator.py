"""
FUELWISE — Live simulation engine (in-memory station cache).

Runs in a daemon thread and, every `interval` seconds, random-walks each
station's `current_wait_time` and (for CNG) `pressure_level` so that
`/api/stations` always returns fresh values — even before any real crowd
report arrives.

Design notes:
  • EV health is chosen once at seed time and NEVER changes during a run
    (mirrors the frontend contract: broken chargers stay broken).
  • All reads/writes happen through a lock-free dict + shallow copies under
    a threading.Lock, so FastAPI async handlers can call snapshot() safely.
"""

from __future__ import annotations

import random
import threading
import time
from datetime import datetime, timezone
from typing import Any

from .station_seed import STATION_SEEDS

PRESSURE_LEVELS = ("low", "medium", "high")

# wait bands (minutes) by fuel type
WAIT_BANDS = {"CNG": (3, 60), "EV": (2, 45)}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class StationSimulator:
    def __init__(self, interval: float = 5.0) -> None:
        self.interval = interval
        self._lock = threading.Lock()
        self._stations: dict[str, dict[str, Any]] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._seed()

    # ------------------------------------------------------------------
    # bootstrapping
    # ------------------------------------------------------------------
    def _seed(self) -> None:
        now = _now_iso()
        for s in STATION_SEEDS:
            is_cng = s["type"] == "CNG"
            wait = int(s["historical_avg_wait"])
            # Give EV a bit of realistic variance around its baseline.
            if not is_cng:
                wait = max(0, wait + random.randint(-3, 4))
            self._stations[s["id"]] = {
                **s,
                "current_wait_time": wait,
                "pressure_level": "medium" if is_cng else None,
                "updated_at": now,
            }

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, name="fuelwise-sim", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                self.tick()
            except Exception:  # never kill the simulator
                pass

    # ------------------------------------------------------------------
    # mutation
    # ------------------------------------------------------------------
    def tick(self) -> None:
        """Random-walk one simulation step across all stations."""
        with self._lock:
            for st in self._stations.values():
                if not st["is_operational"]:
                    continue  # broken chargers stay broken (session-fixed)
                st["current_wait_time"] = self._next_wait(st)
                if st["type"] == "CNG":
                    st["pressure_level"] = self._next_pressure(st)
                st["updated_at"] = _now_iso()

    def apply_report(
        self,
        station_id: str,
        wait_time: float,
        pressure: str | None = None,
    ) -> bool:
        """Immediate cache update from a crowd report (POST /api/report)."""
        with self._lock:
            st = self._stations.get(station_id)
            if not st:
                return False
            st["current_wait_time"] = max(0, round(float(wait_time)))
            if pressure in PRESSURE_LEVELS:
                st["pressure_level"] = pressure
            st["updated_at"] = _now_iso()
            # cheap incremental "retrain": blend the rolling baseline
            avg = st["historical_avg_wait"]
            st["historical_avg_wait"] = round(0.8 * avg + 0.2 * wait_time, 2)
            return True

    @staticmethod
    def _next_wait(st: dict[str, Any]) -> int:
        low, high = WAIT_BANDS[st["type"]]
        current = st["current_wait_time"]
        delta = random.randint(-3, 3)
        # occasional arrival "surge" / clearing
        if random.random() < 0.12:
            delta = random.choice([random.randint(5, 12), random.randint(-12, -5)])
        return max(low, min(high, current + delta))

    @staticmethod
    def _next_pressure(st: dict[str, Any]) -> str:
        current = st.get("pressure_level", "medium")
        r = random.random()
        if current == "low":
            return "medium" if r < 0.18 else "low"
        if current == "high":
            return "medium" if r < 0.18 else "high"
        if r < 0.14:
            return "low"
        if r < 0.28:
            return "high"
        return "medium"

    # ------------------------------------------------------------------
    # reads (return deep-ish copies so callers can't corrupt state)
    # ------------------------------------------------------------------
    def get(self, station_id: str) -> dict[str, Any] | None:
        with self._lock:
            st = self._stations.get(station_id)
            return dict(st) if st else None

    def all(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(s) for s in self._stations.values()]

    def count(self) -> int:
        with self._lock:
            return len(self._stations)


# ----------------------------------------------------------------------
# Module-level singleton (used by routers + main lifespan)
# ----------------------------------------------------------------------
simulator = StationSimulator(interval=5.0)
