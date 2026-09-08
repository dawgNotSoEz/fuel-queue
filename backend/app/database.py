"""
FUELWISE — SQLAlchemy 2.0 ASYNC connection layer (Phase 2).

The engine connects lazily; the API boots even when PostgreSQL is not
running (endpoints degrade to the in-memory simulator cache). TimescaleDB
URLs are honoured when provided.
"""

import os
from collections.abc import AsyncIterator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

# backend/app -> backend -> repo root
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_DIR / ".env")


def _async_url(url: str) -> str:
    """Make sure a psycopg2-style URL works on the async driver."""
    scheme, _, rest = url.partition("://")
    if scheme == "postgresql":
        return f"postgresql+asyncpg://{rest}"
    return url


# ----------------------------------------------------------------------
# Configuration (defaults match docker-compose)
# ----------------------------------------------------------------------
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://fuelwise:fuelwise_pass@localhost:5432/fuelwise_db",
)
TIMESCALE_URL = os.getenv(
    "TIMESCALE_URL",
    "postgresql+asyncpg://fuelwise:fuelwise_pass@localhost:5432/fuelwise_tsdb",
)

engine = create_async_engine(
    _async_url(DATABASE_URL),
    pool_pre_ping=True,
    echo=False,
)
# Timescale engine reserved for hypertable telemetry (optional).
timescale_engine = create_async_engine(
    _async_url(TIMESCALE_URL),
    pool_pre_ping=True,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""


async def init_db() -> None:
    """Create tables (idempotent). Safe to call when the DB is down."""
    from . import models  # noqa: F401  (register tables on Base)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def db_available() -> bool:
    """Cheap connectivity probe used to decide DB vs cache writes."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding an async session."""
    async with AsyncSessionLocal() as session:
        yield session


async def seed_stations_from_cache() -> None:
    """Idempotent: insert the 20 seeded stations if the table is empty."""
    from sqlalchemy import func, select

    from . import models
    from .station_seed import STATION_SEEDS

    try:
        async with AsyncSessionLocal() as session:
            count = (await session.execute(select(func.count()).select_from(models.Station))).scalar()
            if count:
                return
            for seed in STATION_SEEDS:
                session.add(models.Station(**seed))
            await session.commit()
            print(f"[fuelwise] seeded {len(STATION_SEEDS)} stations into PostgreSQL")
    except Exception as exc:
        print(f"[fuelwise] station seeding skipped (db offline): {exc}")


__all__ = [
    "AsyncSessionLocal",
    "Base",
    "DATABASE_URL",
    "TIMESCALE_URL",
    "db_available",
    "engine",
    "get_db",
    "init_db",
    "seed_stations_from_cache",
    "timescale_engine",
]
