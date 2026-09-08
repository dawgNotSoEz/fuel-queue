/**
 * FUELWISE — backend API client (Phase 2).
 *
 * Talks to the FastAPI backend (default http://localhost:8000, override
 * with VITE_API_URL). Backend rows are mapped onto the frontend `Station`
 * contract here.
 */

import type { FuelType, PressureLevel, Station, UserLocation } from '../types';
import { haversineKm, round } from './geo';

/**
 * Backend base URL.
 * - Override with `VITE_API_URL` (e.g. a hosted FastAPI instance).
 * - Local default: http://localhost:8000 — the dev machine running the backend.
 * - Deployed origins (Vercel & friends) have NO reachable backend, so this
 *   resolves to "" and fetchJson() throws immediately → the app falls back to
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
  if (!API_BASE_URL) {
    throw new Error('FUELWISE backend not configured (set VITE_API_URL).');
  }
  if (!API_BASE_URL) {
    throw new Error('FUELWISE backend not configured (set VITE_API_URL).');
  }
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
  const center: UserLocation = { lat, lng, source: 'fallback', label: 'API' };
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

