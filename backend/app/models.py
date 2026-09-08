"""
FUELWISE — SQLAlchemy ORM models (Phase 2).

Two tables mirror the product contract:

  stations       — static registry (20 rows, seeded from station_seed.py)
  queue_records  — time-series telemetry samples (waits & pressure over
                   time, one row per crowd/operator report)

Dynamic "live" values (current_wait_time, pressure_level, updated_at) are
held in the in-memory simulator cache (app/simulator.py) so /api/stations
is always fast — DB writes happen on POST /api/report.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

# ----------------------------------------------------------------------
# Python-side enums
# ----------------------------------------------------------------------
STATION_TYPES = ("CNG", "EV")
CONNECTOR_TYPES = ("CCS", "CHAdeMO", "Type 2")  # EV only
PRESSURE_LEVELS = ("low", "medium", "high")  # CNG only


def _uuid() -> str:
    return uuid.uuid4().hex[:16]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Station(Base):
    """A single CNG or EV refuelling point (static registry)."""

    __tablename__ = "stations"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)

    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)

    # 'CNG' | 'EV'
    type: Mapped[str] = mapped_column(String(8), index=True)

    # EV only — CCS | CHAdeMO | Type 2
    connector_type: Mapped[str | None] = mapped_column(String(24), nullable=True)

    # ₹/kg (CNG) or ₹/kWh (EV) — placeholder until live tariffs
    price: Mapped[float] = mapped_column(Float, default=0.0)

    # Physical capacity used by the ML model (bays/pumps)
    capacity: Mapped[int] = mapped_column(Integer, default=10)

    # ML baseline feature — rolling mean wait for the station
    historical_avg_wait: Mapped[float] = mapped_column(Float, default=20.0)

    # Session-stable EV health flag (broken chargers stay broken)
    is_operational: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class QueueRecord(Base):
    """Time-series telemetry sample (one row per /api/report)."""

    __tablename__ = "queue_records"

    id: Mapped[str] = mapped_column(String(24), primary_key=True, default=_uuid)
    station_id: Mapped[str] = mapped_column(
        String(24), ForeignKey("stations.id", ondelete="CASCADE")
    )
    wait_time_minutes: Mapped[float] = mapped_column(Float)
    # low | medium | high (CNG) — NULL for EV-only samples
    pressure_level: Mapped[str | None] = mapped_column(String(12), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # time-series timestamp (hypertable dimension on TimescaleDB)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
    )

    __table_args__ = (
        Index("ix_queue_station_time", "station_id", "recorded_at"),
    )
