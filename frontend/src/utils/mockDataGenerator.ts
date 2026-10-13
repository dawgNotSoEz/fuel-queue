/**
 * FUELWISE — realistic simulated station feed (OFFLINE FALLBACK).
 *
 * `utils/overpassApi.ts` is the primary source: it fetches REAL stations
 * from OpenStreetMap. This module is used only when that fetch fails
 * (no network / all mirrors down) and makes the demo ACT like live data:
 *
 *   • stations scattered realistically within the user's 5–10 km radius
 *   • queue waits random-walked every 5 s (fluctuating queues)
 *   • EV broken status is chosen ONCE per session and never changes
 *   • CNG pressure levels fluctuate on the same cadence
 *   • realistic names ("Pune CNG – Camp", "EV Hub – Koregaon Park")
 */

import type {
  ConnectorType,
  FuelType,
  PressureLevel,
  Station,
  UserLocation,
} from '../types';
import { MOCK_STATION_COUNTS, MAX_STATION_RADIUS_KM } from './constants';
import { expectedWaitMinutes } from './busyness';
import { destinationPoint, haversineKm, round } from './geo';

// ------------------------------------------------------------------
// Random helpers
// ------------------------------------------------------------------
const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (probability: number) => Math.random() < probability;
const pick = <T,>(list: readonly T[]): T =>
  list[Math.floor(Math.random() * list.length)];

/**
 * Seed the live queue from the same past-data curve the "Popular times"
 * histogram uses — the expected wait for this hour, plus a per-station
 * offset so "right now" never looks identical to "usually".
 */
function seedLiveWait(station: Station, spread: number): number {
  const at = new Date();
  const expected = expectedWaitMinutes(station, at.getHours(), at.getDay());
  const offset = 1 + (Math.random() * 2 - 1) * spread;
  return Math.max(0.5, Math.round(expected * offset * 10) / 10);
}

/** Realistic operator words — rendered as "<word> - <area>". */
const CNG_HUBS = [
  'CityGas CNG',
  'GreenFuel CNG',
  'Mahanagar Gas',
  'Adani Gas',
  'Nayara CNG',
  'CNG Express',
  'GasHub',
  'Indraprastha Gas',
] as const;

const EV_HUBS = [
  'EV Hub',
  'VoltZone',
  'ChargePoint',
  'ZapGrid',
  'PowerGrid EV',
  'TurboVolt',
  'Megawatt EV',
  'E-Charge',
] as const;

/** Generic area tokens — work for ANY live location (not Pune-only). */
const AREAS = [
  'City Centre',
  'Railway Station',
  'Airport Road',
  'Market Square',
  'Ring Road',
  'Highway Plaza',
  'North Point',
  'East End',
  'West End',
  'South Side',
  'Old Town',
  'Tech Park',
  'Main Bazaar',
  'Lake View',
  'Metro Station',
  'Industrial Area',
] as const;

const CONNECTORS: readonly ConnectorType[] = ['CCS', 'CHAdeMO', 'Type 2'];

/** Rough proportional outage rate for EV chargers (~18%). */
const EV_OUTAGE_RATE = 0.18;

// ------------------------------------------------------------------
// Station factory
// ------------------------------------------------------------------
function makeStation(
  index: number,
  type: FuelType,
  center: UserLocation,
): Station {
  // Scatter 0.6–10 km away, favouring slightly nearer stations.
  const radiusKm =
    0.6 + Math.pow(Math.random(), 0.75) * (MAX_STATION_RADIUS_KM - 0.6);
  const bearingDeg = Math.random() * 360;
  const pos = destinationPoint(center, radiusKm, bearingDeg);

  const hub = type === 'CNG' ? pick(CNG_HUBS) : pick(EV_HUBS);
  // Realistic, location-agnostic name, e.g. "CityGas CNG - Market Square".
  const name = `${hub} - ${pick(AREAS)}`;

  const distanceKm = round(
    haversineKm(center, { lat: pos.latitude, lng: pos.longitude }),
  );

  // EV outages — offline chargers have no queue.
  const isOperational = type === 'CNG' ? true : !chance(EV_OUTAGE_RATE);

  const base: Station = {
    id: `${type.toLowerCase()}_${String(index + 1).padStart(2, '0')}`,
    name,
    latitude: round(pos.latitude, 5),
    longitude: round(pos.longitude, 5),
    type,
    price: type === 'CNG' ? randInt(70, 92) : randInt(17, 27),
    current_wait_time: 0,
    is_operational: isOperational,
    distance_km: distanceKm,
    total_time: 0,
    is_best_choice: false,
    is_worst_choice: false,
  };

  if (type === 'CNG') {
    // Weighted pressure: mostly medium, some low/high.
    const roll = Math.random();
    base.pressure_level =
      roll < 0.28 ? 'low' : roll < 0.78 ? 'medium' : 'high';
    base.current_wait_time = seedLiveWait(base, 0.25);
  } else {
    base.connector_type = pick(CONNECTORS);
    base.current_wait_time = isOperational ? seedLiveWait(base, 0.3) : 0;
  }

  return base;
}

/**
 * Recompute `total_time` + best/worst flags from scratch.
 * Returns a NEW array (immutable — good for React diffing).
 *
 * Logic (per spec): sort operational stations by (distance + wait).
 * Lowest total  -> is_best_choice  (green outline — "Recommended").
 * Highest total -> is_worst_choice (dashed red outline — "Avoid").
 * Broken / offline stations never win/lose.
 */
export function evaluateStations(input: Station[]): Station[] {
  const flagged = input.map((s) => ({
    ...s,
    total_time: s.is_operational
      ? Math.round(s.distance_km + s.current_wait_time)
      : 0,
    is_best_choice: false,
    is_worst_choice: false,
  }));

  const candidates = flagged.filter((s) => s.is_operational);
  if (candidates.length >= 2) {
    const sorted = [...candidates].sort((a, b) => a.total_time - b.total_time);
    const bestId = sorted[0].id;
    const worstId = sorted[sorted.length - 1].id;
    for (const s of flagged) {
      if (s.id === bestId) s.is_best_choice = true;
      if (s.id === worstId) s.is_worst_choice = true;
    }
  } else if (candidates.length === 1) {
    flagged.find((s) => s.id === candidates[0].id)!.is_best_choice = true;
  }

  return flagged;
}

/**
 * Generate 15–20 stations of each fuel type around `center`.
 * (18 CNG + 16 EV keeps every filtered view comfortably in range.)
 */
export function generateMockStations(
  center: UserLocation,
  counts: { cng?: number; ev?: number } = {},
): Station[] {
  const cng = counts.cng ?? MOCK_STATION_COUNTS.cng;
  const ev = counts.ev ?? MOCK_STATION_COUNTS.ev;

  const cngStations = Array.from({ length: cng }, (_, i) =>
    makeStation(i, 'CNG', center),
  );
  const evStations = Array.from({ length: ev }, (_, i) =>
    makeStation(i, 'EV', center),
  );

  const all = evaluateStations([...cngStations, ...evStations]);
  return all.sort((a, b) => a.distance_km - b.distance_km);
}

/**
 * Live-data simulator: re-roll queue waits and CNG pressure every tick to
 * feel like a fluctuating real feed. EV health is deliberately NOT touched
 * here — broken chargers stay broken for the whole session (see below).
 *
 * The waits are not pure noise: each tick is a random walk that is pulled
 * back towards the station's past-data curve for the current hour, so the
 * live reading always agrees with the "Popular times" histogram instead of
 * saturating at "as busy as it gets".
 */
export function applyLiveTick(prev: Station[]): Station[] {
  if (prev.length === 0) return prev;

  const at = new Date();
  const hour = at.getHours();
  const dayOfWeek = at.getDay();

  const next = prev.map((s) => {
    // Offline chargers never change mid-session (status fixed at creation).
    if (!s.is_operational) return s;

    // ---- Expected wait for this hour, from the station's own past data ----
    const expected = expectedWaitMinutes(s, hour, dayOfWeek);

    // ---- Queue wait: biased random walk + occasional arrival "surge" ----
    let delta = randInt(-3, 3); // slow fluctuation between ticks
    if (chance(0.12)) delta = randInt(-9, 9) >= 0 ? randInt(5, 12) : randInt(-12, -5);
    const pulled = s.current_wait_time + delta + 0.35 * (expected - s.current_wait_time);
    // Headroom above the hourly expectation: the weekly peak can be well
    // above today's value, and a fixed cap would pin busyness at 100%.
    const ceiling = Math.max(s.type === 'CNG' ? 60 : 45, Math.round(expected * 1.6));
    const floor = s.type === 'CNG' ? 2 : 1;
    const current_wait_time =
      Math.round(Math.min(ceiling, Math.max(floor, pulled)) * 10) / 10;

    // ---- CNG pressure: realistic random walk (rarely jumps two steps) ----
    let pressure_level = s.pressure_level;
    if (s.type === 'CNG') {
      const roll = Math.random();
      if (s.pressure_level === 'low') pressure_level = roll < 0.18 ? 'medium' : 'low';
      else if (s.pressure_level === 'high') pressure_level = roll < 0.18 ? 'medium' : 'high';
      else {
        // medium: drifts to low or high over time, sometimes stays.
        pressure_level = roll < 0.14 ? 'low' : roll < 0.28 ? 'high' : 'medium';
      }
    }

    return { ...s, current_wait_time, pressure_level };
  });

  return evaluateStations(next);
}

/** Convenience label for the ambient live-update chip. */
export const LIVE_UPDATE_LABEL = 'Live feed · re-rolls every 5s';
