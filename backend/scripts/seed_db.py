"""
FUELWISE — seed_db.py
=====================
Populates the PostgreSQL `stations` table with the canonical 20-station
seed set (matching the frontend mock data).

Prereq: `docker compose up -d db` (or any reachable Postgres).

Run from the backend/ folder:
    python scripts/seed_db.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# allow `python scripts/seed_db.py` to import the app package
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import AsyncSessionLocal, init_db  # noqa: E402
from app.models import Station  # noqa: E402
from app.station_seed import STATION_SEEDS  # noqa: E402
from sqlalchemy import func, select  # noqa: E402


async def main() -> None:
    await init_db()
    async with AsyncSessionLocal() as session:
        existing = (await session.execute(select(func.count()).select_from(Station))).scalar() or 0
        if existing:
            print(f"[seed] stations table already has {existing} rows — skipping")
            return

        for seed in STATION_SEEDS:
            session.add(Station(**seed))
        await session.commit()
        print(f"[seed] inserted {len(STATION_SEEDS)} stations into PostgreSQL")


if __name__ == "__main__":
    asyncio.run(main())
