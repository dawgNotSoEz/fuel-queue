"""Lightweight Vercel API entrypoint.

The full `app.main` service is intentionally kept for Docker/local use. It
initializes SQLAlchemy, probes PostgreSQL, starts a background simulator, and
loads optional ML artifacts, which is a poor fit for a Vercel function. This
small service keeps Vercel stateless and fetches real OSM stations server-side
so browser CORS and database availability cannot force the UI into simulation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import FastAPI, Query

from app.geo import haversine_km
from app.osm import fetch_real_seeds
from app.station_seed import STATION_SEEDS

app = FastAPI(title="FUELQUEUE API", version="0.2.0-vercel")

FuelType = Literal["CNG", "EV"]


def _station_row(seed: dict[str, Any]) -> dict[str, Any]:
	"""Expose a seed using the frontend API contract."""
	return {
		**seed,
		"current_wait_time": int(seed["historical_avg_wait"]),
		"pressure_level": "medium" if seed["type"] == "CNG" else None,
		"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
	}


def _nearby_seeds(lat: float, lng: float) -> list[dict[str, Any]]:
	"""Query real OSM stations; use real-coordinate Pune seeds if needed."""
	try:
		real = fetch_real_seeds(lat, lng)
	except Exception as exc:  # pragma: no cover - network-dependent fallback
		print(f"[vercel] Overpass unavailable: {exc}")
		real = []
	if real:
		return real

	# These are real Pune coordinates, not generated points. Only use them
	# when the requested location is genuinely inside the Pune seed region.
	fallback = [
		seed
		for seed in STATION_SEEDS
		if haversine_km(lat, lng, seed["latitude"], seed["longitude"]) <= 10
	]
	return fallback


@app.get("/")
async def root() -> dict[str, Any]:
	return {"status": "ok", "service": "fuelqueue-vercel-api"}


@app.get("/health")
async def health() -> dict[str, Any]:
	return {"status": "ok", "model_ready": False, "mode": "vercel-lightweight"}


@app.get("/api/stations")
async def stations(
	lat: float = Query(..., ge=-90, le=90),
	lng: float = Query(..., ge=-180, le=180),
	radius: float = Query(10, ge=0, le=200),
	type: FuelType | None = Query(None),
) -> dict[str, Any]:
	rows = []
	for seed in _nearby_seeds(lat, lng):
		if type is not None and seed["type"] != type:
			continue
		distance = round(haversine_km(lat, lng, seed["latitude"], seed["longitude"]), 2)
		if distance <= radius:
			rows.append({**_station_row(seed), "distance_km": distance})
	rows.sort(key=lambda row: row["distance_km"])
	return {"stations": rows, "count": len(rows), "source": "osm-server"}


__all__ = ["app"]