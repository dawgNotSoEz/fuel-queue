/**
 * FUELWISE — MapContainer (React Leaflet + OpenStreetMap).
 *
 * Responsibilities:
 *   • Render the free OSM tile layer on the light canvas.
 *   • Plot accessible colored CNG/EV pins (see utils/mapIcons): orange CNG,
 *     blue EV, grey+slash broken; green outline = best, dashed red = avoid.
 *   • Respect the "Hide broken" filter so offline chargers can be hidden.
 *   • Show a station card for the selected pin, projected over the pin and
 *     kept in sync while the map moves/zooms.
 *   • Auto-fit bounds on first load and whenever the fuel filter changes
 *     (NOT on every 10 s live tick).
 *   • Overlays: LIVE chip, zoom control, pin legend, demo notice, best-pick card.
 *
 * No API keys required.
 */

import * as L from 'leaflet';
import { MapPin, Radio, X } from 'lucide-react';
import {
  MapContainer as LeafletMap,
  Marker,
  TileLayer,
  useMap,
} from 'react-leaflet';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { selectVisibleStations, useStore } from '../store/useStore';
import type { FuelType, Station } from '../types';
import { DEFAULT_ZOOM } from '../utils/constants';
import { OSM_ATTRIBUTION, OSM_TILE_URL } from '../utils/mapDarkStyles';
import { buildPinIcon } from '../utils/mapIcons';
import BestChoiceCard from './BestChoiceCard';
import StationInfoWindow from './StationInfoWindow';
import StationLegend from './StationLegend';

// ----------------------------------------------------------------------
// Single station pin (custom memo: re-render only when the PIN's visual
// inputs change — live wait-time ticks never rebuild unchanged markers).
// ----------------------------------------------------------------------
interface StationMarkerProps {
  station: Station;
  selected: boolean;
  onSelect: (id: string) => void;
}

const StationMarker = memo(
  function StationMarker({ station, selected, onSelect }: StationMarkerProps) {
    const icon = useMemo(() => {
      const spec = buildPinIcon({
        type: station.type,
        is_operational: station.is_operational,
        is_best_choice: station.is_best_choice,
        is_worst_choice: station.is_worst_choice,
      });
      return L.icon({
        iconUrl: spec.url,
        iconSize: [spec.width, spec.height],
        iconAnchor: [spec.anchorX, spec.anchorY],
        className: '',
      });
    }, [
      station.type,
      station.is_operational,
      station.is_best_choice,
      station.is_worst_choice,
    ]);

    return (
      <Marker
        position={[station.latitude, station.longitude]}
        icon={icon}
        zIndexOffset={selected ? 900 : station.is_best_choice ? 300 : 0}
        keyboard
        eventHandlers={{
          click: (e) => {
            // Stop the event reaching the map (which would deselect).
            L.DomEvent.stopPropagation(e.originalEvent);
            onSelect(station.id);
          },
        }}
      />
    );
  },
  (prev, next) =>
    prev.selected === next.selected &&
    prev.onSelect === next.onSelect &&
    prev.station.id === next.station.id &&
    prev.station.type === next.station.type &&
    prev.station.is_operational === next.station.is_operational &&
    prev.station.is_best_choice === next.station.is_best_choice &&
    prev.station.is_worst_choice === next.station.is_worst_choice,
);

// ----------------------------------------------------------------------
// "You are here" dot — brand-blue centre with soft pulse (see index.css).
// ----------------------------------------------------------------------
function UserMarker({ lat, lng }: { lat: number; lng: number }) {
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'fw-user-dot',
        html: '<span></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    [lat, lng],
  );
  return (
    <Marker
      position={[lat, lng]}
      icon={icon}
      zIndexOffset={1000}
      interactive={false}
    />
  );
}

// ----------------------------------------------------------------------
// Fit the visible cloud on first load + filter switch (never on ticks).
// ----------------------------------------------------------------------
function BoundsFitter({ filter }: { filter: FuelType }) {
  const map = useMap();
  const stations = useStore((s) => s.stations);
  const lastKey = useRef<string>('');

  useEffect(() => {
    const list = stations.filter((s) => s.type === filter);
    if (list.length === 0) return;
    if (lastKey.current === filter) return; // live ticks must not refit

    lastKey.current = filter;
    const bounds = L.latLngBounds(
      list.map((s) => [s.latitude, s.longitude] as [number, number]),
    );
    map.fitBounds(bounds, {
      paddingTopLeft: L.point(24, 96), // clear navbar + filter pill
      paddingBottomRight: L.point(320, 96), // clear best-pick card + attribution
      maxZoom: 14,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, filter]); // `stations` intentionally excluded

  return null;
}

// ----------------------------------------------------------------------
// Map-level events: clicking blank map deselects the current pin.
// ----------------------------------------------------------------------
function MapEvents({ onBackgroundClick }: { onBackgroundClick: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on('click', onBackgroundClick);
    return () => {
      map.off('click', onBackgroundClick);
    };
  }, [map, onBackgroundClick]);
  return null;
}

// ----------------------------------------------------------------------
// Reports the Leaflet map instance upward once it exists (the forwarded
// ref on MapContainer is unreliable in some React 18 setups).
// ----------------------------------------------------------------------
function MapReporter({ onMapReady }: { onMapReady: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);
  return null;
}

// ----------------------------------------------------------------------
// Floating map chrome
// ----------------------------------------------------------------------
function LiveChip() {
  const dataSource = useStore((s) => s.dataSource);
  const live = dataSource === 'api' || dataSource === 'live';
  const label = live ? 'Real station feed' : 'Connecting…';
  const dot = live ? 'text-success' : 'text-slate-400';
  return (
    <div className="pointer-events-none flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 shadow-card">
      <Radio className={`size-3.5 ${dot}`} />
      {label}
      {dataSource && <span className="hidden text-slate-400 sm:inline">· 5s</span>}
    </div>
  );
}

// ----------------------------------------------------------------------
// Selected-station card — projected onto the pin's screen position and
// re-projected whenever the map moves/zooms (fully controlled).
// ----------------------------------------------------------------------
function SelectedStationCard({
  map,
  station,
  onClose,
}: {
  map: L.Map | null;
  station: Station;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const { latitude, longitude } = station;

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const containerPoint = map.latLngToContainerPoint([
        latitude,
        longitude,
      ]);
      const rect = map.getContainer().getBoundingClientRect();
      setPos({
        x: rect.left + containerPoint.x,
        y: rect.top + containerPoint.y,
      });
    };
    update();
    map.on('move zoom resize', update);
    return () => {
      map.off('move zoom resize', update);
    };
  }, [map, latitude, longitude]);

  if (!pos) return null;

  return (
    <div
      className="pointer-events-none fixed z-[1400] -translate-x-1/2 -translate-y-full"
      style={{ left: pos.x, top: pos.y - 64 }}
    >
      <div className="pointer-events-auto relative w-[316px] overflow-hidden rounded-2xl border border-line bg-white text-ink shadow-pop">
        <button
          onClick={onClose}
          title="Close"
          className="fw-focus absolute right-2 top-2 z-10 grid size-8 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-ink"
        >
          <X className="size-4" />
        </button>
        <StationInfoWindow station={station} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Main map component
// ----------------------------------------------------------------------
export default function MapContainer() {
  const location = useStore((s) => s.location)!;
  const stations = useStore((s) => s.stations);
  const filter = useStore((s) => s.filter);
  const hideBroken = useStore((s) => s.hideBroken);
  const selectedStationId = useStore((s) => s.selectedStationId);
  const selectStation = useStore((s) => s.selectStation);
  const notice = useStore((s) => s.notice);
  const clearNotice = useStore((s) => s.clearNotice);

  // React-leaflet reports its map instance through the MapReporter child.
  const [map, setMap] = useState<L.Map | null>(null);
  const onMapReady = useCallback((m: L.Map) => setMap(m), []);

  /** Stations under the active fuel filter (minus hidden broken ones). */
  const visible = useMemo(
    () => selectVisibleStations(stations, filter, hideBroken),
    [stations, filter, hideBroken],
  );

  /** Selection is only meaningful while its pin is actually on screen. */
  const selectedStation = useMemo(
    () => visible.find((s) => s.id === selectedStationId) ?? null,
    [visible, selectedStationId],
  );

  const onBackgroundClick = useCallback(() => selectStation(null), [
    selectStation,
  ]);

  return (
    <main className="absolute inset-0 overflow-hidden">
      {/* ---------- Map surface ---------- */}
      <div className="fw-map absolute inset-0">
        <LeafletMap
          center={[location.lat, location.lng]}
          zoom={DEFAULT_ZOOM}
          minZoom={3}
          maxZoom={18}
          className="h-full w-full"
          scrollWheelZoom
        >
          <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
          <MapReporter onMapReady={onMapReady} />

          <UserMarker lat={location.lat} lng={location.lng} />
          {visible.map((s) => (
            <StationMarker
              key={s.id}
              station={s}
              selected={s.id === selectedStationId}
              onSelect={selectStation}
            />
          ))}

          <BoundsFitter filter={filter} />
          <MapEvents onBackgroundClick={onBackgroundClick} />
        </LeafletMap>
      </div>

      {/* ---------- Selected station card (above the map) ---------- */}
      {selectedStation && (
        <SelectedStationCard
          key={selectedStation.id}
          map={map}
          station={selectedStation}
          onClose={() => selectStation(null)}
        />
      )}

      {/* ---------- Floating chrome ---------- */}
      {/* LIVE feed chip (top-right, below navbar) */}
      <div className="pointer-events-none absolute right-4 top-20 z-[1200]">
        <LiveChip />
      </div>

      {/* Pin key (bottom-left) */}
      <div className="pointer-events-none absolute bottom-4 left-3 z-[1200] sm:left-4">
        <StationLegend />
      </div>

      {/* Demo / denial notice (bottom-centre) */}
      {notice && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[1200] flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs leading-relaxed text-slate-600 shadow-card">
            <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>{notice}</span>
            <button
              onClick={clearNotice}
              className="fw-focus shrink-0 rounded-full text-slate-400 transition hover:text-ink"
              title="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* AI best-pick readout (bottom-right, above attribution) */}
      <BestChoiceCard />
    </main>
  );
}
