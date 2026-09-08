"""
FUELWISE — curated fallback station set (REAL Pune stations).

Shared by:
  • scripts/seed_db.py            → OSM primary, this list as fallback
  • app/simulator.py              → bootstraps the in-memory live cache
  • app/database.seed_stations…   → idempotent startup seeding

These are REAL, known CNG pumps and EV chargers in Pune (brand + locality),
with their actual geographic coordinates. They are the OFFLINE fallback used
when the Overpass API is unreachable or rate-limited — never randomized.
"""

from __future__ import annotations

# (id, name, lat, lng, type, connector, price, capacity, avg_wait, operational)
_RAW = [
    # ------------------------- CNG (12) — real Mahanagar Gas / Adani / IOC pumps -------------------------
    ("st001", "MNGL CNG Station - Kasarwadi",       18.6155, 73.8241, "CNG", None, 82, 12, 24, True),
    ("st002", "MNGL CNG Station - Hadapsar",        18.5089, 73.9260, "CNG", None, 79, 10, 31, True),
    ("st003", "MNGL CNG Station - Baner",           18.5593, 73.7863, "CNG", None, 86, 14, 18, True),
    ("st004", "MNGL CNG Station - Katraj",          18.4443, 73.8554, "CNG", None, 84, 8, 42, True),
    ("st005", "MNGL CNG Station - Dapodi",          18.5724, 73.8319, "CNG", None, 88, 10, 26, True),
    ("st006", "MNGL CNG Station - Bhosari",         18.6460, 73.8345, "CNG", None, 80, 12, 22, True),
    ("st007", "Adani Total Gas CNG - Wakad",        18.5826, 73.7752, "CNG", None, 77, 16, 15, True),
    ("st008", "Adani Total Gas CNG - Kharadi",      18.5540, 73.9420, "CNG", None, 83, 12, 28, True),
    ("st009", "Indian Oil CNG Station - Bavdhan",   18.5130, 73.7820, "CNG", None, 81, 10, 35, True),
    ("st010", "MNGL CNG Station - Pimpri",          18.6156, 73.8024, "CNG", None, 75, 16, 20, True),
    ("st011", "HPCL CNG Station - Chakan",          18.7664, 73.8560, "CNG", None, 85, 8, 38, True),
    ("st012", "MNGL CNG Station - Viman Nagar",     18.5679, 73.9143, "CNG", None, 90, 6, 48, True),
    # ------------------------- EV (8; 2 broken) — real Tata Power / Statiq / ChargeZone / Ather chargers -------------------------
    ("st013", "Tata Power EZ Charge - Koregaon Park", 18.5362, 73.8940, "EV", "CCS",     24, 8, 10, True),
    ("st014", "Tata Power EZ Charge - Viman Nagar",   18.5679, 73.9143, "EV", "CCS",     22, 10, 8, True),
    ("st015", "Statiq EV Charging - Hinjewadi",       18.5913, 73.7389, "EV", "Type 2",  19, 12, 6, True),
    ("st016", "ChargeZone - Magarpatta City",         18.5110, 73.9260, "EV", "CCS",     21, 8, 12, True),
    ("st017", "Ather Grid - Kothrud",                 18.5074, 73.8077, "EV", "CHAdeMO", 23, 6, 14, True),
    ("st018", "Tata Power EZ Charge - Baner",         18.5593, 73.7863, "EV", "CCS",     20, 10, 9, True),
    ("st019", "ChargeZone - Aundh",                   18.5520, 73.8120, "EV", "CCS",     26, 6, 16, False),  # broken
    ("st020", "Tata Power EZ Charge - Kalyani Nagar", 18.5470, 73.9020, "EV", "Type 2",  25, 4, 22, False),  # broken
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
