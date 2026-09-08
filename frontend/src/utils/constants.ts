/**
 * FUELWISE — static app constants & env-driven defaults.
 * Maps are free: React Leaflet + OpenStreetMap, no API keys required.
 */

export const FALLBACK_CENTER = {
  lat: 18.5204,
  lng: 73.8567,
  /** Default city centre used when geolocation is denied (Pune). */
  label: 'Pune · Demo Region',
} as const;

/** Station cloud radius bounds (km). */

export const MAX_STATION_RADIUS_KM = 10;

/** Real-station search radius around the user, metres (Overpass). */
export const SEARCH_RADIUS_M = 10_000;

/** Live simulator cadence — wait times re-roll every 5 s. */
export const SIMULATION_INTERVAL_MS = 5_000;

/** How many stations we generate / cap per fuel type. */
export const MOCK_STATION_COUNTS = { cng: 18, ev: 16 } as const;

/** Backend base URL (override with VITE_API_URL). */
export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

/**
 * Fallback centre resolved from the shared root `.env`
 * (VITE_MAP_CENTER_LAT / VITE_MAP_CENTER_LNG).
 */
export function resolveEnvCenter(): { lat: number; lng: number } {
  const rawLat = import.meta.env.VITE_MAP_CENTER_LAT;
  const rawLng = import.meta.env.VITE_MAP_CENTER_LNG;
  const lat = Number.parseFloat(rawLat ?? '');
  const lng = Number.parseFloat(rawLng ?? '');
  const valid = Number.isFinite(lat) && Number.isFinite(lng);
  return valid
    ? { lat, lng }
    : { lat: FALLBACK_CENTER.lat, lng: FALLBACK_CENTER.lng };
}

/** Default zoom before the map auto-fits the station cloud (env-driven). */
export function resolveDefaultZoom(): number {
  const raw = Number.parseInt(import.meta.env.VITE_DEFAULT_ZOOM ?? '', 10);
  const valid = Number.isInteger(raw) && raw >= 3 && raw <= 18;
  return valid ? raw : 13;
}

export const DEFAULT_ZOOM = resolveDefaultZoom();
