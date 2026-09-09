/**
 * FUELWISE — BestChoiceCard (accessible light theme).
 *
 * The "AI smart-pick" readout: highlights the operational station with the
 * LOWEST (drive + wait). Deep-blue header = primary highlight. Demonstrates
 * the Demand Distribution Algorithm's objective at a glance.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Award, Clock, Fuel, MapPin, Navigation, Zap } from 'lucide-react';

import { selectVisibleStations, useStore } from '../store/useStore';
import type { Station } from '../types';
import { formatMinutes } from '../utils/geo';
import { openGoogleMapsDirections } from '../utils/navigation';

/** Proportion bars: how much of the total time is driving vs waiting. */
function TimeSplit({ station }: { station: Station }) {
  const total = station.total_time || 1;
  const drive = Math.max(station.distance_km, 0);
  const drivePct = Math.min(100, (drive / total) * 100);
  const waitPct = 100 - drivePct;
  return (
    <div className="mt-3">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-teal" style={{ width: `${waitPct}%` }} />
        <div className="h-full bg-slate-300" style={{ width: `${drivePct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] font-medium text-slate-500">
        <span className="text-teal">wait {Math.round(waitPct)}%</span>
        <span>drive {Math.round(drivePct)}%</span>
      </div>
    </div>
  );
}

export default function BestChoiceCard() {
  const stations = useStore((s) => s.stations);
  const filter = useStore((s) => s.filter);
  const selectStation = useStore((s) => s.selectStation);
  const selectedStationId = useStore((s) => s.selectedStationId);
  const location = useStore((s) => s.location);

  const visible = selectVisibleStations(stations, filter);
  const selected = visible.find((s) => s.id === selectedStationId);
  const best =
    visible.find((s) => s.is_best_choice) ??
    visible
      .filter((s) => s.is_operational)
      .sort((a, b) => a.total_time - b.total_time)[0];

  const navigateToStation = (station: Station) => {
    if (location) {
      openGoogleMapsDirections(location, {
        lat: station.latitude,
        lng: station.longitude,
      });
      return;
    }

    const destination = `${station.latitude},${station.longitude}`;
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    window.open(mapsUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="pointer-events-none absolute bottom-14 right-3 z-[1200] flex w-[272px] flex-col gap-2 sm:right-4">
      <AnimatePresence>
        {selected && (
          <motion.div
            key={`selected-${selected.id}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22 }}
            className="pointer-events-auto overflow-hidden rounded-2xl border border-brand/20 bg-white shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-line bg-blue-50 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
                  Your selection
                </p>
                <h3 className="truncate text-[14px] font-bold leading-tight text-ink">
                  {selected.name}
                </h3>
              </div>
              <button
                onClick={() => selectStation(null)}
                className="fw-focus shrink-0 rounded-full px-1.5 py-1 text-xs font-semibold text-slate-400 transition hover:bg-white hover:text-ink"
                title="Clear selected station"
                aria-label="Clear selected station"
              >
                ×
              </button>
            </div>
            <div className="px-3.5 py-3">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <p className="text-slate-500">Wait</p>
                  <p className="font-bold text-ink">{formatMinutes(selected.current_wait_time)}</p>
                </div>
                <div>
                  <p className="text-slate-500">Drive</p>
                  <p className="font-bold text-ink">{selected.distance_km.toFixed(1)} km</p>
                </div>
                <div>
                  <p className="text-slate-500">Total time</p>
                  <p className="font-bold text-ink">{formatMinutes(selected.total_time)}</p>
                </div>
                <div>
                  <p className="text-slate-500">Price</p>
                  <p className="font-bold text-ink">₹{selected.price}</p>
                </div>
              </div>
              <button
                onClick={() => navigateToStation(selected)}
                className="fw-focus mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand py-2.5 text-xs font-bold text-white transition hover:bg-brand-dark"
              >
                <Navigation className="size-4" strokeWidth={2} />
                Get directions
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {best ? (
          <motion.div
            key={best.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22 }}
            className="pointer-events-auto overflow-hidden rounded-2xl border border-line bg-white shadow-pop"
          >
            {/* Deep-blue header — primary highlight */}
            <div className="flex items-center gap-2.5 border-b border-line bg-brand px-3.5 py-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/20 text-white">
                <Award className="size-4" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  AI Best Pick · {filter}
                </p>
                <h3 className="truncate text-[15px] font-bold leading-tight text-white">
                  {best.name}
                </h3>
              </div>
            </div>

            <div className="px-4 pb-4 pt-3">
              <div className="flex items-end justify-between">
                <div>
                  <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <Clock className="size-3.5 text-brand" /> Total time
                  </p>
                  <p className="text-3xl font-bold leading-none text-ink">
                    {formatMinutes(best.total_time)}
                  </p>
                </div>
                <div className="text-right text-xs leading-5 text-slate-500">
                  <p className="flex items-center justify-end gap-1">
                    <MapPin className="size-3.5 text-slate-400" />
                    {best.distance_km.toFixed(1)} km
                  </p>
                  <p className="flex items-center justify-end gap-1 font-semibold text-ink">
                    <Fuel className="size-3.5 text-cng" /> ₹{best.price}
                  </p>
                </div>
              </div>

              <TimeSplit station={best} />

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => selectStation(best.id)}
                  className="fw-focus flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <Zap className="size-4 text-brand" strokeWidth={2} />
                  {selectedStationId === best.id ? 'Showing' : 'View pin'}
                </button>
                <button
                  onClick={() => navigateToStation(best)}
                  className="fw-focus flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand py-2.5 text-xs font-bold text-white transition hover:bg-brand-dark"
                >
                  <Navigation className="size-4" strokeWidth={2} /> Navigate
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto rounded-xl border border-line bg-white px-3 py-2 text-xs text-slate-500 shadow-card"
          >
            No operational {filter} stations nearby.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
