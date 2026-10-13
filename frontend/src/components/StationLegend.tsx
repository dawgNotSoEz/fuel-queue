/**
 * FUELWISE — StationLegend (accessible pin + busyness key).
 *
 * Teaches the colour language at a glance:
 *   • the pin BODY colour is how busy the area is right now
 *     (green → amber → orange → red),
 *   • the pin SHAPE is the fuel type (CNG teardrop, EV diamond),
 *   • grey + red slash = broken, thick green outline = best, dashed red = avoid.
 */

import { Fuel } from 'lucide-react';

import type { BusynessLevel } from '../types';
import { PIN_BUSY_HEX, PIN_BUSY_LABEL, buildPinIcon } from '../utils/mapIcons';

// Representative pin states (purely static for the legend).
const CNG_NEUTRAL = {
  type: 'CNG' as const,
  is_operational: true,
  is_best_choice: false,
  is_worst_choice: false,
  busyness: 'moderate' as BusynessLevel,
};
const EV_NEUTRAL = {
  type: 'EV' as const,
  is_operational: true,
  is_best_choice: false,
  is_worst_choice: false,
  busyness: 'moderate' as BusynessLevel,
};
const EV_BROKEN = { ...EV_NEUTRAL, is_operational: false };
const CNG_BEST = { ...CNG_NEUTRAL, is_best_choice: true };

const PIN_ROWS: { img: string; label: string }[] = [
  { img: buildPinIcon(CNG_NEUTRAL).url, label: 'CNG pump' },
  { img: buildPinIcon(EV_NEUTRAL).url, label: 'EV charger' },
  { img: buildPinIcon(EV_BROKEN).url, label: 'Offline / broken' },
  { img: buildPinIcon(CNG_BEST).url, label: 'Best pick (AI)' },
];

const BUSY_LEVELS: BusynessLevel[] = [
  'not-busy',
  'moderate',
  'busy',
  'peak',
];

export default function StationLegend() {
  return (
    <div className="pointer-events-auto hidden w-48 rounded-2xl border border-line bg-white p-3 shadow-card md:block">
      <p className="mb-2 flex items-center gap-1.5 border-b border-line pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <Fuel className="size-3.5 text-cng" /> Busy right now
      </p>
      <ul className="space-y-1.5">
        {BUSY_LEVELS.map((level) => (
          <li key={level} className="flex items-center gap-2">
            <span
              className="size-3 shrink-0 rounded-full ring-1 ring-slate-900/15"
              style={{ backgroundColor: PIN_BUSY_HEX[level] }}
              aria-hidden
            />
            <span className="text-xs font-medium text-slate-700">
              {PIN_BUSY_LABEL[level]}
            </span>
          </li>
        ))}
      </ul>

      <p className="mb-2 mt-3 flex items-center gap-1.5 border-b border-line pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <Fuel className="size-3.5 text-cng" /> Pin shape
      </p>
      <ul className="space-y-2">
        {PIN_ROWS.map((row) => (
          <li key={row.label} className="flex items-center gap-2.5">
            <img
              src={row.img}
              alt=""
              className="h-7 w-auto shrink-0 object-contain"
            />
            <span className="text-xs font-medium text-slate-700">
              {row.label}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 border-t border-line pt-2 text-[10px] leading-snug text-faint">
        Colour comes from the real places mapped around each pump
        (OpenStreetMap) plus its live queue.
      </p>
    </div>
  );
}
