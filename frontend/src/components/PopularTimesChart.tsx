/**
 * FUELWISE — PopularTimesChart.
 *
 * The Google-Maps "popular times" panel, for a fuel station:
 * a 24-bar histogram of how busy that pump usually is (derived from its own
 * past-data mean wait × the city demand curve), day tabs to browse the week,
 * and a live reading — "Busy · less busy than usual · clearing up" — computed
 * from the station's current queue.
 *
 * Data sources: 100% free and key-free. The profile is built locally and
 * upgraded by `GET /api/busyness` when the backend is reachable; weather
 * comes from Open-Meteo.
 */

import {
  Activity,
  BarChart3,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Info,
  Loader2,
  Minus,
  Sun,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { useBusyness } from '../hooks/useBusyness';
import { useStore } from '../store/useStore';
import type { Station, WeatherCondition } from '../types';
import {
  BUSYNESS_STYLE,
  DAY_NAMES,
  DAY_SHORT,
  HOURS_PER_DAY,
  describeBar,
  hourLabel,
  weatherQueueImpact,
  windowLabel,
} from '../utils/busyness';
import { crowdReadingFor, topCategories } from '../utils/crowdContext';
import { formatMinutes } from '../utils/geo';

interface Props {
  station: Station;
  className?: string;
}

const WEATHER_ICON: Record<WeatherCondition, typeof Sun> = {
  clear: Sun,
  cloudy: CloudSun,
  rain: CloudRain,
  fog: CloudFog,
  storm: CloudLightning,
};

const TREND_ICON = {
  rising: TrendingUp,
  falling: TrendingDown,
  steady: Minus,
} as const;

/** Hour labels printed under the histogram. */
const AXIS_HOURS = [0, 6, 12, 18] as const;

export default function PopularTimesChart({ station, className = '' }: Props) {
  const weather = useStore((st) => st.weather);
  const crowdVersion = useStore((st) => st.crowdVersion);
  const crowd = useMemo(
    () => crowdReadingFor(station),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [station, crowdVersion],
  );
  const { profile, live, day, today, setDay, loading } = useBusyness(
    station,
    weather?.condition ?? null,
  );

  const [hover, setHover] = useState<number | null>(null);
  const nowHour = new Date().getHours();
  const isToday = day === today;
  const style = BUSYNESS_STYLE[live.level];
  const TrendIcon = TREND_ICON[live.trend];
  const WeatherIcon = weather ? WEATHER_ICON[weather.condition] : null;
  const rainNote = weather ? weatherQueueImpact(weather.condition) : 0;

  return (
    <section className={className} aria-label="Popular times for this station">
      {/* ---------- Header ---------- */}
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <BarChart3 className="size-3.5" />
          Popular times
        </p>
        <span className="flex items-center gap-1.5">
          {weather && WeatherIcon && (
            <span
              className="flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
              title={`Live weather · ${weather.label} · ${weather.temperatureC}°C${
                rainNote > 0
                  ? ` — queues run about +${Math.round(rainNote * 100)}% longer in this weather`
                  : ''
              }`}
            >
              <WeatherIcon className="size-3 text-brand" />
              {weather.temperatureC}°
            </span>
          )}
          <span
            className="flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
            title={
              crowd.real
                ? `This station's curve is shaped by the real places mapped around it on OpenStreetMap (${crowd.sources} within 1 km).`
                : "OpenStreetMap had no places mapped around this station, so a typical local profile is used."
            }
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin text-brand" />
            ) : (
              <Info className="size-3 text-brand" />
            )}
            {profile.source === 'ml' ? 'AI model' : crowd.real ? 'Real crowd' : 'Local profile'}
          </span>
        </span>
      </div>

      {/* ---------- Live headline ---------- */}
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`size-2.5 shrink-0 rounded-full ${style.dot}`} />
        <p className={`text-sm font-bold ${style.text}`}>{live.headline}</p>
        <p className="truncate text-xs text-muted">· {live.comparisonLabel}</p>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1 font-semibold text-ink">
          <Activity className="size-3 text-success" />
          Live
        </span>
        <span>{formatMinutes(live.liveWait)} queue now</span>
        <span className="text-slate-300" aria-hidden>
          |
        </span>
        <span className="inline-flex items-center gap-1">
          <TrendIcon className="size-3" />
          {live.trendLabel}
        </span>
        <span className="text-slate-300" aria-hidden>
          |
        </span>
        <span>usually {formatMinutes(live.expectedWait)}</span>
      </p>

      {/* ---------- Day tabs ---------- */}
      <div className="mt-2 flex gap-1" role="tablist" aria-label="Day of week">
        {DAY_SHORT.map((label, index) => {
          const active = index === day;
          return (
            <button
              key={DAY_NAMES[index]}
              type="button"
              role="tab"
              aria-selected={active}
              title={DAY_NAMES[index]}
              onClick={() => setDay(index)}
              className={`fw-focus h-6 flex-1 rounded-md text-[11px] font-bold transition ${
                active
                  ? 'bg-ink text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ---------- Histogram ---------- */}
      <div className="mt-2">
        <div className="flex h-16 items-end gap-[2px]">
          {profile.daily.map((value, hour) => {
            const isNow = isToday && hour === nowHour;
            const percent = isNow
              ? Math.min(100, Math.max(4, live.percent))
              : Math.max(4, value);
            const isPast = isToday && hour < nowHour;
            return (
              <button
                key={hour}
                type="button"
                onMouseEnter={() => setHover(hour)}
                onFocus={() => setHover(hour)}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
                aria-label={`${hourLabel(hour)}: ${describeBar(
                  percent,
                )}, about ${Math.round(profile.expectedWait[hour])} minute wait`}
                title={`${hourLabel(hour)} — ${describeBar(percent)}`}
                style={{ height: `${percent}%` }}
                className={`fw-focus relative min-w-0 flex-1 rounded-[3px] transition-[height] duration-500 ${
                  isNow
                    ? style.bar
                    : hover === hour
                      ? 'bg-brand'
                      : isPast
                        ? 'bg-brand/30'
                        : 'bg-brand/50'
                }`}
              >
                {isNow && (
                  <span
                    className={`absolute -top-1.5 left-1/2 size-2 -translate-x-1/2 rotate-45 rounded-[1px] ${style.bar}`}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-1 flex justify-between text-[9px] font-medium text-faint">
          {AXIS_HOURS.map((hour) => (
            <span key={hour}>{hourLabel(hour)}</span>
          ))}
          <span>{hourLabel(HOURS_PER_DAY - 1)}</span>
        </div>
      </div>

      {/* ---------- Reading for the hovered hour ---------- */}
      {hover != null ? (
        <p className="mt-1.5 rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
          <b className="text-ink">{hourLabel(hover)}</b> ·{' '}
          {describeBar(profile.daily[hover])} · usually{' '}
          <b className="text-ink">{formatMinutes(profile.expectedWait[hover])}</b>{' '}
          wait
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-muted">
          Busiest around <b className="text-ink">{hourLabel(profile.peakHour)}</b>{' '}
          · quietest{' '}
          <b className="text-ink">{windowLabel(profile.quietWindow)}</b>
        </p>
      )}

      {/* ---------- Why this pump gets busy (real OSM places) ---------- */}
      {crowd.real && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          Shaped by{' '}
          <b className="text-ink">
            {topCategories(crowd.mix, 2).join(' & ') || 'local activity'}
          </b>{' '}
          within 1 km ({crowd.sources} mapped places).
        </p>
      )}

      {/* ---------- Best time to visit ---------- */}
      <p className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-teal bg-teal-soft px-2 py-1.5 text-[11px] text-slate-700">
        <Sun className="size-3.5 shrink-0 text-teal" />
        <span>
          <b className="text-teal">Best time to visit:</b>{' '}
          {windowLabel(profile.quietWindow)} — about{' '}
          {formatMinutes(
            Math.round(
              Math.min(
                profile.expectedWait[profile.quietWindow.start],
                profile.expectedWait[profile.quietWindow.start + 1],
              ),
            ),
          )}{' '}
          wait
        </span>
      </p>
    </section>
  );
}
