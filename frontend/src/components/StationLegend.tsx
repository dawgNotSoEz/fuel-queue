/**
 * FUELWISE — StationLegend (accessible color pin key).
 *
 * Teaches the color language at a glance: orange teardrop = CNG, blue
 * diamond = EV, grey + red slash = broken, thick green outline = best,
 * dashed red outline = avoid.
 */

import { Fuel } from 'lucide-react';

import { buildPinIcon } from '../utils/mapIcons';

// Representative pin states (purely static for the legend).
const CNG_NEUTRAL = {
  type: 'CNG' as const,
  is_operational: true,
  is_best_choice: false,
  is_worst_choice: false,
};
const CNG_BEST = { ...CNG_NEUTRAL, is_best_choice: true };
const CNG_WORST = { ...CNG_NEUTRAL, is_worst_choice: true };
const EV_NEUTRAL = {
  type: 'EV' as const,
  is_operational: true,
  is_best_choice: false,
  is_worst_choice: false,
};
const EV_BROKEN = { ...EV_NEUTRAL, is_operational: false };

const ROWS: { img: string; label: string }[] = [
  { img: buildPinIcon(CNG_NEUTRAL).url, label: 'CNG station' },
  { img: buildPinIcon(EV_NEUTRAL).url, label: 'EV charger' },
  { img: buildPinIcon(EV_BROKEN).url, label: 'EV broken' },
  { img: buildPinIcon(CNG_BEST).url, label: 'Best pick (AI)' },
  { img: buildPinIcon(CNG_WORST).url, label: 'Avoid now' },
];

export default function StationLegend() {
  return (
    <div className="pointer-events-auto hidden w-48 rounded-2xl border border-line bg-white p-3 shadow-card md:block">
      <p className="mb-2.5 flex items-center gap-1.5 border-b border-line pb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <Fuel className="size-3.5 text-cng" /> Pin key
      </p>
      <ul className="space-y-2">
        {ROWS.map((row) => (
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
    </div>
  );
}
