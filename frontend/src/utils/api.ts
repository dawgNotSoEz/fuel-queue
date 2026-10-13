/**
 * FUELWISE — backend API client (Phase 2).
 *
 * Talks to the FastAPI backend (default http://localhost:8000, override
 * with VITE_API_URL). Backend rows are mapped onto the frontend `Station`
 * contract here.
 */

import type {
  BusynessProfile,
  FuelType,
  HourWindow,
  PressureLevel,
  Station,
  UserLocation,
  WeatherCondition,
} from '../types';
import type { CrowdMix } from './crowdContext';
import { haversineKm, round } from './geo';

/**
 * Backend base URL.
 * - Override with `VITE_API_URL` (e.g. a hosted FastAPI instance).
 * - Local default: http://localhost:8000 — the dev machine running the backend.
 * - Deployed origins use a same-origin `/api` rewrite from the root
 *   `vercel.json`; if that backend is unavailable, the app falls back to
 *   real OpenStreetMap stations + the local live-feel simulator.
 */
export const API_BASE_URL = ((): string => {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv) return fromEnv;
  const { hostname } = window.location;
  const isLocalHost =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return isLocalHost ? 'http://localhost:8000' : '';
})().replace(/\/+$/, '');

/** Abort after N ms so a dead backend fails fast into the local fallback. */
async function fetchJson<T>(path: string, timeoutMs = 6_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

/** POST helper (JSON body). */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

// ----------------------------------------------------------------------
// Station row shape served by the backend (snake_case, superset)
// ----------------------------------------------------------------------
export interface ApiStationRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: FuelType;
  connector_type?: string | null;
  price: number;
  current_wait_time: number;
  pressure_level?: string | null;
  is_operational: boolean;
  distance_km?: number;
  updated_at?: string;
  capacity?: number;
  historical_avg_wait?: number;
}

const isPressure = (v: unknown): v is PressureLevel =>
  v === 'low' || v === 'medium' || v === 'high';

const isConnector = (v: unknown): v is 'CCS' | 'CHAdeMO' | 'Type 2' =>
  v === 'CCS' || v === 'CHAdeMO' || v === 'Type 2';

/** Map a backend row → the frontend Station contract. */
export function toStation(row: ApiStationRow, center: UserLocation): Station {
  const distanceKm =
    row.distance_km ??
    round(haversineKm(center, { lat: row.latitude, lng: row.longitude }));

  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    type: row.type,
    connector_type: isConnector(row.connector_type)
      ? row.connector_type
      : undefined,
    price: row.price,
    current_wait_time: Math.max(0, Math.round(row.current_wait_time)),
    pressure_level: isPressure(row.pressure_level)
      ? row.pressure_level
      : undefined,
    is_operational: Boolean(row.is_operational),
    distance_km: distanceKm,
    total_time: 0, // recomputed by evaluateStations()
    is_best_choice: false,
    is_worst_choice: false,
    capacity: typeof row.capacity === 'number' ? row.capacity : undefined,
    historical_avg_wait:
      typeof row.historical_avg_wait === 'number'
        ? row.historical_avg_wait
        : undefined,
  };
}

export interface FetchStationsOptions {
  lat: number;
  lng: number;
  radiusKm?: number;
  type?: FuelType;
}

/** GET /api/stations (live cache, refreshed every 5 s by the backend sim). */
export async function fetchStationsFromApi({
  lat,
  lng,
  radiusKm,
  type,
}: FetchStationsOptions): Promise<Station[]> {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  if (radiusKm != null) params.set('radius', String(radiusKm));
  if (type) params.set('type', type);

  const body = await fetchJson<{ stations: ApiStationRow[] }>(
    `/api/stations?${params.toString()}`,
  );
  const center: UserLocation = { lat, lng, source: 'user', label: 'API' };
  return (body.stations ?? []).map((row) => toStation(row, center));
}

/** POST /api/report — send a crowd wait observation for retraining. */
export async function postReport(payload: {
  station_id: string;
  wait_time: number;
  pressure?: string;
  user_id?: string;
}): Promise<{ stored: boolean; cache_updated: boolean }> {
  return postJson<{ stored: boolean; cache_updated: boolean }>(
    '/api/report',
    payload,
  );
}

/** GET /api/recommend — Demand Distribution ranking from the backend. */
export interface RecommendRow extends ApiStationRow {
  drive_time_min?: number;
  predicted_wait?: number;
  confidence?: number;
  total_time?: number;
  is_best_choice?: boolean;
  is_worst_choice?: boolean;
}

export async function fetchRecommend(opts: {
  lat: number;
  lng: number;
  type: FuelType;
}): Promise<RecommendRow[]> {
  const params = new URLSearchParams({
    lat: String(opts.lat),
    lng: String(opts.lng),
    type: opts.type,
  });
  const body = await fetchJson<{ stations: RecommendRow[] }>(
    `/api/recommend?${params.toString()}`,
  );
  return body.stations ?? [];
}

/** GET /api/health — cheap reachability probe. */
export async function apiHealth(): Promise<boolean> {
  try {
    await fetchJson<{ status: string }>('/health', 2_500);
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------
// Popular times — GET /api/busyness
//
// The backend builds the hourly histogram with the ML model
// (hour + weekday + weather + pressure + capacity + past-data mean) and
// returns the exact shape the UI renders. The local demand-curve model in
// `utils/busyness.ts` is the offline fallback when this call fails.
// ----------------------------------------------------------------------
export interface ApiHourWindow {
  start: number;
  end: number;
}

export interface ApiBusynessRow {
  station_id?: string | null;
  /** 0 = Sunday … 6 = Saturday, in the *caller's* local time. */
  day_of_week: number;
  /** `weekly[dow][hour]`, 0..100 relative to the station's weekly peak. */
  weekly: number[][];
  daily: number[];
  expected_wait: number[];
  typical_wait_minutes: number;
  weekly_peak_minutes: number;
  peak_hour: number;
  busiest_window: ApiHourWindow;
  quiet_window: ApiHourWindow;
  source?: string;
  model_ready?: boolean;
}

const isNumberGrid = (value: unknown, rows: number, cols: number): boolean =>
  Array.isArray(value) &&
  value.length === rows &&
  value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === cols &&
      row.every((v) => typeof v === 'number' && Number.isFinite(v)),
  );

const isNumberList = (value: unknown, length: number): boolean =>
  Array.isArray(value) &&
  value.length === length &&
  value.every((v) => typeof v === 'number' && Number.isFinite(v));

const toWindow = (value: unknown, fallback: HourWindow): HourWindow => {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as ApiHourWindow).start === 'number' &&
    typeof (value as ApiHourWindow).end === 'number'
  ) {
    return { start: (value as ApiHourWindow).start, end: (value as ApiHourWindow).end };
  }
  return fallback;
};

/** The minimum a station must expose for the busyness endpoint. */
export type BusynessRequestTarget = Pick<Station, 'id' | 'type'> &
  Partial<Pick<Station, 'capacity' | 'historical_avg_wait'>>;

export interface FetchBusynessOptions {
  /** Identifies the station to the model (accepts a full `Station`). */
  station: BusynessRequestTarget;
  /** Local time the profile is for. */
  at: Date;
  /** Day to build the histogram for (0 = Sunday). Defaults to `at.getDay()`. */
  dayOfWeek?: number;
  weather?: WeatherCondition | null;
  /**
   * Real OpenStreetMap crowd mix around the station (utils/crowdContext.ts).
   * The backend mirrors the frontend's crowd model, so sending the mix keeps
   * the API histogram station-specific instead of one shared city curve.
   */
  crowd?: CrowdMix | null;
  /** How crowded that area is (0.55 … 1.75). */
  crowdIntensity?: number | null;
}

/** Compact `category:weight` encoding for the `crowd` query parameter. */
function serialiseCrowd(mix: CrowdMix): string {
  return Object.entries(mix)
    .filter(([, weight]) => weight > 0.01)
    .map(([category, weight]) => `${category}:${weight.toFixed(3)}`)
    .join(',');
}

/**
 * Fetch the model-driven busyness profile for one station.
 * Returns `null` when the backend is down or the payload is unusable, so the
 * caller can fall back to the local crowd-curve model.
 */
export async function fetchBusynessFromApi({
  station,
  at,
  dayOfWeek,
  weather,
  crowd,
  crowdIntensity,
}: FetchBusynessOptions): Promise<BusynessProfile | null> {
  const day = dayOfWeek ?? at.getDay();
  const params = new URLSearchParams({
    station_id: station.id,
    type: station.type,
    hour: String(at.getHours()),
    day_of_week: String(day),
    weather: weather ?? 'clear',
  });
  if (station.historical_avg_wait != null) {
    params.set('historical_avg', String(station.historical_avg_wait));
  }
  if (station.capacity != null) {
    params.set('capacity', String(station.capacity));
  }
  if (crowd) {
    const encoded = serialiseCrowd(crowd);
    if (encoded) params.set('crowd', encoded);
  }
  if (crowdIntensity != null) {
    params.set('crowd_intensity', crowdIntensity.toFixed(2));
  }

  let row: ApiBusynessRow;
  try {
    row = await fetchJson<ApiBusynessRow>(`/api/busyness?${params.toString()}`);
  } catch {
    return null;
  }

  if (
    !isNumberGrid(row.weekly, 7, 24) ||
    !isNumberList(row.daily, 24) ||
    !isNumberList(row.expected_wait, 24) ||
    typeof row.typical_wait_minutes !== 'number' ||
    typeof row.weekly_peak_minutes !== 'number'
  ) {
    return null;
  }

  return {
    weekly: row.weekly,
    daily: row.daily,
    expectedWait: row.expected_wait,
    typicalWaitMinutes: row.typical_wait_minutes,
    peakWaitMinutes: row.weekly_peak_minutes,
    peakHour:
      typeof row.peak_hour === 'number' ? row.peak_hour : row.daily.indexOf(Math.max(...row.daily)),
    busiestWindow: toWindow(row.busiest_window, { start: 17, end: 19 }),
    quietWindow: toWindow(row.quiet_window, { start: 14, end: 16 }),
    dayOfWeek: typeof row.day_of_week === 'number' ? row.day_of_week : day,
    source: 'ml',
  };
}

