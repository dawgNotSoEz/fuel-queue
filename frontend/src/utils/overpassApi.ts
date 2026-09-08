/**
 * FUELWISE — Overpass API client.
 *
 * Fetches REAL stations from OpenStreetMap — completely free, no API key,
 * no account:
 *
 *   • CNG filling stations  → `amenity=fuel` + `fuel:cng=yes`
 *   • EV charging stations  → `amenity=charging_station`
 *
 * Response format: Overpass QL `[out:json]` — an object
 * `{ elements: [{ type, id, lat?, lon?, center?: {lat, lon}, tags? }] }`.
 * We query several public mirrors (CORS-enabled) with a single GET per
 * mirror to avoid preflight.
 *
 * NOTE: live tariffs / queue telemetry don't exist on OSM, so price,
 * wait-time, pressure and EV health are SEEDED from the element id — that
 * keeps them stable for the session and clearly Phase-1 placeholders until
 * Phase 3 connects real telemetry.
 */

import type { ConnectorType, FuelType, PressureLevel, Station, UserLocation } from '../types';
import { haversineKm, round } from './geo';
import { MOCK_STATION_COUNTS, SEARCH_RADIUS_M } from './constants';

/** Public Overpass mirrors; try in order until one responds. */
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Overpass QL — real CNG + EV points/ways within the search radius. */
function buildQuery(lat: number, lng: number, radiusM: number): string {
  return (
    '[out:json][timeout:25];(' +
    `node["amenity"="fuel"]["fuel:cng"](around:${radiusM},${lat},${lng});` +
    `way["amenity"="fuel"]["fuel:cng"](around:${radiusM},${lat},${lng});` +
    `node["amenity"="charging_station"](around:${radiusM},${lat},${lng});` +
    `way["amenity"="charging_station"](around:${radiusM},${lat},${lng});` +
    ');out center;'
  );
}

interface OverpassElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

// ----------------------------------------------------------------------
// Small deterministic helpers (seeded by element id → session-stable)
// ----------------------------------------------------------------------
function hashId(id: number): number {
  let h = (id ^ (id << 13)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return (h ^= h >>> 16) >>> 0;
}

const randInt = (seed: number, min: number, max: number) =>
  min + (seed % (max - min + 1));

function pickFrom<T>(seed: number, list: readonly T[]): T {
  return list[seed % list.length];
}

const CONNECTORS: readonly ConnectorType[] = ['CCS', 'CHAdeMO', 'Type 2'];
const PRESSURE: readonly PressureLevel[] = ['low', 'medium', 'high'];

/** Try each mirror until one returns a usable payload (browser fetch sends its own UA). */
async function queryOverpass(lat: number, lng: number): Promise<OverpassElement[]> {
  let lastError: unknown = null;
  for (const mirror of MIRRORS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000); // fail fast -> fallback
    try {
      const url = `${mirror}?data=${encodeURIComponent(buildQuery(lat, lng, SEARCH_RADIUS_M))}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OverpassResponse;
      if (Array.isArray(json.elements)) return json.elements;
    } catch (err) {
      lastError = err; // try next mirror
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('All Overpass mirrors failed');
}

function elementPoint(el: OverpassElement): { lat: number; lng: number } | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

/** Display name: OSM name > brand + street > readable fallback. */
function displayName(tags: Record<string, string> | undefined, type: FuelType, seed: number): string {
  const label = type === 'CNG' ? 'CNG Station' : 'EV Charger';
  const road = tags?.['addr:street'] || tags?.highway;
  const base = tags?.name || (tags?.brand ? `${tags.brand} ${road ?? ''}`.trim() : '');
  return base || (road ? `${label} · ${road}` : `${label} ${randInt(seed, 1, 999)}`);
}

/** Map raw OSM elements → FUELWISE Station[], nearest-capped per fuel. */
function buildStations(elements: OverpassElement[], center: UserLocation): Station[] {
  const stations: Station[] = [];

  for (const el of elements) {
    const point = elementPoint(el);
    const tags = el.tags ?? {};
    if (!point) continue;

    const isEV = tags.amenity === 'charging_station';
    const seed = hashId(el.id);
    const distanceKm = round(haversineKm(center, point));
    const isOperational = !isEV || seed % 100 >= 18; // ~18% EV "broken", fixed by id
    const type: FuelType = isEV ? 'EV' : 'CNG';

    const base: Station = {
      id: `real_${type.toLowerCase()}_${el.id}`,
      name: displayName(tags, type, seed),
      latitude: round(point.lat, 5),
      longitude: round(point.lng, 5),
      type,
      // Phase-1 placeholder pricing (no live tariffs on OSM).
      price: type === 'CNG' ? randInt(seed, 70, 92) : randInt(seed >>> 3, 17, 27),
      current_wait_time: 0,
      is_operational: isOperational,
      distance_km: distanceKm,
      total_time: 0,
      is_best_choice: false,
      is_worst_choice: false,
    };

    if (type === 'CNG') {
      base.pressure_level = pickFrom(seed, PRESSURE);
      base.current_wait_time = randInt(seed >>> 5, 5, 60);
    } else {
      // Prefer a connector the station actually advertises on OSM, if any.
      const socketKeys = Object.keys(tags).filter((k) => k.startsWith('socket:'));
      const advertised = socketKeys.length
        ? socketKeys.map((k) => k.replace('socket:', '')).find((k) =>
            ['ccs', 'chademo', 'type2'].some((c) => k.toLowerCase().includes(c)),
          )
        : undefined;
      base.connector_type = advertised
        ? advertised.toLowerCase().includes('ccs')
          ? 'CCS'
          : advertised.toLowerCase().includes('chademo')
            ? 'CHAdeMO'
            : 'Type 2'
        : pickFrom(seed >>> 7, CONNECTORS);
      base.current_wait_time = isOperational ? randInt(seed >>> 9, 3, 45) : 0;
    }

    stations.push(base);
  }

  // Nearest-first, capped per fuel type (mirrors the old mock counts).
  const sorter = (a: Station, b: Station) => a.distance_km - b.distance_km;
  const cng = stations.filter((s) => s.type === 'CNG').sort(sorter).slice(0, MOCK_STATION_COUNTS.cng);
  const ev = stations.filter((s) => s.type === 'EV').sort(sorter).slice(0, MOCK_STATION_COUNTS.ev);
  return [...cng, ...ev].sort(sorter);
}

/**
 * Fetch real stations around `center`.
 * @throws when every Overpass mirror is unreachable (caller falls back).
 */
export async function fetchNearbyStations(center: UserLocation): Promise<Station[]> {
  const elements = await queryOverpass(center.lat, center.lng);
  const stations = buildStations(elements, center);
  if (stations.length < 2) throw new Error('No stations found nearby');
  return stations;
}
