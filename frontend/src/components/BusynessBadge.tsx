/**
 * FUELWISE — BusynessBadge.
 *
 * Compact "live busyness" chip for tight surfaces (map cards, list rows):
 * a coloured dot, the Google-style headline and the queue wait, e.g.
 * "🟠 Busy · 12 min". Reads the same model as the full
 * `PopularTimesChart`, so both always agree.
 */

import { useBusyness } from '../hooks/useBusyness';
import { useStore } from '../store/useStore';
import type { Station } from '../types';
import { BUSYNESS_STYLE, busynessSummary } from '../utils/busyness';
import { formatMinutes } from '../utils/geo';

interface Props {
  station: Station;
  /** Show the headline word ("Busy") next to the wait. */
  showHeadline?: boolean;
  className?: string;
}

export default function BusynessBadge({
  station,
  showHeadline = true,
  className = '',
}: Props) {
  const weather = useStore((st) => st.weather?.condition ?? null);
  const { live } = useBusyness(station, weather);
  const style = BUSYNESS_STYLE[live.level];

  if (!station.is_operational) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border border-line bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-muted ${className}`}
      >
        Offline
      </span>
    );
  }

  return (
    <span
      title={`Live busyness — ${busynessSummary(live)}`}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${style.chip} ${className}`}
    >
      <span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden />
      {showHeadline && <span>{live.headline}</span>}
      <span className="font-semibold opacity-90">
        {showHeadline ? '·' : ''} {formatMinutes(live.liveWait)}
      </span>
    </span>
  );
}
