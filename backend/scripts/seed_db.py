"""
FUELWISE — seed_db.py
=====================
Populates the PostgreSQL `stations` table with REAL Pune stations.

Source order:
  1. OpenStreetMap (Overpass API) — real CNG pumps + EV chargers (free, no key).
  2. Curated fallback list (`app/station_seed.STATION_SEEDS`) when Overpass
     returns nothing / is rate-limited. Fallback coordinates are real, never
     randomized.

Prereq: `docker compose up -d db` (or any reachable Postgres).

Run from the backend/ folder:
    python scripts/seed_db.py            # insert (skip if already populated)
    python scripts/seed_db.py --reset    # wipe and re-seed from scratch
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# allow `python scripts/seed_db.py` to import the app package
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import AsyncSessionLocal, init_db  # noqa: E402
from app.models import Station  # noqa: E402
from app.osm import PUNE_CENTER, fetch_real_seeds  # noqa: E402
from app.station_seed import STATION_SEEDS  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402


async def main(reset: bool = False) -> None:
    await init_db()

    # 1) Real stations from OpenStreetMap (primary source).
    seeds = fetch_real_seeds(*PUNE_CENTER)
    if seeds:
        print(f"[seed] Overpass returned {len(seeds)} real stations")
    else:
        print("[seed] Overpass empty / rate-limited — using curated Pune fallback")
        seeds = list(STATION_SEEDS)

    async with AsyncSessionLocal() as session:
        if reset:
            await session.execute(delete(Station))
            await session.commit()
            print("[seed] cleared existing stations")

        # Skip any station id already present (idempotent re-runs).
        existing = set((await session.execute(select(Station.id))).scalars())
        new_seeds = [s for s in seeds if s["id"] not in existing]
        if not new_seeds:
            print(f"[seed] stations table already has {len(existing)} rows — nothing to do")
            return

        for seed in new_seeds:
            session.add(Station(**seed))
        await session.commit()
        print(f"[seed] inserted {len(new_seeds)} stations into PostgreSQL")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed stations with real OSM data.")
    parser.add_argument("--reset", action="store_true", help="clear the table first")
    args = parser.parse_args()
    asyncio.run(main(reset=args.reset))
