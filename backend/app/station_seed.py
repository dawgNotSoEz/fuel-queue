"""
FUELWISE — canonical 20-station seed set (Pune demo region).

Shared by:
  • scripts/seed_db.py            → inserts into PostgreSQL (stations table)
  • app/simulator.py              → bootstraps the in-memory live cache
  • app/database.seed_stations…   → idempotent startup seeding

Coordinates are real Pune localities spread across a ~10 km radius, which
keeps the Phase-1 frontend mock and the backend in agreement.
"""

from __future__ import annotations

# (id, name, lat, lng, type, connector, price, capacity, avg_wait, operational)
_RAW = [
    # ------------------------- CNG (12) -------------------------
    ("st001", "Pune CNG - Camp",            18.5120, 73.8777, "CNG", None, 82, 12, 24, True),
    ("st002", "Pune CNG - Swargate",        18.5010, 73.8529, "CNG", None, 79, 10, 31, True),
    ("st003", "Pune CNG - Kothrud",         18.5074, 73.8077, "CNG", None, 86, 14, 18, True),
    ("st004", "Pune CNG - Karve Nagar",     18.4873, 73.8217, "CNG", None, 84, 8, 42, True),
    ("st005", "Pune CNG - Deccan",          18.5196, 73.8430, "CNG", None, 88, 10, 26, True),
    ("st006", "Pune CNG - Shivajinagar",    18.5308, 73.8472, "CNG", None, 80, 12, 22, True),
    ("st007", "Mahanagar Gas - Aundh",      18.5590, 73.8077, "CNG", None, 77, 16, 15, True),
    ("st008", "Adani Gas - Baner",          18.5593, 73.7863, "CNG", None, 83, 12, 28, True),
    ("st009", "Nayara CNG - Wakad",         18.5826, 73.7752, "CNG", None, 81, 10, 35, True),
    ("st010", "CNG Express - Pimpri",       18.6156, 73.8024, "CNG", None, 75, 16, 20, True),
    ("st011", "PuneGas - Hadapsar",         18.5089, 73.9260, "CNG", None, 85, 8, 38, True),
    ("st012", "GreenFuel CNG - Warje",      18.4806, 73.8006, "CNG", None, 90, 6, 48, True),
    # ------------------------- EV (8; 2 broken) -------------------------
    ("st013", "EV Hub - Koregaon Park",     18.5362, 73.8940, "EV", "CCS",     24, 8, 10, True),
    ("st014", "VoltZone - Viman Nagar",     18.5679, 73.9143, "EV", "CCS",     22, 10, 8, True),
    ("st015", "ChargePoint - Hinjewadi",    18.5913, 73.7389, "EV", "Type 2",  19, 12, 6, True),
    ("st016", "ZapGrid - Bavdhan",          18.5130, 73.7820, "EV", "CCS",     21, 8, 12, True),
    ("st017", "PowerGrid EV - Kothrud",     18.5152, 73.8053, "EV", "CHAdeMO", 23, 6, 14, True),
    ("st018", "E-Charge - Aundh",           18.5520, 73.8120, "EV", "CCS",     20, 10, 9, True),
    ("st019", "Megawatt EV - Swargate",     18.4990, 73.8580, "EV", "CCS",     26, 6, 16, False),  # broken
    ("st020", "TurboVolt - Hadapsar",       18.5150, 73.9210, "EV", "Type 2",  25, 4, 22, False),  # broken
]

STATION_SEEDS: list[dict] = [
    {
        "id": row[0],
        "name": row[1],
        "latitude": row[2],
        "longitude": row[3],
        "type": row[4],
        "connector_type": row[5],
        "price": row[6],
        "capacity": row[7],
        "historical_avg_wait": row[8],
        "is_operational": row[9],
    }
    for row in _RAW
]
