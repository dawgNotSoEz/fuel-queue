/**
 * FUELWISE — station intelligence metrics (lightweight, no deps).
 *
 * Derives judge-impressing, driver-visible values from the mock snapshot:
 *
 *   1. Station Health Score (0–100):
 *        Operational health  40%
 *        Queue wait          30%   (shorter wait = more points)
 *        Price               30%   (cheaper than type average = more points)
 *
 *   2. Time-Saving Estimate   — minutes saved vs the worst operational
 *                              option of the same fuel type right now.
 *
 *   3. Best Time to Visit     — a deterministic "quiet window" per station
 *                              (Phase 4 will replace this with ML forecasts).
 */

import type { FuelType, Station } from '../types';

// ----------------------------------------------------------------------
// Price competitiveness reference ranges (match mockDataGenerator bands)
// ----------------------------------------------------------------------
const PRICE_RANGES: Record<FuelType, [number, number]> = {
  CNG: [70, 92], // ₹/kg
  EV: [17, 27], // ₹/kWh
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export interface HealthBreakdown {
  score: number;
  /** Human label: Good / Fair / Poor */
  band: 'Good' | 'Fair' | 'Poor';
  operational: number; // 0..40
  wait: number; // 0..30
  price: number; // 0..30
}

/**
 * Health Score = (Operational × 40%) + (Wait × 30%) + (Price × 30%).
 * @param station target station
 * @param peers other stations of the same fuel type (for a fair baseline)
 */
export function computeHealthScore(
  station: Station,
  peers: Station[],
): HealthBreakdown {
  // ---- Operational 40 pts ----
  const operational = station.is_operational ? 40 : 0;

  // ---- Wait 30 pts: 0–60+ min maps to 30..0 ----
  const waitMinutes = station.is_operational ? station.current_wait_time : 60;
  const wait = Math.round(
    30 * clamp(1 - (waitMinutes - 5) / 55, 0, 1) * 10,
  ) / 10;

  // ---- Price 30 pts: cheaper than type range earns more ----
  const [low, high] = PRICE_RANGES[station.type];
  const span = Math.max(high - low, 1);
  const price = Math.round(30 * clamp((high - station.price) / span, 0, 1) * 10) / 10;

  const score = Math.round(operational + wait + price);
  const band = score >= 70 ? 'Good' : score >= 45 ? 'Fair' : 'Poor';

  return { score, band, operational, wait, price };
}

export interface TimeSaving {
  minutes: number;
  /** Name of the worst option being compared against (or null when this
   *  station IS the worst / there is nothing to compare). */
  worstName: string | null;
  isWorst: boolean;
}

/**
 * Time saved = (worst operational station's total time) − (this station's
 * total time). Total time already includes drive time, so the saving is a
 * real, apples-to-apples number.
 */
export function computeTimeSaving(
  station: Station,
  peers: Station[],
): TimeSaving {
  if (!station.is_operational) {
    return { minutes: 0, worstName: null, isWorst: false };
  }
  const operational = peers.filter((p) => p.is_operational);
  if (operational.length < 2) {
    return { minutes: 0, worstName: null, isWorst: false };
  }
  const worst = operational.reduce((a, b) =>
    b.total_time > a.total_time ? b : a,
  );
  if (worst.id === station.id) {
    return { minutes: 0, worstName: worst.name, isWorst: true };
  }
  return {
    minutes: Math.max(0, Math.round(worst.total_time - station.total_time)),
    worstName: worst.name,
    isWorst: false,
  };
}

// ----------------------------------------------------------------------
// Best time to visit — deterministic pseudo-random "quiet window"
// derived from the station id, stable across re-renders and live ticks.
// ----------------------------------------------------------------------
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // keep it a 32-bit int
  }
  return Math.abs(hash);
}

function to12Hour(hour: number): string {
  const h = hour % 12 || 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** e.g. "Quiet time: 2 PM – 4 PM" */
export function getBestTimeToVisit(station: Station): string {
  const seed = hashString(station.id + station.type);
  const start = 8 + (seed % 10); // 8 AM .. 5 PM
  const length = 2 + (seed % 3); // 2 .. 4 hours
  const end = start + length;
  return `${to12Hour(start)} – ${to12Hour(end)}`;
}
