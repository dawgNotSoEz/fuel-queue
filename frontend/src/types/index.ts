/**
 * FUELWISE — shared domain types.
 * The frontend contract mirrors `backend/app/models.py` 1:1 so Phase 2 can
 * swap mock data for real API responses with zero UI changes.
 */

export type FuelType = 'CNG' | 'EV';

/** EV charging plug standards (EV stations only). */
export type ConnectorType = 'CCS' | 'CHAdeMO' | 'Type 2';

/** CNG dispenser pressure readings. */
export type PressureLevel = 'low' | 'medium' | 'high';

/** Where the map centre came from. */
export type LocationSource = 'user';

export interface UserLocation {
  lat: number;
  lng: number;
  /** Geolocation accuracy in metres. */
  accuracy?: number;
  /** This app only renders a location obtained from the user's device. */
  source: LocationSource;
  /** Human-readable label shown in the UI. */
  label: string;
}

/**
 * A CNG or EV refuelling station as rendered on the map.
 *
 * `current_wait_time` (minutes) is the latest-known queue estimate — in
 * Phase 1 it is re-rolled every ~10 s by the live-data simulator.
 */
export interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: FuelType;
  /** EV only — charging plug standard. */
  connector_type?: ConnectorType;
  /** ₹ per kg (CNG) or ₹ per kWh (EV). */
  price: number;
  /** Estimated queue wait in minutes (0 when offline). */
  current_wait_time: number;
  /** CNG only — low / medium / high. */
  pressure_level?: PressureLevel;
  /** Some EV chargers are deliberately offline to simulate an ~18% outage rate. */
  is_operational: boolean;
  /** Great-circle distance from the user, km. */
  distance_km: number;
  /** drive time proxy (km ≈ minutes) + predicted wait, minutes. */
  total_time: number;
  /** Lowest distance + wait among operational stations (thick white stroke). */
  is_best_choice: boolean;
  /** Highest distance + wait among operational stations (dashed gray stroke). */
  is_worst_choice: boolean;
}

/** Mock authentication payload used until Phase 3 wiring. */
export interface MockUser {
  mode: 'guest' | 'signed-in';
  name: string;
  initials: string;
}

/** Env vars exposed by Vite from the shared root `.env` (VITE_-prefixed). */
interface ImportMetaEnv {
  readonly VITE_MAP_CENTER_LAT?: string;
  readonly VITE_MAP_CENTER_LNG?: string;
  readonly VITE_DEFAULT_ZOOM?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_VOICE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
