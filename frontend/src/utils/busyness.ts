/**
 * FUELWISE — popular times & live busyness engine (Google-Maps-style).
 *
 * Everything here is free and key-free: it runs locally from data the app
 * already has, and the backend exposes the same maths through
 * `GET /api/busyness` (anchored by the ML model) when it is reachable.
 *
 * HOW THE HISTOGRAM IS DERIVED FROM REAL DATA
 * -------------------------------------------
 *  1. `crowdContext.ts` reads the ACTUAL places around the station from
 *     OpenStreetMap — retail, offices, markets, transit stops, schools,
 *     restaurants, clinics, homes, industry and through-traffic — and turns
 *     them into a category mix plus an intensity.
 *  2. Each category carries its own weekly and hourly rhythm, so summing the
 *     categories a station really sits in gives that station its own curve —
 *     and its own shape for every weekday. No two pumps share a histogram.
 *  3. The station's own past data (`historical_avg_wait`, a rolling mean
 *     that crowd reports keep updating) sets the absolute scale, adjusted by
 *     how crowded the surrounding area actually is.
 *  4. Bars are percentages of the station's weekly peak, exactly how Google
 *     normalises "popular times", so days stay comparable.
 *
 * `liveBusyness()` then compares the *live* queue reading with that
 * past-data baseline and says, in words, whether the pump area is busy right
 * now, how it compares with usual, and which way it is heading.
 */

import type {
  BusynessLevel,
  BusynessProfile,
  FuelType,
  HourWindow,
  LiveBusyness,
  Station,
  WeatherCondition,
} from '../types';
import {
  CROWD_CATEGORIES,
  EMPTY_MIX,
  blendMix,
  crowdReadingFor,
  crowdWeeklyProfile,
  normaliseMix,
  type CrowdMix,
} from './crowdContext';

export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;

/** Column headers for the day picker (0 = Sunday, JS convention). */
export const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Typical day-long wait bands per fuel type (used when history is absent). */
const TYPICAL_BANDS: Record<FuelType, [number, number]> = {
  CNG: [12, 38],
  EV: [5, 22],
};

/** Weather multipliers — rain and storms lengthen queues (free Open-Meteo). */
const WEATHER_FACTOR: Record<WeatherCondition, number> = {
  clear: 1,
  cloudy: 1.03,
  rain: 1.18,
  fog: 1.1,
  storm: 1.32,
};

export const WEATHER_LABEL: Record<WeatherCondition, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  rain: 'Rain',
  fog: 'Fog',
  storm: 'Storm',
};

// ----------------------------------------------------------------------
// Small deterministic helpers
// ----------------------------------------------------------------------
/** 32-bit string hash — stable per station id, no RNG drift across renders. */
export function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// ----------------------------------------------------------------------
// Per-station scale — past data × the real crowd around the pump
// ----------------------------------------------------------------------
/**
 * The old implementation kept a single city-wide demand curve here, which is
 * exactly why every pump showed the same histogram. That job now belongs to
 * `crowdContext.ts`, which builds a curve per station from the places really
 * mapped around it — so this file only owns the scale and the wording.
 */
/** A generic city mix, used only to season sparse areas (never dominant). */
const CITY_BASELINE_MIX: CrowdMix = normaliseMix({
  ...EMPTY_MIX,
  residential: 0.3,
  transport: 0.25,
  retail: 0.2,
  office: 0.15,
  dining: 0.1,
});

/** Blend a station's real OSM mix with the baseline so sparse data still works. */
export function stationCrowdMix(realMix: CrowdMix): CrowdMix {
  return blendMix(realMix, CITY_BASELINE_MIX, 0.25);
}

/** The real crowd mix + intensity around a station (see crowdContext.ts). */
export function stationCrowd(station: Station) {
  return crowdReadingFor(station);
}

/** Past-data mean wait for a station (minutes), scaled by its real crowd. */
export function stationTypicalWait(station: Station): number {
  const reported = station.historical_avg_wait;
  const crowd = crowdReadingFor(station);

  let base: number;
  if (typeof reported === 'number' && reported > 0) {
    base = Math.round(reported * 10) / 10;
  } else {
    // No history yet (e.g. a brand-new OSM station): spread deterministically
    // inside the fuel type's band so the profile is still stable per station.
    const [low, high] = TYPICAL_BANDS[station.type];
    const span = Math.round((high - low) * 10);
    const offset = (stableHash(station.id) % (span + 1)) / 10;
    base = Math.round((low + offset) * 10) / 10;
  }

  // Reported history stays authoritative, but is nudged towards the real
  // crowd around the pump; with no history the crowd owns the scale outright.
  const crowdScale =
    typeof reported === 'number' && reported > 0
      ? 1 + (crowd.intensity - 1) * 0.5
      : crowd.intensity;

  const [low, high] = TYPICAL_BANDS[station.type];
  const scaled = base * crowdScale;
  return Math.round(Math.min(Math.max(scaled, low * 0.4), high * 2.4) * 10) / 10;
}

/** The station's crowd-shaped demand curve for one day (mean = 1.0). */
export function stationDayShape(station: Station, dayOfWeek: number): number[] {
  const mix = stationCrowdMix(crowdReadingFor(station).mix);
  const day = ((dayOfWeek % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return crowdWeeklyProfile(mix).shape[day];
}

/** Typical (past-data) wait for a station at a given weekday + hour. */
export function expectedWaitMinutes(
  station: Station,
  hour: number,
  dayOfWeek: number,
  weather: WeatherCondition = 'clear',
): number {
  const shape = stationDayShape(station, dayOfWeek)[hour % HOURS_PER_DAY];
  const value = stationTypicalWait(station) * shape * WEATHER_FACTOR[weather];
  return Math.round(value * 10) / 10;
}

/** How much longer queues run in this weather, e.g. 0.18 → "+18%". */
export function weatherQueueImpact(condition: WeatherCondition): number {
  return WEATHER_FACTOR[condition] - 1;
}

// ----------------------------------------------------------------------
// Windows + labels
// ----------------------------------------------------------------------
/** Index of the quietest `length`-hour window, ignoring the small hours. */
function quietestWindow(curve: number[], length = 2): HourWindow {
  let bestStart = 5;
  let bestSum = Number.POSITIVE_INFINITY;
  for (let start = 5; start + length <= 22; start++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += curve[start + i];
    if (sum < bestSum) {
      bestSum = sum;
      bestStart = start;
    }
  }
  return { start: bestStart, end: bestStart + length };
}

/** Index of the busiest `length`-hour window of the day. */
function busiestWindow(curve: number[], length = 2): HourWindow {
  let bestStart = 0;
  let bestSum = Number.NEGATIVE_INFINITY;
  for (let start = 0; start + length <= HOURS_PER_DAY; start++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += curve[start + i];
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = start;
    }
  }
  return { start: bestStart, end: bestStart + length };
}

/** "6 AM" / "12 PM" */
export function hourLabel(hour: number): string {
  const h = ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2 PM – 4 PM" */
export function windowLabel(window: HourWindow): string {
  return `${hourLabel(window.start)} – ${hourLabel(window.end)}`;
}

/** Google-style tooltip copy for a historical bar. */
export function describeBar(percent: number): string {
  if (percent < 20) return 'usually not busy';
  if (percent < 40) return 'usually a little busy';
  if (percent < 60) return 'usually busy';
  if (percent < 85) return 'usually very busy';
  return 'usually as busy as it gets';
}

/** Google-style headline for a live reading. */
export function busynessHeadline(percent: number): string {
  if (percent < 25) return 'Not busy';
  if (percent < 60) return 'A little busy';
  if (percent < 88) return 'Busy';
  return 'As busy as it gets';
}

export function busynessLevel(percent: number): BusynessLevel {
  if (percent < 25) return 'not-busy';
  if (percent < 60) return 'moderate';
  if (percent < 88) return 'busy';
  return 'peak';
}

/** Tailwind classes per busyness level (text + bar + soft chip). */
export const BUSYNESS_STYLE: Record<
  BusynessLevel,
  { text: string; bar: string; chip: string; dot: string; hex: string }
> = {
  'not-busy': {
    text: 'text-success',
    bar: 'bg-success',
    chip: 'border-success bg-success-soft text-success',
    dot: 'bg-success',
    hex: '#16a34a',
  },
  moderate: {
    text: 'text-warn',
    bar: 'bg-warn',
    chip: 'border-warn bg-warn-soft text-warn',
    dot: 'bg-warn',
    hex: '#d97706',
  },
  busy: {
    text: 'text-cng',
    bar: 'bg-cng',
    chip: 'border-cng bg-orange-50 text-orange-700',
    dot: 'bg-cng',
    hex: '#f97316',
  },
  peak: {
    text: 'text-danger',
    bar: 'bg-danger',
    chip: 'border-danger bg-danger-soft text-danger-dark',
    dot: 'bg-danger',
    hex: '#dc2626',
  },
};

// ----------------------------------------------------------------------
// Profile construction (local model)
// ----------------------------------------------------------------------
function profileKey(stationId: string, dayOfWeek: number): string {
  return `${stationId}|${dayOfWeek}`;
}

const profileCache = new Map<string, BusynessProfile>();

/**
 * Build the weekly profile from the real crowd around the station.
 *
 * Every bar comes from `crowdWeeklyProfile()` — the categories mapped within
 * a kilometre of THIS pump — so the histogram differs station by station and
 * weekday by weekday (offices make Monday mornings sharp, markets make
 * Saturday mornings sharp, restaurants make evenings sharp, and so on).
 */
export function buildBusynessProfile(
  station: Station,
  dayOfWeek: number,
): BusynessProfile {
  const key = profileKey(station.id, dayOfWeek);
  const cached = profileCache.get(key);
  if (cached) return cached;

  const day = ((dayOfWeek % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const mean = stationTypicalWait(station);
  const mix = stationCrowdMix(crowdReadingFor(station).mix);
  const { raw, peak, shape } = crowdWeeklyProfile(mix);

  const weekly = raw.map((dayHours) =>
    dayHours.map((value) =>
      clamp(Math.round((100 * value) / (peak || 1)), 2, 100),
    ),
  );

  const shapeToday = shape[day];
  const daily = weekly[day];
  const expectedWait = shapeToday.map(
    (value) => Math.round(mean * value * 10) / 10,
  );

  const peakShape = shape.reduce(
    (max, dayHours) => Math.max(max, ...dayHours),
    0,
  );

  let peakHour = 0;
  for (let hour = 1; hour < HOURS_PER_DAY; hour++) {
    if (shapeToday[hour] > shapeToday[peakHour]) peakHour = hour;
  }

  const profile: BusynessProfile = {
    weekly,
    daily,
    expectedWait,
    typicalWaitMinutes: mean,
    peakWaitMinutes: Math.round(mean * peakShape * 10) / 10,
    peakHour,
    busiestWindow: busiestWindow(shapeToday, 2),
    quietWindow: quietestWindow(shapeToday, 2),
    dayOfWeek: day,
    source: 'model',
  };

  profileCache.set(key, profile);
  return profile;
}

/** Drop every cached profile (used when the crowd index changes). */
export function forgetAllProfiles(): void {
  profileCache.clear();
}

/** Cache a profile produced by the backend model (`GET /api/busyness`). */
export function rememberApiProfile(
  stationId: string,
  profile: BusynessProfile,
): void {
  profileCache.set(profileKey(stationId, profile.dayOfWeek), profile);
}

/** Drop cached profiles for a station (used when its history changes). */
export function forgetStationProfiles(stationId: string): void {
  for (const key of profileCache.keys()) {
    if (key.startsWith(`${stationId}|`)) profileCache.delete(key);
  }
}

// ----------------------------------------------------------------------
// Live reading
// ----------------------------------------------------------------------
export interface LiveBusynessInputs {
  station: Station;
  profile: BusynessProfile;
  /** Defaults to "now". */
  at?: Date;
}

/**
 * Compare the live queue with the station's own past data and describe the
 * result the way Google Maps describes "live busyness".
 */
export function liveBusyness({
  station,
  profile,
  at = new Date(),
}: LiveBusynessInputs): LiveBusyness {
  const hour = at.getHours();
  const liveWait = Math.max(0, station.current_wait_time);

  // Typical wait for this weekday + hour, straight from this station's own
  // crowd-shaped profile, so the live reading can never contradict the bar the
  // user is looking at. The comparison stays weather-free (rain is reported
  // separately) so "busier than usual" always means the queue itself is
  // unusual.
  const expectedRaw =
    typeof profile.expectedWait?.[hour] === 'number'
      ? profile.expectedWait[hour]
      : profile.typicalWaitMinutes;
  const expectedWait = Math.round(expectedRaw * 10) / 10;

  const peakMinutes = Math.max(profile.peakWaitMinutes, 1);
  const percent = clamp(Math.round((100 * liveWait) / peakMinutes), 0, 130);

  const ratio = expectedRaw > 0.05 ? liveWait / expectedRaw : 1;

  const comparison: LiveBusyness['comparison'] =
    ratio < 0.8 ? 'less' : ratio <= 1.25 ? 'usual' : 'more';
  const comparisonLabel =
    comparison === 'less'
      ? 'Less busy than usual'
      : comparison === 'usual'
        ? 'About as busy as usual'
        : 'Busier than usual';

  // Trend: where *this station's* expected curve is heading over the next hour.
  const nextIndex = (hour + 1) % HOURS_PER_DAY;
  const nextExpected =
    typeof profile.expectedWait?.[nextIndex] === 'number'
      ? profile.expectedWait[nextIndex]
      : expectedRaw;
  const slope = (nextExpected - expectedRaw) / (expectedRaw || 1);
  const trend: LiveBusyness['trend'] =
    ratio >= 1.15 && slope >= -0.05
      ? 'rising'
      : slope > 0.1
        ? 'rising'
        : slope < -0.1
          ? 'falling'
          : 'steady';
  const trendLabel =
    trend === 'rising'
      ? 'getting busier'
      : trend === 'falling'
        ? 'clearing up'
        : 'steady';

  return {
    percent,
    level: busynessLevel(percent),
    headline: busynessHeadline(percent),
    comparison,
    comparisonLabel,
    trend,
    trendLabel,
    liveWait,
    expectedWait,
    ratio,
  };
}

/** Convenience: profile + live reading in one call (local model only). */
export function localBusyness(
  station: Station,
  at: Date = new Date(),
): { profile: BusynessProfile; live: LiveBusyness } {
  const profile = buildBusynessProfile(station, at.getDay());
  return { profile, live: liveBusyness({ station, profile, at }) };
}

/** Google-style "Busy now · less busy than usual · getting busier". */
export function busynessSummary(live: LiveBusyness): string {
  return `${live.headline} · ${live.comparisonLabel.toLowerCase()} · ${live.trendLabel}`;
}
