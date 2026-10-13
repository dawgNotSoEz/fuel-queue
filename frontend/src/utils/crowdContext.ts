/**
 * FUELWISE — "who is actually around this pump" engine (real OSM data).
 *
 * WHY THIS EXISTS
 * ---------------
 * Busyness used to be one city-wide curve scaled per station, so every pump
 * showed the SAME histogram shape and every weekday looked identical. Real
 * crowd data fixes that: this module counts the actual people-generating
 * places around each station — retail, offices, markets, transit stops,
 * schools, restaurants, hospitals, residential blocks — straight from
 * OpenStreetMap (free, no key, no signup).
 *
 * Each place category carries its own weekly and hourly rhythm:
 *   • offices and schools load the morning commute, on weekdays only;
 *   • markets peak early and hardest at weekends;
 *   • restaurants, malls and cinemas build through the evening;
 *   • transit stops and highways double-peak every single day.
 *
 * Summing the categories actually present around a station yields that
 * station's own curve, and its own shape for every weekday — which is what
 * makes "busy now" genuinely differ from pump to pump and day to day.
 *
 * HONESTY NOTE
 * ------------
 * There is no free source of measured footfall (Google's popular times are
 * not in the public Places API). So the *mix* — which categories, how many,
 * how close — is real OSM geography, while the hourly rhythm of each
 * category is a model. Station ranking and intensity come from the real
 * geography, never from a shared template.
 */

import type { Station, UserLocation } from '../types';
import { haversineKm } from './geo';

// ----------------------------------------------------------------------
// Categories + their real-world rhythms
// ----------------------------------------------------------------------
export type CrowdCategory =
  | 'transport'
  | 'office'
  | 'retail'
  | 'market'
  | 'education'
  | 'dining'
  | 'health'
  | 'leisure'
  | 'residential'
  | 'industry'
  | 'worship'
  | 'highway';

export const CROWD_CATEGORIES: readonly CrowdCategory[] = [
  'transport',
  'office',
  'retail',
  'market',
  'education',
  'dining',
  'health',
  'leisure',
  'residential',
  'industry',
  'worship',
  'highway',
] as const;

/** Human-readable label for a category (used in the "why busy" copy). */
export const CROWD_LABEL: Record<CrowdCategory, string> = {
  transport: 'transit stops',
  office: 'offices',
  retail: 'shops',
  market: 'markets',
  education: 'schools',
  dining: 'restaurants',
  health: 'clinics',
  leisure: 'leisure spots',
  residential: 'homes',
  industry: 'industry',
  worship: 'places of worship',
  highway: 'the highway',
};

/** A station's crowd composition — category weights, summing to 1. */
export type CrowdMix = Record<CrowdCategory, number>;

export const EMPTY_MIX: CrowdMix = CROWD_CATEGORIES.reduce((acc, category) => {
  acc[category] = 0;
  return acc;
}, {} as CrowdMix);

// ----------------------------------------------------------------------
// Hourly helpers
// ----------------------------------------------------------------------
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Shortest distance between two hours on a 24-hour clock. */
function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % HOURS_PER_DAY;
  return Math.min(d, HOURS_PER_DAY - d);
}

/** Gaussian bump centred on `centre` (hours), wrapping past midnight. */
function bump(hour: number, centre: number, width: number, height: number) {
  const d = hourDistance(hour, centre);
  return height * Math.exp(-(d * d) / (2 * width * width));
}

interface CrowdPattern {
  /**
   * Relative strength of this category per weekday
   * (0 = Sunday … 6 = Saturday, JS convention). Real categories are not
   * flat across the week — that is what makes each day look different.
   */
  week: readonly number[];
  /** Hourly activity shape for a single day. */
  hours: (hour: number) => number;
  /** How strongly this category feeds a refuelling queue (0..1). */
  pumpWeight: number;
}

/**
 * Per-category rhythms. Weekday values differ from each other on purpose
 * (e.g. Monday is office-heavy, Friday skews to dining/retail, Sunday to
 * markets and worship) so no two days render the same histogram.
 */
const CROWD_PATTERN: Record<CrowdCategory, CrowdPattern> = {
  // Commuters every day — the most reliable queue feeder there is.
  transport: {
    week: [0.9, 1.0, 1.0, 1.0, 1.0, 1.08, 0.95],
    hours: (h) => 0.45 + bump(h, 8.5, 1.6, 1.0) + bump(h, 18.4, 1.9, 1.1) + bump(h, 13.0, 1.8, 0.45),
    pumpWeight: 1.0,
  },
  // Offices: weekdays only, classic 9-to-6 with a lunch dip.
  office: {
    week: [0.07, 1.0, 1.0, 1.0, 0.97, 0.88, 0.1],
    hours: (h) => 0.05 + bump(h, 9.6, 1.5, 1.0) + bump(h, 13.0, 1.3, 0.5) + bump(h, 17.6, 1.5, 0.8),
    pumpWeight: 0.62,
  },
  // Shops: steady all week, strongest Saturday.
  retail: {
    week: [0.82, 0.78, 0.78, 0.84, 0.9, 1.0, 1.12],
    hours: (h) => 0.15 + bump(h, 12.0, 2.0, 0.7) + bump(h, 18.2, 2.4, 1.0),
    pumpWeight: 0.72,
  },
  // Markets: early-morning trade, heaviest at the weekend.
  market: {
    week: [1.05, 0.88, 0.9, 0.92, 0.96, 1.02, 1.18],
    hours: (h) => 0.1 + bump(h, 8.6, 1.9, 1.25) + bump(h, 17.5, 1.6, 0.35),
    pumpWeight: 0.7,
  },
  // Schools/colleges: weekdays, sharp start and a midday break.
  education: {
    week: [0.05, 1.0, 1.0, 1.0, 1.0, 0.82, 0.06],
    hours: (h) => 0.05 + bump(h, 8.0, 1.1, 1.0) + bump(h, 12.6, 1.3, 0.7) + bump(h, 15.4, 1.5, 0.55),
    pumpWeight: 0.52,
  },
  // Restaurants/cafés: lunch and a long dinner tail.
  dining: {
    week: [1.0, 0.82, 0.84, 0.9, 0.96, 1.12, 1.18],
    hours: (h) => 0.15 + bump(h, 13.0, 1.4, 0.85) + bump(h, 20.5, 1.8, 1.0),
    pumpWeight: 0.5,
  },
  // Hospitals/clinics: weekday working hours with a soft weekend.
  health: {
    week: [0.32, 1.0, 1.0, 1.0, 1.0, 0.98, 0.5],
    hours: (h) => 0.1 + bump(h, 11.0, 2.6, 0.9),
    pumpWeight: 0.42,
  },
  // Parks, gyms, cinemas, stadiums: evenings and weekends.
  leisure: {
    week: [1.08, 0.68, 0.7, 0.76, 0.86, 1.0, 1.22],
    hours: (h) => 0.15 + bump(h, 11.0, 2.6, 0.6) + bump(h, 18.8, 2.1, 0.95),
    pumpWeight: 0.55,
  },
  // Homes: commuter double peak, slightly heavier at the weekend.
  residential: {
    week: [1.06, 1.0, 0.99, 1.0, 1.0, 1.06, 1.04],
    hours: (h) => 0.55 + bump(h, 8.6, 1.7, 0.85) + bump(h, 19.0, 2.2, 1.15),
    pumpWeight: 0.85,
  },
  // Industrial estates: weekday shift patterns.
  industry: {
    week: [0.35, 1.0, 1.0, 1.0, 1.0, 0.95, 0.4],
    hours: (h) => 0.1 + bump(h, 9.0, 2.0, 0.9) + bump(h, 14.5, 2.1, 0.8),
    pumpWeight: 0.48,
  },
  // Places of worship: Sunday morning and Friday evening peaks.
  worship: {
    week: [1.25, 0.42, 0.42, 0.45, 0.5, 0.85, 0.9],
    hours: (h) => 0.05 + bump(h, 8.2, 1.6, 1.0) + bump(h, 18.6, 1.4, 0.55),
    pumpWeight: 0.35,
  },
  // Highway junctions: through-traffic that never really stops.
  highway: {
    week: [1.12, 0.88, 0.88, 0.9, 0.96, 1.06, 1.18],
    hours: (h) => 0.5 + bump(h, 9.0, 2.6, 0.6) + bump(h, 18.0, 2.6, 0.65),
    pumpWeight: 0.9,
  },
};

// ----------------------------------------------------------------------
// Mix helpers
// ----------------------------------------------------------------------
/** Normalise raw category weights into a 0..1 mix that sums to 1. */
export function normaliseMix(raw: Partial<CrowdMix>): CrowdMix {
  const total = CROWD_CATEGORIES.reduce((sum, c) => sum + (raw[c] ?? 0), 0);
  const mix = { ...EMPTY_MIX };
  if (total <= 0) return mix;
  for (const category of CROWD_CATEGORIES) {
    mix[category] = (raw[category] ?? 0) / total;
  }
  return mix;
}

/** Blend two mixes (used to season the real mix with the city baseline). */
export function blendMix(a: CrowdMix, b: CrowdMix, weightOfB: number): CrowdMix {
  const raw = { ...EMPTY_MIX };
  for (const category of CROWD_CATEGORIES) {
    raw[category] = a[category] * (1 - weightOfB) + b[category] * weightOfB;
  }
  return normaliseMix(raw);
}

/** The strongest crowd source around a station, e.g. "markets". */
export function dominantCategory(mix: CrowdMix): CrowdCategory | null {
  let best: CrowdCategory | null = null;
  let bestValue = 0.12; // ignore a flat/empty mix
  for (const category of CROWD_CATEGORIES) {
    if (mix[category] > bestValue) {
      bestValue = mix[category];
      best = category;
    }
  }
  return best;
}

/** Top N labels, e.g. ["transit stops", "offices"]. */
export function topCategories(mix: CrowdMix, count = 2): string[] {
  return CROWD_CATEGORIES.filter((c) => mix[c] > 0.05)
    .sort((a, b) => mix[b] - mix[a])
    .slice(0, count)
    .map((c) => CROWD_LABEL[c]);
}

// ----------------------------------------------------------------------
// Curve construction — the part that makes every station & day unique
// ----------------------------------------------------------------------
interface CrowdWeeklyProfile {
  /** `raw[d][h]` unnormalised activity (used for peak comparison). */
  raw: number[][];
  /** Highest raw value of the week. */
  peak: number;
  /** `shape[d][h]` with each day's mean normalised to 1.0. */
  shape: number[][];
}

const weeklyCache = new Map<string, CrowdWeeklyProfile>();

function mixKey(mix: CrowdMix): string {
  return CROWD_CATEGORIES.map((c) => Math.round(mix[c] * 1000)).join(',');
}

/** Build (and cache) the station's own weekly crowd curve from its mix. */
export function crowdWeeklyProfile(mix: CrowdMix): CrowdWeeklyProfile {
  const key = mixKey(mix);
  const cached = weeklyCache.get(key);
  if (cached) return cached;

  const raw: number[][] = [];
  const shape: number[][] = [];
  let peak = 0;

  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    const hours: number[] = [];
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
      let value = 0;
      for (const category of CROWD_CATEGORIES) {
        const weight = mix[category];
        if (weight <= 0) continue;
        const pattern = CROWD_PATTERN[category];
        value += weight * pattern.week[day] * pattern.hours(hour);
      }
      hours.push(value);
      if (value > peak) peak = value;
    }
    raw.push(hours);

    const mean = hours.reduce((sum, v) => sum + v, 0) / HOURS_PER_DAY;
    shape.push(
      mean > 0 ? hours.map((v) => v / mean) : hours.map(() => 1),
    );
  }

  const profile: CrowdWeeklyProfile = { raw, peak, shape };
  if (weeklyCache.size > 256) weeklyCache.clear();
  weeklyCache.set(key, profile);
  return profile;
}

// ----------------------------------------------------------------------
// Stable per-station fallback (used only when OSM has no data nearby)
// ----------------------------------------------------------------------
function hash01(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 10_000) / 10_000;
}

/** Urban profiles worth using when a station has no mapped POIs at all. */
const FALLBACK_PROFILES: readonly CrowdMix[] = [
  { ...EMPTY_MIX, transport: 0.34, retail: 0.22, residential: 0.24, office: 0.2 },
  { ...EMPTY_MIX, residential: 0.45, retail: 0.2, education: 0.18, dining: 0.17 },
  { ...EMPTY_MIX, office: 0.38, dining: 0.22, retail: 0.24, transport: 0.16 },
  { ...EMPTY_MIX, highway: 0.42, residential: 0.24, industry: 0.2, retail: 0.14 },
  { ...EMPTY_MIX, market: 0.32, residential: 0.3, worship: 0.18, retail: 0.2 },
  { ...EMPTY_MIX, retail: 0.34, leisure: 0.24, residential: 0.24, dining: 0.18 },
].map(normaliseMix);

/** Deterministic reading for a station we have no OSM detail about. */
function fallbackReading(station: Station): CrowdReading {
  const seed = hash01(station.id);
  const index = Math.min(
    FALLBACK_PROFILES.length - 1,
    Math.floor(seed * FALLBACK_PROFILES.length),
  );
  const mix = FALLBACK_PROFILES[index];
  return {
    mix,
    pressure: 0,
    intensity: 0.7 + hash01(`${station.id}:i`) * 0.7,
    sources: 0,
    real: false,
  };
}

// ----------------------------------------------------------------------
// Public reading
// ----------------------------------------------------------------------
export interface CrowdReading {
  /** How the crowd around this station splits across categories. */
  mix: CrowdMix;
  /** Sum of distance-weighted crowd sources (higher = busier area). */
  pressure: number;
  /** Multiplier applied to the station's typical wait (0.55 … 1.75). */
  intensity: number;
  /** How many real mapped crowd sources fed this reading. */
  sources: number;
  /** True when real OpenStreetMap data was used. */
  real: boolean;
}

let crowdIndex: Record<string, CrowdReading> = {};

/** Install a freshly computed index (called from the store). */
export function setCrowdIndex(entries: Record<string, CrowdReading>): void {
  crowdIndex = entries;
}

export function clearCrowdIndex(): void {
  crowdIndex = {};
}

export function crowdIndexSize(): number {
  return Object.keys(crowdIndex).length;
}

/** Reading for a station — real OSM data when known, else deterministic. */
export function crowdReadingFor(station: Station): CrowdReading {
  return crowdIndex[station.id] ?? fallbackReading(station);
}

/** Map distance-weighted pressure onto the typical-wait multiplier. */
function pressureToIntensity(pressure: number): number {
  const scaled = Math.log1p(pressure) / Math.log1p(28);
  return clamp(0.55 + scaled * 1.2, 0.55, 1.75);
}

// ----------------------------------------------------------------------
// OpenStreetMap crowd-source fetch
// ----------------------------------------------------------------------
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

/** Crowd sources inside this radius of a station actually affect it, km. */
const INFLUENCE_KM = 1.0;
/** Full weight inside this radius, then linear decay to 0, km. */
const CORE_KM = 0.35;

const TTL_MS = 15 * 60_000;

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function buildCrowdQuery(lat: number, lng: number, radiusM: number): string {
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(4)},${lng.toFixed(4)})`;
  return (
    '[out:json][timeout:25];(' +
    `nwr["amenity"~"^(marketplace|bus_station|school|college|university|hospital|clinic|doctors|pharmacy|restaurant|cafe|fast_food|nightclub|cinema|place_of_worship|fuel|charging_station|bank)$"]${around};` +
    `nwr["railway"~"^(station|halt|subway_entrance|tram_stop)$"]${around};` +
    `nwr["shop"~"^(mall|department_store|supermarket|convenience|variety_store|clothes|electronics|bakery|greengrocer|butcher)$"]${around};` +
    `nwr["office"]${around};` +
    `nwr["leisure"~"^(park|sports_centre|fitness_centre|stadium|playground)$"]${around};` +
    `nwr["tourism"~"^(hotel|attraction|museum)$"]${around};` +
    `nwr["landuse"~"^(retail|commercial|industrial|residential)$"]${around};` +
    `nwr["highway"="motorway_junction"]${around};` +
    `nwr["place"~"^(neighbourhood|suburb|quarter)$"]${around};` +
    ');out center 3000;'
  );
}

async function queryOverpass(query: string): Promise<OverpassElement[]> {
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 18_000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const body = (await res.json()) as { elements?: OverpassElement[] };
      return body.elements ?? [];
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('Overpass unavailable');
}

/** Map OSM tags → the crowd categories this place feeds. */
function classify(tags: Record<string, string>): { cat: CrowdCategory; w: number }[] {
  const found: { cat: CrowdCategory; w: number }[] = [];
  const add = (cat: CrowdCategory, w: number) => found.push({ cat, w });

  switch (tags.amenity) {
    case 'marketplace':
      add('market', 1.0);
      break;
    case 'bus_station':
      add('transport', 0.9);
      break;
    case 'school':
      add('education', 0.8);
      break;
    case 'college':
    case 'university':
      add('education', 1.0);
      break;
    case 'hospital':
      add('health', 0.9);
      break;
    case 'clinic':
    case 'doctors':
      add('health', 0.55);
      break;
    case 'pharmacy':
      add('health', 0.35);
      break;
    case 'restaurant':
      add('dining', 0.6);
      break;
    case 'cafe':
      add('dining', 0.45);
      break;
    case 'fast_food':
      add('dining', 0.4);
      break;
    case 'nightclub':
      add('dining', 0.5);
      break;
    case 'cinema':
      add('leisure', 0.8);
      break;
    case 'place_of_worship':
      add('worship', 0.7);
      break;
    case 'fuel':
    case 'charging_station':
      add('transport', 0.25);
      break;
    case 'bank':
      add('retail', 0.3);
      break;
    default:
      break;
  }

  if (tags.railway === 'station' || tags.railway === 'halt') add('transport', 1.0);
  else if (tags.railway === 'subway_entrance' || tags.railway === 'tram_stop') {
    add('transport', 0.6);
  }

  if (tags.shop) {
    if (tags.shop === 'mall' || tags.shop === 'department_store') add('retail', 1.0);
    else if (tags.shop === 'supermarket' || tags.shop === 'variety_store') {
      add('retail', 0.7);
    } else add('retail', 0.3);
  }

  if (tags.office || tags.building === 'office') add('office', 0.8);

  if (tags.leisure) {
    if (['park', 'stadium', 'sports_centre'].includes(tags.leisure)) {
      add('leisure', 0.8);
    } else add('leisure', 0.5);
  }

  if (tags.tourism) add('leisure', tags.tourism === 'hotel' ? 0.4 : 0.6);

  switch (tags.landuse) {
    case 'residential':
      add('residential', 0.6);
      break;
    case 'industrial':
      add('industry', 0.7);
      break;
    case 'commercial':
      add('office', 0.5);
      break;
    case 'retail':
      add('retail', 0.6);
      break;
    default:
      break;
  }

  if (tags.highway === 'motorway_junction') add('highway', 0.9);
  if (tags.place) add('residential', 0.5);

  return found;
}

function elementPoint(el: OverpassElement): { lat: number; lng: number } | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

/** 1 inside `CORE_KM`, fading to 0 at `INFLUENCE_KM`. */
function distanceDecay(km: number): number {
  if (km >= INFLUENCE_KM) return 0;
  if (km <= CORE_KM) return 1;
  return 1 - (km - CORE_KM) / (INFLUENCE_KM - CORE_KM);
}

interface IndexPoint {
  lat: number;
  lng: number;
  cat: CrowdCategory;
  w: number;
}

// Location-keyed cache + in-flight de-duplication.
let cache: { key: string; at: number; value: Record<string, CrowdReading> } | null =
  null;
let inflight: { key: string; promise: Promise<Record<string, CrowdReading>> } | null =
  null;

/**
 * Fetch real crowd sources around `center` and score every station.
 *
 * Returns a per-station reading: the category mix actually surrounding it,
 * the distance-weighted pressure and the wait multiplier that follows.
 * Throws only when every Overpass mirror fails (callers fall back silently).
 */
export async function fetchCrowdIndex(
  stations: Station[],
  center: UserLocation,
): Promise<Record<string, CrowdReading>> {
  const farthestKm = stations.reduce(
    (max, s) => Math.max(max, haversineKm(center, { lat: s.latitude, lng: s.longitude })),
    0,
  );
  const radiusM = clamp((farthestKm + INFLUENCE_KM) * 1000, 3_000, 12_000);
  const key = `${center.lat.toFixed(2)},${center.lng.toFixed(2)}|${Math.round(radiusM / 500)}`;

  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) {
    return cache.value;
  }
  if (inflight && inflight.key === key) return inflight.promise;

  const promise = (async () => {
    const elements = await queryOverpass(
      buildCrowdQuery(center.lat, center.lng, radiusM),
    );

    // Flatten OSM elements → weighted points (a place can feed 2 categories).
    const points: IndexPoint[] = [];
    for (const el of elements) {
      const tags = el.tags ?? {};
      const point = elementPoint(el);
      if (!point) continue;
      for (const { cat, w } of classify(tags)) {
        points.push({ lat: point.lat, lng: point.lng, cat, w });
      }
    }

    const index: Record<string, CrowdReading> = {};
    for (const station of stations) {
      const origin = { lat: station.latitude, lng: station.longitude };
      const raw = { ...EMPTY_MIX };
      let pressure = 0;
      let sources = 0;

      for (const point of points) {
        const decay = distanceDecay(haversineKm(origin, point));
        if (decay <= 0) continue;
        const weight = point.w * decay;
        raw[point.cat] += weight;
        pressure += CROWD_PATTERN[point.cat].pumpWeight * weight;
        sources += 1;
      }

      index[station.id] =
        sources > 0
          ? {
              mix: normaliseMix(raw),
              pressure: Math.round(pressure * 100) / 100,
              intensity: Math.round(pressureToIntensity(pressure) * 100) / 100,
              sources,
              real: true,
            }
          : fallbackReading(station);
    }

    return index;
  })();

  inflight = { key, promise };
  try {
    const value = await promise;
    cache = { key, at: Date.now(), value };
    return value;
  } finally {
    if (inflight?.key === key) inflight = null;
  }
}

/** Drop the cached OSM snapshot (used when the location changes a lot). */
export function forgetCrowdIndex(): void {
  cache = null;
}
