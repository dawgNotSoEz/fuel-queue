"""
FUELWISE — FastAPI application (Phase 2: Backend + AI).

Endpoints:
  GET  /               → service info / health summary
  GET  /health         → liveness probe
  GET  /api/stations   → live station list (in-memory simulator cache)
  POST /api/predict    → XGBoost wait-time prediction + confidence
  POST /api/report     → persist crowd telemetry (queue_records) + cache update
  GET  /api/recommend  → Demand Distribution ranking (best/worst flags)

Startup:
  1. load XGBoost model (+ encoders/metrics) — heuristic fallback if absent
  2. start the 5-second live simulation engine (daemon thread)
  3. create DB tables + idempotently seed 20 stations when Postgres is up
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import ml
from .database import db_available, init_db, seed_stations_from_cache
from .routers import predict, recommend, stations
from .simulator import simulator as sim_engine

# Load env vars: prefer the repository root .env, fall back to backend/.env.
load_dotenv()
load_dotenv(".env")


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Startup / shutdown lifecycle."""
    # 1) AI model — never fatal.
    ml.load_models()

    # 2) Database — create tables + seed when reachable (non-fatal).
    if await db_available():
        await init_db()
        await seed_stations_from_cache()
    else:
        print("[fuelwise] PostgreSQL unavailable — running on in-memory cache")

    # 3) Live simulation engine.
    sim_engine.start()

    yield

    sim_engine.stop()


app = FastAPI(
    title="FUELWISE API",
    description="Unified CNG + EV intelligent fuelling platform (Phase 2).",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS — accept the Vite dev server (and the nginx container).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers (all under /api).
app.include_router(stations.router, prefix="/api")
app.include_router(predict.router, prefix="/api")
app.include_router(recommend.router, prefix="/api")


@app.get("/", tags=["system"])
async def root() -> dict:
    return {
        "status": "ok",
        "service": "fuelwise-api",
        "phase": 2,
        "model_ready": ml.is_ready(),
        "simulated_stations": sim_engine.count(),
        "message": "Predictive CNG + EV fuelling intelligence.",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/health", tags=["system"])
async def health() -> dict:
    return {
        "status": "ok",
        "model_ready": ml.is_ready(),
        "stations": sim_engine.count(),
        "db_online": await db_available(),
    }

