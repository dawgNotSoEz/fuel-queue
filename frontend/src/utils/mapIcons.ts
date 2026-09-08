/**
 * FUELWISE — accessible SVG pin factory for Leaflet markers.
 *
 * Warm, high-contrast colors (no black-only UI):
 *
 *   CNG          · orange (#f97316) teardrop + white core
 *   EV           · blue (#3b82f6) diamond + white bolt
 *   EV broken    · grey (#94a3b8) diamond + red slash + dim bolt
 *
 * Decision outline on the pin silhouette:
 *   Best   · thick SOLID GREEN (#059669) outline
 *   Worst  · thin DASHED RED (#b91c1c) outline
 *   Normal · thin dark-slate outline
 */

import type { Station } from '../types';

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
>;

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

  // Body + silhouette outline.
  const fill = isCNG ? '#f97316' : broken ? '#94a3b8' : '#3b82f6';
  const path = `<path d="${isCNG ? CNG_PATH : EV_PATH}" fill="${fill}" stroke="${outline.color}" stroke-width="${outline.width}" stroke-dasharray="${outline.dash}" stroke-linejoin="round"/>`;

  // Interior glyph.
  let glyph = '';
  if (isCNG) {
    glyph =
      `<circle cx="22" cy="22" r="8.6" fill="#ffffff"/>` +
      glyphEl('translate(22 22) scale(0.42) translate(-12 -12)', DROP_DARK);
  } else {
    const boltFill = broken ? '#e2e8f0' : '#ffffff';
    glyph = glyphEl(
      'translate(22 24) scale(0.62) translate(-12 -12)',
      bolt(boltFill),
    );
    // Broken charger → clear red diagonal slash over the charger.
    if (broken) {
      glyph +=
        '<line x1="12" y1="12" x2="32" y2="36" stroke="#b91c1c" stroke-width="4" stroke-linecap="round"/>';
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

