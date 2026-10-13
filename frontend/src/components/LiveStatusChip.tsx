/**
 * FUELWISE — LiveStatusChip (top-right map chrome).
 *
 * Google-Maps-style live summary of the pump area:
 *   • data-source chip  — "Real station feed · 5s" while polling,
 *   • free weather chip — Open-Meteo temperature + condition,
 *   • pump-area chip    — how many visible pumps are busy vs free right now,
 *                         derived from the same busyness model as the
 *                         "Popular times" histogram.
 */

import { CloudFog, CloudRain, CloudSun, Radio, Sun, Users, Zap } from 'lucide-react';
import { useMemo } from 'react';

import { selectVisibleStations, useStore } from '../store/useStore';
import type { BusynessLevel, WeatherCondition } from '../types';
import {
  BUSYNESS_STYLE,
  WEATHER_LABEL,
  localBusyness,
  weatherQueueImpact,
} from '../utils/busyness';
import { crowdReadingFor, dominantCategory, CROWD_LABEL } from '../utils/crowdContext';
import type { CrowdMix } from '../utils/crowdContext';

const WEATHER_ICON: Record<WeatherCondition, typeof Sun> = {
  clear: Sun,
  cloudy: CloudSun,
  rain: CloudRain,
  fog: CloudFog,
  storm: Zap,
};

const LEVEL_ORDER: BusynessLevel[] = ['not-busy', 'moderate', 'busy', 'peak'];

/** Copy for the pump-area chip when nothing on screen is outright busy. */
const LEVEL_PHRASE: Record<BusynessLevel, string> = {
  'not-busy': 'not busy',
  moderate: 'a little busy',
  busy: 'busy',
  peak: 'as busy as it gets',
};

/** The dominant real crowd generator around a pump, e.g. "offices". */
function topDriver(mix: CrowdMix): string | null {
  const category = dominantCategory(mix);
  return category ? CROWD_LABEL[category] : null;
}

export default function LiveStatusChip() {
  const dataSource = useStore((s) => s.dataSource);
  const stations = useStore((s) => s.stations);
  const filter = useStore((s) => s.filter);
  const hideBroken = useStore((s) => s.hideBroken);
  const weather = useStore((s) => s.weather);
  const crowdStatus = useStore((s) => s.crowdStatus);
  const crowdVersion = useStore((s) => s.crowdVersion);

  const live = dataSource === 'api' || dataSource === 'live';

  // Recomputes on every live tick (stations identity changes every poll) and
  // whenever the real crowd index lands (crowdVersion).
  const summary = useMemo(() => {
    const at = new Date();
    const visible = selectVisibleStations(stations, filter, hideBroken);
    const readings = visible.map((station) => ({
      station,
      live: localBusyness(station, at).live,
      crowd: crowdReadingFor(station),
    }));

    const busiest = readings.reduce<(typeof readings)[number] | null>(
      (acc, entry) =>
        acc === null || entry.live.percent > acc.live.percent ? entry : acc,
      null,
    );

    const worst = readings.reduce<BusynessLevel>(
      (acc, entry) =>
        LEVEL_ORDER.indexOf(entry.live.level) > LEVEL_ORDER.indexOf(acc)
          ? entry.live.level
          : acc,
      'not-busy',
    );

    return {
      busy: readings.filter(
        (r) => r.live.level === 'busy' || r.live.level === 'peak',
      ).length,
      free: readings.filter((r) => r.live.level === 'not-busy').length,
      total: readings.length,
      worst,
      busiestName: busiest?.station.name ?? null,
      withCrowd: readings.filter((r) => r.crowd.real).length,
      sources: readings.reduce((sum, r) => sum + r.crowd.sources, 0),
      drivers: busiest ? topDriver(busiest.crowd.mix) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, filter, hideBroken, crowdVersion]);

  const WeatherIcon = weather ? WEATHER_ICON[weather.condition] : null;
  const weatherImpact = weather ? weatherQueueImpact(weather.condition) : 0;

  return (
    <div className="pointer-events-none flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {/* Data source */}
        <div className="flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 shadow-card">
          <Radio className={`size-3.5 ${live ? 'text-success' : 'text-slate-400'}`} />
          {live ? 'Real station feed' : 'Connecting…'}
          {dataSource && (
            <span className="hidden text-slate-400 sm:inline">· 5s</span>
          )}
        </div>

        {/* Free weather (Open-Meteo) */}
        {weather && WeatherIcon && (
          <div
            className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 shadow-card sm:flex"
            title={`${WEATHER_LABEL[weather.condition]} · ${
              weatherImpact > 0
                ? `queues run ~${Math.round(
                    weatherImpact * 100,
                  )}% longer in this weather`
                : 'weather is not adding to queues right now'
            }`}
          >
            <WeatherIcon className="size-3.5 text-brand" />
            {weather.temperatureC}°C
          </div>
        )}
      </div>

      {/* Pump area status */}
      {summary.total > 0 && (
        <div
          className="flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 shadow-card"
          title={
            summary.drivers
              ? `Busiest pump right now: ${summary.busiestName}. The area is driven by real OpenStreetMap places nearby (${summary.drivers}).`
              : 'Live busyness of the pumps on screen, derived from the real places mapped around each one.'
          }
        >
          <span
            className={`size-2 rounded-full ${BUSYNESS_STYLE[summary.worst].dot}`}
            aria-hidden
          />
          {summary.busy > 0 ? (
            <span>
              {summary.busy} {filter} {summary.busy === 1 ? 'pump' : 'pumps'}{' '}
              busy
            </span>
          ) : (
            <span>
              {filter} area {LEVEL_PHRASE[summary.worst]}
            </span>
          )}
          <span className="text-slate-300">·</span>
          <span>
            {summary.free}/{summary.total} quiet
          </span>
          {summary.busiestName && (
            <span className="hidden max-w-[16rem] truncate text-slate-400 normal-case sm:inline">
              · busiest: {summary.busiestName}
            </span>
          )}
        </div>
      )}

      {/* Real crowd sources (OpenStreetMap) */}
      {summary.total > 0 && (
        <div
          className="flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 shadow-card"
          title={
            crowdStatus === 'ready'
              ? `Busyness is built from ${summary.sources} real places mapped around these pumps on OpenStreetMap (shops, offices, markets, transit stops…).`
              : crowdStatus === 'loading'
                ? 'Reading the OpenStreetMap places around each pump — shops, offices, markets, transit stops and more.'
                : 'OpenStreetMap could not be reached — each pump still uses its own stored crowd profile.'
          }
        >
          <Users
            className={`size-3.5 ${
              crowdStatus === 'ready' ? 'text-brand' : 'text-slate-400'
            }`}
          />
          {crowdStatus === 'ready'
            ? `${summary.sources} real crowd places`
            : crowdStatus === 'loading'
              ? 'Mapping the crowd…'
              : 'Local crowd profiles'}
          {summary.withCrowd > 0 && (
            <span className="hidden text-slate-400 sm:inline">
              · {summary.withCrowd}/{summary.total} pumps
            </span>
          )}
        </div>
      )}
    </div>
  );
}
