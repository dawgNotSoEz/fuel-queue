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
  /** Bays/pumps available — used by the busyness + prediction models. */
  capacity?: number;
  /**
   * Past-data anchor: the rolling mean wait for this station (minutes).
   * Crowd reports on the backend keep it up to date, so the popular-times
   * histogram is always derived from observed history, never from noise.
   */
  historical_avg_wait?: number;
}

// ----------------------------------------------------------------------
// Popular times (Google-Maps-style busyness)
// ----------------------------------------------------------------------

/** How busy a station is right now, relative to its own past peak. */
export type BusynessLevel = 'not-busy' | 'moderate' | 'busy' | 'peak';

/** Live busyness reading for a single station. */
export interface LiveBusyness {
  /** 0..130, where 100 = "as busy as it gets" for this station. */
  percent: number;
  level: BusynessLevel;
  /** Google-style headline, e.g. "Busy". */
  headline: string;
  /** Live wait vs the typical wait for this weekday + hour. */
  comparison: 'less' | 'usual' | 'more';
  comparisonLabel: string;
  trend: 'rising' | 'falling' | 'steady';
  trendLabel: string;
  /** Live wait right now, minutes. */
  liveWait: number;
  /** Typical wait for this weekday + hour, minutes. */
  expectedWait: number;
  /** Live wait / typical wait. */
  ratio: number;
}

/** A station's weekly busyness profile ("popular times"). */
export interface BusynessProfile {
  /** `weekly[dow][hour]` — 0..100 relative to this station's weekly peak. */
  weekly: number[][];
  /** The selected day's 24 bars. */
  daily: number[];
  /** Typical wait (minutes) for each hour of the selected day. */
  expectedWait: number[];
  /** Past-data mean wait for this station, minutes. */
  typicalWaitMinutes: number;
  /** Typical wait at the station's weekly peak, minutes. */
  peakWaitMinutes: number;
  /** Busiest hour of the selected day (0..23). */
  peakHour: number;
  /** Busiest two-hour window of the selected day. */
  busiestWindow: HourWindow;
  /** Quietest two-hour window of the selected day. */
  quietWindow: HourWindow;
  /** Weekday the profile was built for (0 = Sunday, local time). */
  dayOfWeek: number;
  /** 'ml' when the backend model produced it, 'model' for the local curve. */
  source: 'ml' | 'model';
}

/** Inclusive-exclusive hour range, e.g. { start: 14, end: 16 } → 2–4 PM. */
export interface HourWindow {
  start: number;
  end: number;
}

// ----------------------------------------------------------------------
// Free live context: weather (Open-Meteo)
// ----------------------------------------------------------------------

export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm';

export interface WeatherSnapshot {
  condition: WeatherCondition;
  label: string;
  temperatureC: number;
  windKmh: number;
  /** Epoch ms of the observation. */
  observedAt: number;
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
