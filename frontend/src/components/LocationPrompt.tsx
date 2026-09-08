/**
 * FUELWISE — LocationPrompt (accessible light theme).
 *
 * First-run overlay shown BEFORE the map boots. Explains why we need the
 * location, then offers two paths:
 *   1. "Use my location" -> browser Geolocation permission prompt
 *
 * If the user denies/times-out, the prompt stays visible. The app never
 * invents a location or silently selects a default city.
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  Crosshair,
  Gauge,
  Loader2,
  MapPin,
  Radar,
  Zap,
} from 'lucide-react';
import { useEffect } from 'react';

import { useGeolocation } from '../hooks/useGeolocation';
import { useStore } from '../store/useStore';

const FEATURES = [
  { icon: Gauge, text: 'Real queue waits before you leave' },
  { icon: Radar, text: '18 CNG + 16 EV stations nearby' },
  { icon: Zap, text: 'AI best-pick routing in seconds' },
];

export default function LocationPrompt() {
  const { status, coords, error, requestLocation } = useGeolocation();
  const initLocation = useStore((s) => s.initLocation);

  // React to the geolocation state machine.
  useEffect(() => {
    if (status === 'success' && coords) {
      initLocation(coords);
      return;
    }
  }, [status, coords, initLocation]);

  const busy = status === 'loading';

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative w-full max-w-md rounded-3xl border border-line bg-white p-8 text-center shadow-pop"
      >
        {/* Brand-blue mark */}
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-brand shadow-md">
          <Crosshair className="size-7 text-white" strokeWidth={2} />
        </div>

        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-brand">
          Phase 1 · Fuel Routing
        </p>
        <h1 className="mt-2 text-[26px] font-bold leading-tight text-ink">
          Locate your fuel network
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
          FUELWISE maps every station within{' '}
          <b className="text-ink">10 km</b> and shows the real queue-wait
          before you drive. Allow location access to find the smartest pump
          near you.
        </p>

        {/* Feature bullets */}
        <ul className="mt-6 space-y-2.5 text-left">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="flex items-center gap-3 rounded-xl border border-line bg-slate-50 px-4 py-3 text-[15px] font-medium text-slate-700"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-faint text-brand">
                <Icon className="size-4.5" strokeWidth={2} />
              </span>
              {text}
            </li>
          ))}
        </ul>

        {/* CTA group */}
        <div className="mt-7 space-y-2.5">
          <button
            onClick={requestLocation}
            disabled={busy}
            className="fw-focus flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-[15px] font-bold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="size-5 animate-spin" /> Locating you…
              </>
            ) : (
              <>
                <MapPin className="size-5" strokeWidth={2} /> Use my location
              </>
            )}
          </button>

        </div>

        <AnimatePresence>
          {status === 'error' && error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger-dark"
            >
              {error} Allow location access to continue.
            </motion.p>
          )}
        </AnimatePresence>

        <p className="mt-6 text-xs leading-relaxed text-slate-400">
          Your position is used only to compute nearby stations — never stored
          or shared in Phase 1.
        </p>
      </motion.div>
    </div>
  );
}
