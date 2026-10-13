/**
 * FUELWISE — useBusyness hook.
 *
 * Gives a station its Google-Maps-style "popular times" histogram and live
 * busyness reading:
 *
 *  1. Instantly (no network, no key) build the profile from the local demand
 *     curve in `utils/busyness.ts`, so the chart is never empty.
 *  2. Upgrade it in the background with the model-driven profile from
 *     `GET /api/busyness` (XGBoost wait predictions + rolling crowd reports).
 *     If the backend is unreachable the local profile simply stays.
 *
 * The live reading always describes *now*, even while the user browses the
 * histogram of another day.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useStore } from '../store/useStore';
import type {
  BusynessProfile,
  LiveBusyness,
  Station,
  WeatherCondition,
} from '../types';
import type { BusynessRequestTarget } from '../utils/api';
import { fetchBusynessFromApi } from '../utils/api';
import {
  buildBusynessProfile,
  forgetStationProfiles,
  liveBusyness,
  rememberApiProfile,
  stationTypicalWait,
} from '../utils/busyness';
import { crowdReadingFor } from '../utils/crowdContext';

export interface UseBusynessResult {
  /** Histogram data for the day currently being viewed. */
  profile: BusynessProfile;
  /** Live reading for *now* (independent of the viewed day). */
  live: LiveBusyness;
  /** Day shown in the histogram (0 = Sunday). */
  day: number;
  /** Today's weekday (0 = Sunday) — the histogram's live bar lives here. */
  today: number;
  /** Switch the histogram to another day. */
  setDay: (day: number) => void;
  /** True while the model-driven profile for `day` is still loading. */
  loading: boolean;
}

/**
 * Profile for a station/day, rebuilt when the rolling past-data mean has
 * moved (e.g. after the backend blended in new crowd reports) so the
 * histogram never contradicts the live wait. Model-driven profiles are
 * never overridden by the local curve.
 */
function profileFor(station: Station, day: number): BusynessProfile {
  const cached = buildBusynessProfile(station, day);
  if (cached.source === 'ml') return cached;
  if (Math.abs(cached.typicalWaitMinutes - stationTypicalWait(station)) < 0.5) {
    return cached;
  }
  forgetStationProfiles(station.id);
  return buildBusynessProfile(station, day);
}

export function useBusyness(
  station: Station,
  weather: WeatherCondition | null = null,
): UseBusynessResult {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const today = new Date(now).getDay();
  const [pinnedDay, setPinnedDay] = useState<number | null>(null);
  const day = pinnedDay ?? today;

  // Model-driven profiles are cached; `version` re-reads the cache. The crowd
  // index is derived from real OSM places, so when it lands every profile for
  // this station must be rebuilt around the station's own neighbourhood.
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const crowdVersion = useStore((s) => s.crowdVersion);
  const ticket = useRef(0);

  const stationId = station.id;
  const type = station.type;
  const historyMean =
    typeof station.historical_avg_wait === 'number'
      ? station.historical_avg_wait
      : undefined;
  const capacity =
    typeof station.capacity === 'number' ? station.capacity : undefined;

  // Stable request target — the station object itself is replaced on every
  // live tick, which must not re-trigger the request.
  const target = useMemo<BusynessRequestTarget>(
    () => ({ id: stationId, type, historical_avg_wait: historyMean, capacity }),
    [stationId, type, historyMean, capacity],
  );

  const viewedProfile = useMemo(
    () => profileFor(station, day),
    // `station` is intentional: a live tick can move the rolling mean, while
    // the profile cache keeps the returned object identity stable.
    [station, day, version, crowdVersion],
  );
  const todayProfile = useMemo(
    () => profileFor(station, today),
    [station, today, version, crowdVersion],
  );
  const live = useMemo(
    () => liveBusyness({ station, profile: todayProfile, at: new Date(now) }),
    [station, todayProfile, now],
  );

  useEffect(() => {
    const mine = ++ticket.current;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const crowd = crowdReadingFor(station);
      const result = await fetchBusynessFromApi({
        station: target,
        at: new Date(),
        dayOfWeek: day,
        weather,
        crowd: crowd.mix,
        crowdIntensity: crowd.intensity,
      });
      if (cancelled || mine !== ticket.current) return;
      if (result) {
        rememberApiProfile(stationId, result);
        setVersion((v) => v + 1);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [target, day, weather, stationId]);

  return {
    profile: viewedProfile,
    live,
    day,
    today,
    setDay: (next) => setPinnedDay(next === today ? null : next),
    loading,
  };
}
