/**
 * FUELWISE — StationInfoWindow (accessible light card).
 *
 * Rendered inside the selected-station card above a pin. Shows: broken/
 * offline warning, fuel badge, queue wait + price, Station Health Score,
 * the Time-Saving estimate vs the worst option, and the Best Time to Visit.
 */

import {
  Activity,
  AlertTriangle,
  Clock,
  Fuel,
  MapPin,
  PlugZap,
  Sun,
  Timer,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { useStore } from '../store/useStore';
import type { FuelType, PressureLevel, Station } from '../types';
import { formatMinutes } from '../utils/geo';
import {
  computeHealthScore,
  computeTimeSaving,
  getBestTimeToVisit,
} from '../utils/stationMetrics';

interface Props {
  station: Station;
}

/** Small chip for CNG pressure readings. */
function PressureBadge({ level }: { level: PressureLevel }) {
  const text =
    level === 'high'
      ? 'high pressure'
      : level === 'medium'
        ? 'medium pressure'
        : 'low pressure';
  const dot =
    level === 'high' ? 'bg-success' : level === 'medium' ? 'bg-warn' : 'bg-danger';
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
      <span className={`size-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function TypeBadge({ type }: { type: FuelType }) {
  const isEV = type === 'EV';
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white ${
        isEV ? 'bg-ev' : 'bg-cng'
      }`}
    >
      {isEV ? <Zap className="size-3" /> : <Fuel className="size-3" />}
      {type}
    </span>
  );
}

export default function StationInfoWindow({ station }: Props) {
  const s = station;
  const isEV = s.type === 'EV';
  const priceUnit = isEV ? '₹/kWh' : '₹/kg';
  const isBroken = !s.is_operational;

  // ---- intelligence (see utils/stationMetrics.ts) ----
  const stations = useStore((st) => st.stations);
  const lastSimTick = useStore((st) => st.lastSimTick);
  const dataSource = useStore((st) => st.dataSource);
  const peers = stations.filter((st) => st.type === s.type);
  const health = computeHealthScore(s, peers);
  const saving = computeTimeSaving(s, peers);
  const quietTime = getBestTimeToVisit(s);

  // ---- "Last updated …" freshness readout (1s ticking clock) ----
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const updatedAgo = Math.max(0, Math.round((now - lastSimTick) / 1000));

  const healthBar =
    health.band === 'Good'
      ? 'bg-success'
      : health.band === 'Fair'
        ? 'bg-warn'
        : 'bg-danger';
  const healthText =
    health.band === 'Good'
      ? 'text-success'
      : health.band === 'Fair'
        ? 'text-warn'
        : 'text-danger';

  return (
    <div className="w-[300px] rounded-2xl bg-transparent text-ink">
      {/* ---------- Broken / offline banner (prominent) ---------- */}
      {isBroken && (
        <div className="flex items-center gap-2 border-b border-danger bg-danger px-3.5 py-2.5">
          <AlertTriangle className="size-4 shrink-0 text-white" />
          <span className="text-[12px] font-bold uppercase tracking-wide text-white">
            Offline / Broken
          </span>
        </div>
      )}

      {/* ---------- Header ---------- */}
      <div className="px-4 pb-1 pt-3.5 pr-12">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] font-bold leading-snug text-ink">
            {s.name}
          </h3>
          <TypeBadge type={s.type} />
        </div>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted">
          <MapPin className="size-3.5 text-muted" />
          {s.distance_km.toFixed(1)} km from you
        </p>

        {(s.is_best_choice || s.is_worst_choice) && s.is_operational && (
          <div className="mt-2">
            {s.is_best_choice ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-success px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                Recommended now
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border-2 border-dashed border-danger bg-danger-soft px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-danger-dark">
                Avoid now
              </span>
            )}
          </div>
        )}
      </div>

      {/* ---------- Wait + price ---------- */}
      <div className="mt-2.5 flex items-center justify-between border-y border-line bg-slate-50 px-4 py-3">
        {s.is_operational ? (
          <div>
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted">
              <Clock className="size-3.5" /> Est. wait
            </p>
            <p className="text-2xl font-bold leading-tight text-ink">
              {formatMinutes(s.current_wait_time)}
            </p>
          </div>
        ) : (
          <div>
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted">
              <AlertTriangle className="size-3.5 text-danger" /> Status
            </p>
            <p className="text-xl font-bold leading-tight text-danger">
              Out of service
            </p>
          </div>
        )}

        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Price
          </p>
          <p className="text-xl font-bold leading-tight text-ink">
            ₹{s.price}
            <span className="ml-1 text-xs font-medium text-muted">
              {priceUnit}
            </span>
          </p>
        </div>
      </div>

      {/* ---------- Station Health Score ---------- */}
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Station health
          </p>
          <p className={`flex items-center gap-1.5 text-lg font-bold ${healthText}`}>
            {health.score}
            <span className="text-[11px] font-semibold uppercase text-muted">
              /100 · {health.band}
            </span>
          </p>
        </div>
        <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full ${healthBar}`}
            style={{ width: `${health.score}%` }}
          />
        </div>
      </div>

      {/* ---------- Time-saving estimate ---------- */}
      {s.is_operational && !saving.isWorst && saving.minutes > 0 && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-success bg-success-soft px-3 py-2">
          <Timer className="mt-0.5 size-4 shrink-0 text-success" />
          <p className="text-xs leading-snug text-slate-700">
            <b className="text-success">
              Saves ~{saving.minutes} min
            </b>{' '}
            vs <b className="text-ink">{saving.worstName}</b> — the slowest
            option right now.
          </p>
        </div>
      )}
      {s.is_operational && saving.isWorst && (
        <div className="mx-4 mt-3 rounded-lg border border-dashed border-danger bg-danger-soft px-3 py-2 text-xs text-danger-dark">
          Longest queue right now — try the <b>Recommended</b> station instead.
        </div>
      )}
      {!s.is_operational && (
        <div className="mx-4 mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted">
          No estimate while this charger is offline.
        </div>
      )}

      {/* ---------- Best time to visit ---------- */}
      {s.is_operational && (
        <div className="mx-4 mt-2.5 flex items-center gap-2 rounded-lg border border-teal bg-teal-soft px-3 py-2">
          <Sun className="size-4 shrink-0 text-teal" />
          <p className="text-xs text-slate-700">
            <b className="text-teal">Quiet time:</b> {quietTime}
          </p>
        </div>
      )}

      {/* ---------- Footer meta ---------- */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-4 pt-2.5">
        {!isEV && s.pressure_level && (
          <PressureBadge level={s.pressure_level} />
        )}
        {isEV && s.connector_type && (
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
            <PlugZap className="size-3.5 text-ev" /> {s.connector_type}
          </span>
        )}

        <span className="ml-auto flex items-center gap-2 text-xs font-medium">
          {/* Freshness — always visible, signals the live/simulated feed */}
          <span
            className={`inline-flex items-center gap-1 ${
              dataSource === 'live' || dataSource === 'api'
                ? 'text-success'
                : 'text-warn'
            }`}
            title={
              dataSource === 'live' || dataSource === 'api'
                ? 'Live data refreshed every 5s'
                : 'Simulated feed refreshed every 5s'
            }
          >
            <Activity className="size-3.5" />
            Updated {updatedAgo}s ago
          </span>
          {s.is_operational && (
            <>
              <span className="text-slate-300" aria-hidden>
                |
              </span>
              <span className="text-muted">~{s.total_time} min total</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
