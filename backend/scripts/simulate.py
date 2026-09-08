"""
FUELWISE — simulate.py
======================
Standalone runner for the live simulation engine (useful for demos and
debugging without starting the API). Mutates the shared in-memory cache
every 5 seconds and prints a compact heartbeat.

Run from the backend/ folder:
    python scripts/simulate.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.simulator import StationSimulator  # noqa: E402

INTERVAL = float(sys.argv[1]) if len(sys.argv) > 1 else 5.0


def main() -> None:
    sim = StationSimulator(interval=INTERVAL)
    sim.start()
    print(f"[simulate] live engine started — tick every {INTERVAL:.0f}s "
          f"({sim.count()} stations). Ctrl+C to stop.\n")
    try:
        while True:
            time.sleep(INTERVAL)
            sample = sim.all()[:3]
            line = "  |  ".join(
                f"{s['id']} {s['name']} wait={s['current_wait_time']}m "
                f"pres={s['pressure_level']}"
                for s in sample
            )
            print(f"[tick] {line}  …")
    except KeyboardInterrupt:
        sim.stop()
        print("\n[simulate] stopped.")


if __name__ == "__main__":
    main()
