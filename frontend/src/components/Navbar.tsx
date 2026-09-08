/**
 * FUELWISE — Navbar (accessible light theme).
 *
 *  Left:   FUELWISE wordmark with a deep-blue bolt mark.
 *  Right:  mock auth — Sign In / Guest buttons, placeholder avatar,
 *          then a signed-in chip once a user "signs in".
 *
 * Deep blue (#1a56db) is the primary accent for actions & brand.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, MapPin, UserRound, Zap } from 'lucide-react';

import { useStore } from '../store/useStore';

export default function Navbar() {
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const location = useStore((s) => s.location);

  const signIn = () =>
    setUser({ mode: 'signed-in', name: 'Alex Rivera', initials: 'AR' });
  const guestMode = () =>
    setUser({ mode: 'guest', name: 'Guest', initials: '?' });
  const signOut = () => setUser(null);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-[1300]">
      <div className="pointer-events-auto flex h-16 items-center justify-between gap-3 border-b border-line bg-white/90 px-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-xl sm:px-6">
        {/* ---------- Brand ---------- */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand shadow-sm">
            <Zap className="size-5 text-white" strokeWidth={2.6} />
          </div>
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-[0.18em] text-ink">
              FUELWISE
            </p>
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.3em] text-muted sm:block">
              CNG · EV Routing
            </p>
          </div>
        </div>

        {/* ---------- Right: profile (mock auth) ---------- */}
        <div className="flex items-center gap-2">
          {/* Location source pill (subtle) */}
          <AnimatePresence>
            {location && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mr-1 hidden items-center gap-1.5 rounded-full border border-line bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 md:flex"
              >
                <MapPin className="size-3.5 text-brand" />
                {location.label}
              </motion.div>
            )}
          </AnimatePresence>

          {user === null ? (
            <>
              {/* Guest mode — quiet secondary button */}
              <button
                onClick={guestMode}
                className="fw-focus rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:text-ink"
              >
                Guest Mode
              </button>

              {/* Sign in — primary deep-blue */}
              <button
                onClick={signIn}
                className="fw-focus rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-brand-dark"
              >
                Sign In
              </button>

              {/* Placeholder avatar */}
              <div
                title="Signed out"
                className="grid size-9 place-items-center rounded-full border border-slate-300 bg-slate-100 text-slate-500"
              >
                <UserRound className="size-5" />
              </div>
            </>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pl-1 pr-2 shadow-sm"
            >
              <div
                className={`grid size-8 place-items-center rounded-full text-xs font-bold ${
                  user.mode === 'guest'
                    ? 'border border-dashed border-slate-400 text-slate-500'
                    : 'bg-brand text-white'
                }`}
              >
                {user.initials}
              </div>
              <span className="max-w-[7rem] truncate text-xs font-semibold text-ink">
                {user.name}
              </span>
              {user.mode === 'signed-in' && (
                <button
                  onClick={signOut}
                  title="Sign out"
                  className="fw-focus ml-1 grid size-7 place-items-center rounded-full text-slate-400 transition hover:bg-danger-soft hover:text-danger"
                >
                  <LogOut className="size-3.5" />
                </button>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </header>
  );
}
