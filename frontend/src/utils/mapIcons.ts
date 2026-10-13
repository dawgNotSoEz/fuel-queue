/**
 * FUELWISE — accessible SVG pin factory for Leaflet markers.
 *
 * COLOUR = HOW BUSY IT IS RIGHT NOW
 * ---------------------------------
 * The pin body is coloured by the live busyness of the area around the pump,
 * derived from the real places mapped nearby on OpenStreetMap + the current
 * queue:
 *
 *   green  (#16a34a) · Not busy        — go now
 *   amber  (#d97706) · A little busy
 *   orange (#f97316) · Busy
 *   red    (#dc2626) · As busy as it gets
 *   grey   (#94a3b8) · Offline / broken (red slash, never a busyness colour)
 *
 * SHAPE = WHICH FUEL
 *   CNG · teardrop + fuel drop badge
 *   EV  · diamond  + bolt badge
 *
 * The white badge keeps the fuel glyph readable on every busyness colour.
 * Decision outline on the pin silhouette:
 *   Best   · thick SOLID GREEN (#059669) outline
 *   Worst  · thin DASHED RED (#b91c1c) outline
 *   Normal · thin dark-slate outline
 */

import type { BusynessLevel, Station } from '../types';
import { BUSYNESS_STYLE } from './busyness';

export interface PinSpec {
  /** data-URI SVG url */
  url: string;
  width: number;
  height: number;
  /** Leaflet iconAnchor: tip of the pin (px) */
  anchorX: number;
  anchorY: number;
}

type PinFlags = Pick<
  Station,
  'type' | 'is_operational' | 'is_best_choice' | 'is_worst_choice'
> & {
  /** Live busyness of the area — drives the pin colour. */
  busyness?: BusynessLevel;
};

/** Pin body colour per busyness level (single source of truth: busyness.ts). */
export const PIN_BUSY_HEX: Record<BusynessLevel, string> = {
  'not-busy': BUSYNESS_STYLE['not-busy'].hex,
  moderate: BUSYNESS_STYLE.moderate.hex,
  busy: BUSYNESS_STYLE.busy.hex,
  peak: BUSYNESS_STYLE.peak.hex,
};

/** Human label per busyness level (used by the pin key). */
export const PIN_BUSY_LABEL: Record<BusynessLevel, string> = {
  'not-busy': 'Not busy',
  moderate: 'A little busy',
  busy: 'Busy',
  peak: 'As busy as it gets',
};

// ----------------------------------------------------------------------
// Geometry
// ----------------------------------------------------------------------

/** CNG teardrop silhouette (tip ≈ y 59). */
const CNG_PATH =
  'M22 4 C11.9 4 4 12 4 23 C4 33.5 18.2 54 22 59.4 C25.8 54 40 33.5 40 23 C40 12 32.1 4 22 4 Z';

/** EV diamond silhouette (bottom vertex ≈ y 42). */
const EV_PATH = 'M22 6 L40 24 L22 42 L4 24 Z';

/** Droplet glyph (CNG) — drawn on a white core for maximum contrast. */
const DROP_DARK =
  '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" fill="#9a3412"/>';

/** Bolt glyph (EV). */
function bolt(fill: string): string {
  return `<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" fill="${fill}"/>`;
}

function glyphEl(transform: string, inner: string): string {
  return `<g transform="${transform}">${inner}</g>`;
}

// ----------------------------------------------------------------------
// Silhouette outline — carries Best / Worst / Broken semantics
// ----------------------------------------------------------------------
function resolveOutline(station: PinFlags): {
  color: string;
  width: number;
  dash: string;
} {
  if (!station.is_operational) {
    return { color: '#64748b', width: 1.4, dash: '' };
  }
  if (station.is_best_choice) {
    return { color: '#059669', width: 3.4, dash: '' }; // recommended — go!
  }
  if (station.is_worst_choice) {
    return { color: '#b91c1c', width: 1.8, dash: '6 4' }; // avoid — dashed red
  }
  return { color: '#0f172a', width: 1.5, dash: '' };
}

/** Build the pin SVG and return a data-URI consumable by L.icon(). */
export function buildPinIcon(station: PinFlags): PinSpec {
  const isCNG = station.type === 'CNG';
  const broken = !station.is_operational;
  const outline = resolveOutline(station);

  // SVG canvas sized for the exact head shape (no dead space under the tip).
  const width = 44;
  const height = isCNG ? 62 : 52;
  const anchorX = 22;
  const anchorY = isCNG ? 60 : 44;

  // Body fill = live busyness. Broken chargers never borrow a busyness colour.
  const fill = broken
    ? '#94a3b8'
    : PIN_BUSY_HEX[station.busyness ?? 'moderate'];
  const path = `<path d="${isCNG ? CNG_PATH : EV_PATH}" fill="${fill}" stroke="${outline.color}" stroke-width="${outline.width}" stroke-dasharray="${outline.dash}" stroke-linejoin="round"/>`;

  // Interior glyph: always on a white badge so the fuel stays readable on any
  // busyness colour (green → red).
  let glyph = '';

  if (isCNG) {
    glyph =
      `<circle cx="22" cy="23" r="9" fill="#ffffff"/>` +
      glyphEl('translate(22 23) scale(0.44) translate(-12 -12)', DROP_DARK);
  } else {
    const badgeY = 24;
    glyph = `<circle cx="22" cy="${badgeY}" r="9" fill="#ffffff"/>`;
    if (broken) {
      glyph += glyphEl(
        `translate(22 ${badgeY}) scale(0.6) translate(-12 -12)`,
        bolt('#cbd5e1'),
      );
      // Broken charger → clear red diagonal slash over the badge.
      glyph +=
        '<line x1="12" y1="13" x2="32" y2="35" stroke="#b91c1c" stroke-width="4" stroke-linecap="round"/>';
    } else {
      glyph += glyphEl(
        `translate(22 ${badgeY}) scale(0.62) translate(-12 -12)`,
        bolt('#1d4ed8'),
      );
    }
  }

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '">' +
    path +
    glyph +
    '</svg>';

  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width,
    height,
    anchorX,
    anchorY,
  };
}

