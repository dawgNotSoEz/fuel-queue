/**
 * FUELWISE — free live weather (Open-Meteo, no API key, no account).
 *
 * Weather is the one free "live" signal that genuinely moves fuel queues:
 * rain, fog and storms make people refuel at different times. We fetch the
 * current observation for the driver's position, normalise it into the
 * vocabulary the prediction model already speaks
 * (clear | cloudy | rain | fog | storm) and pass it to
 * `GET /api/busyness` / `POST /api/predict` so the live busyness reading is
 * weather-aware.
 *
 * Everything degrades silently: if Open-Meteo is unreachable, the app simply
 * behaves as if the weather were clear.
 */

import type { WeatherCondition, WeatherSnapshot } from '../types';
import { WEATHER_LABEL } from './busyness';
import type { LatLng } from './geo';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TTL_MS = 10 * 60_000;

const cache = new Map<string, { at: number; value: WeatherSnapshot }>();
let inflight: { key: string; promise: Promise<WeatherSnapshot | null> } | null =
  null;

/** WMO weather interpretation codes → the model's condition vocabulary. */
function conditionFor(code: number): WeatherCondition {
  if (code === 0) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  // Everything else is precipitation: drizzle, rain, showers, and snow
  // (snow is treated as wet weather — it lengthens queues the same way).
  return 'rain';
}

function cacheKey({ lat, lng }: LatLng): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
}

/**
 * Current weather at `center`, or `null` when the free service is
 * unreachable. Cached for 10 minutes per ~1 km cell.
 */
export async function fetchWeather(
  center: LatLng,
): Promise<WeatherSnapshot | null> {
  const key = cacheKey(center);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (inflight && inflight.key === key) return inflight.promise;

  const params = new URLSearchParams({
    latitude: center.lat.toFixed(4),
    longitude: center.lng.toFixed(4),
    current: 'temperature_2m,wind_speed_10m,weather_code',
    timezone: 'auto',
  });

  const promise = (async (): Promise<WeatherSnapshot | null> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6_000);
    try {
      const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const body = (await res.json()) as OpenMeteoResponse;
      const code = body.current?.weather_code ?? 0;
      const condition = conditionFor(code);
      const snapshot: WeatherSnapshot = {
        condition,
        label: WEATHER_LABEL[condition],
        temperatureC: Math.round((body.current?.temperature_2m ?? 0) * 10) / 10,
        windKmh: Math.round(body.current?.wind_speed_10m ?? 0),
        observedAt: Date.now(),
      };
      cache.set(key, { at: Date.now(), value: snapshot });
      return snapshot;
    } catch {
      return null; // offline / rate-limited → behave as "no weather"
    } finally {
      window.clearTimeout(timer);
      if (inflight?.key === key) inflight = null;
    }
  })();

  inflight = { key, promise };
  return promise;
}
