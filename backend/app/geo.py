"""FUELWISE — lightweight geo helpers shared by routers."""

from __future__ import annotations

import math


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in kilometres."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def drive_time_minutes(distance_km: float, speed_kmh: float = 30.0) -> float:
    """City-driving proxy: 30 km/h average in congested metro areas."""
    return round((distance_km / max(speed_kmh, 1)) * 60, 1)
