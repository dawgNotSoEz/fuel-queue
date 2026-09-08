/**
 * FUELWISE — FilterToggle (CNG / EV pill switch + "Hide Broken").
 *
 * Floating control above the map. CNG active = orange, EV active = blue.
 * The secondary switch hides non-operational (broken/offline) chargers —
 * default OFF so broken pins stay visible with their red "Broken" style.
 */

import { EyeOff, Fuel, Zap } from 'lucide-react';

import { useStore } from '../store/useStore';
import type { FuelType } from '../types';

interface Option {
  key: FuelType;
  label: string;
  icon: typeof Fuel;
  /** Active pill style for this fuel */
  activeClass: string;
}

const OPTIONS: Option[] = [
  { key: 'CNG', label: 'CNG', icon: Fuel, activeClass: 'bg-cng text-white' },
  { key: 'EV', label: 'EV', icon: Zap, activeClass: 'bg-ev text-white' },
];

export default function FilterToggle() {
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const hideBroken = useStore((s) => s.hideBroken);
  const toggleHideBroken = useStore((s) => s.toggleHideBroken);
  const stations = useStore((s) => s.stations);

  const countFor = (type: FuelType) =>
    stations.filter((st) => st.type === type && st.is_operational).length;

  // "Hide Broken" only affects EV chargers today; show a live broken count.
  const brokenCount = stations.filter(
    (st) => st.type === 'EV' && !st.is_operational,
  ).length;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-[1200] flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-slate-300 bg-white p-1.5 shadow-card">
        {/* Fuel pills */}
        {OPTIONS.map(({ key, label, icon: Icon, activeClass }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              aria-pressed={active}
              className={`fw-focus relative flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-colors ${
                active
                  ? activeClass
                  : 'text-slate-600 hover:bg-slate-100 hover:text-ink'
              }`}
            >
              <Icon className="size-4" strokeWidth={2.4} />
              <span>{label}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${
                  active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {countFor(key)}
              </span>
            </button>
          );
        })}

        {/* Divider */}
        <span className="mx-1 h-7 w-px bg-slate-200" aria-hidden />

        {/* Hide Broken toggle */}
        <button
          onClick={toggleHideBroken}
          aria-pressed={hideBroken}
          title={
            hideBroken
              ? 'Broken chargers are hidden — tap to show them'
              : 'Tap to hide broken chargers'
          }
          className={`fw-focus flex items-center gap-2 rounded-full px-3.5 py-2.5 text-sm font-semibold transition-colors ${
            hideBroken
              ? 'bg-slate-800 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-ink'
          }`}
        >
          <EyeOff
            className={`size-4 ${hideBroken ? 'text-white' : 'text-slate-400'}`}
            strokeWidth={2.2}
          />
          <span className="whitespace-nowrap">Hide broken</span>
          {brokenCount > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${
                hideBroken
                  ? 'bg-white/20 text-white'
                  : brokenCount > 0
                    ? 'bg-danger-soft text-danger-dark'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {hideBroken ? `hidden` : brokenCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
