/**
 * FUELWISE — Zustand global store (Phase 2: backend API as data source).
 *
 * Station loading order:
 *   1. FastAPI backend  (GET http://localhost:8000/api/stations)
 *   2. OpenStreetMap/Overpass real stations  (free, no key)
 *   3. Local realistic simulator  (offline fallback)
 *
 * While the backend is the active source the store POLLS it on the same
 * 5 s cadence as the local simulation used to use, so the map tracks the
 * backend's live engine automatically.
 */

import { create } from 'zustand';

import type {
  FuelType,
  MockUser,
  Station,
  UserLocation,
  WeatherSnapshot,
} from '../types';
import { fetchStationsFromApi } from '../utils/api';
import { forgetAllProfiles } from '../utils/busyness';
import {
  clearCrowdIndex,
  fetchCrowdIndex,
  setCrowdIndex,
} from '../utils/crowdContext';
import {
  applyLiveTick,
  evaluateStations,
  generateMockStations,
} from '../utils/mockDataGenerator';
import { fetchNearbyStations } from '../utils/overpassApi';
import { fetchWeather } from '../utils/weather';

export type StationSource = 'api' | 'live' | null;

/** Loading state of the real "crowd around each station" index (OSM). */
export type CrowdStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** Re-check the free weather feed at most this often. */
const WEATHER_REFRESH_MS = 10 * 60_000;
/** Back off this long before retrying an Overpass crowd lookup that failed. */
const CROWD_RETRY_MS = 5 * 60_000;

interface FuelStore {
  // ---- auth (mock until Phase 3) ----
  user: MockUser | null;

  // ---- geolocation ----
  location: UserLocation | null;
  /** Transient UI note for live location and data-source status. */
  notice: string | null;
  /** Where the current station cloud came from. */
  dataSource: StationSource;

  // ---- stations & filter ----
  stations: Station[];
  filter: FuelType;
  /** Hide non-operational (broken/offline) chargers from the map. */
  hideBroken: boolean;
  selectedStationId: string | null;

  // ---- live simulator / poller ----
  lastSimTick: number;

  // ---- free live context (no API keys anywhere) ----
  /** Current weather at the driver's position (Open-Meteo). */
  weather: WeatherSnapshot | null;
  /**
   * Real "who is around each pump" index, read from OpenStreetMap: the
   * category mix, intensity and source count per station id. Drives the
   * per-station busyness curve (see utils/crowdContext.ts).
   */
  crowdStatus: CrowdStatus;
  /** Bumped whenever the crowd index changes, so views re-derive profiles. */
  crowdVersion: number;

  // ---- actions ----
  setUser: (user: MockUser | null) => void;
  setFilter: (filter: FuelType) => void;
  toggleHideBroken: () => void;
  selectStation: (id: string | null) => void;
  /** Commit a resolved user location and (async) fetch stations nearby. */
  initLocation: (location: UserLocation, notice?: string | null) => void;
  /** Poll tick — refresh from API when connected, else local simulation. */
  runSimulationTick: () => void;
  /** Free live weather for the current position (silent when offline). */
  loadWeather: (force?: boolean) => void;
  /** Fetch + score the real crowd sources around the loaded stations. */
  loadCrowd: (force?: boolean) => void;
  clearNotice: () => void;
}

/** Guards against overlapping async station fetches (StrictMode remounts). */
let initToken = 0;
let tickToken = 0;
let weatherToken = 0;
let crowdToken = 0;
let weatherFetchedAt = 0;
let crowdRetryAt = 0;

export const useFuelStore = create<FuelStore>()((set, get) => ({
  user: null,
  location: null,
  notice: null,
  dataSource: null,

  stations: [],
  filter: 'CNG',
  hideBroken: false,
  selectedStationId: null,
  lastSimTick: Date.now(),

  weather: null,
  crowdStatus: 'idle',
  crowdVersion: 0,

  setUser: (user) => set({ user }),

  setFilter: (filter) =>
    set((s) => {
      // A selected pin of the other fuel type no longer exists on screen.
      const keepSelection =
        s.selectedStationId !== null &&
        s.stations.some(
          (st) => st.id === s.selectedStationId && st.type === filter,
        );
      return {
        filter,
        selectedStationId: keepSelection ? s.selectedStationId : null,
      };
    }),
  toggleHideBroken: () =>
    set((s) => {
      // Turning the filter ON may hide the currently selected broken pin.
      const nowHidden = !s.hideBroken;
      const selected = s.stations.find((st) => st.id === s.selectedStationId);
      const dropSelection =
        nowHidden && selected != null && !selected.is_operational;
      return {
        hideBroken: nowHidden,
        selectedStationId: dropSelection ? null : s.selectedStationId,
      };
    }),

  selectStation: (selectedStationId) => set({ selectedStationId }),

  initLocation: (location, notice = null) => {
    const ticket = ++initToken;

    // Drop any previous cloud (and its crowd context) while we look around.
    clearCrowdIndex();
    forgetAllProfiles();
    set(() => ({
      location,
      stations: [],
      dataSource: null,
      crowdStatus: 'idle',
      crowdVersion: 0,
      notice: notice ?? 'Connecting to FUELWISE backend…',
      selectedStationId: null,
    }));

    void (async () => {
      let stations: Station[] = [];
      let dataSource: Exclude<StationSource, null> = 'live';

      // 1) FastAPI backend (Phase 2 primary source).
      try {
        const apiRows = await fetchStationsFromApi({
          lat: location.lat,
          lng: location.lng,
        });
        if (apiRows.length > 0) {
          stations = apiRows;
          dataSource = 'api';
        }
      } catch {
        /* backend offline -> try real OSM next */
      }

      // 2) Real OpenStreetMap stations (free Overpass API, no key).
      if (stations.length === 0) {
        try {
          const live = await fetchNearbyStations(location);
          if (live.length > 0) {
            stations = live;
            dataSource = 'live';
          }
        } catch {
          /* offline / mirrors down -> fall through to the simulator */
        }
      }

      // Ignore the result if a newer initLocation superseded this one.
      if (ticket !== initToken) return;

      const finalStations =
        stations.length > 0
          ? evaluateStations(stations)
          : generateMockStations(location);

      set(() => ({
        stations: finalStations,
        dataSource: stations.length > 0 ? dataSource : 'live',
        lastSimTick: Date.now(),
        notice:
          dataSource === 'api'
            ? notice
            : stations.length > 0
              ? 'No demo stations here — showing real nearby stations from OpenStreetMap.'
              : 'No real stations found within 10 km of your location. Showing simulation data instead.',
      }));

      // Free live context for the same position (both fail silently).
      get().loadWeather();
      get().loadCrowd(true);
    })();
  },

  runSimulationTick: () => {
    const { dataSource, location } = get();
    if (!location) return;

    // Free live context: both calls are internally rate-limited, so the 5 s
    // station tick can safely ask for them.
    get().loadWeather();
    get().loadCrowd();

    // API-connected → poll the backend (it refreshes itself every 5 s).
    if (dataSource === 'api') {
      const ticket = ++tickToken;
      void (async () => {
        try {
          const fresh = await fetchStationsFromApi({
            lat: location.lat,
            lng: location.lng,
          });
          if (ticket !== tickToken) return;
          set(() => ({
            stations: evaluateStations(fresh),
            lastSimTick: Date.now(),
          }));
        } catch {
          // transient failure — keep last snapshot; the chip shows staleness
        }
      })();
      return;
    }

    // Simulated / live-OSM source → local random-walk feed.
    set((s) => {
      const nextStations =
        s.stations.length > 0
          ? applyLiveTick(s.stations)
          : generateMockStations(location);

      return {
        stations: nextStations,
        lastSimTick: Date.now(),
      };
    });
  },

  loadWeather: (force = false) => {
    const { location } = get();
    if (!location) return;
    if (!force && Date.now() - weatherFetchedAt < WEATHER_REFRESH_MS) return;
    weatherFetchedAt = Date.now();

    const ticket = ++weatherToken;
    void (async () => {
      const snapshot = await fetchWeather(location);
      if (ticket !== weatherToken || !snapshot) return;
      set(() => ({ weather: snapshot }));
    })();
  },

  loadCrowd: (force = false) => {
    const { location, stations, crowdStatus } = get();
    if (!location || stations.length === 0) return;
    if (crowdStatus === 'loading' && !force) return;
    // The OSM snapshot itself is cached for 15 min inside crowdContext, so a
    // 'ready' index only needs the cheap re-score when stations move.
    if (crowdStatus === 'ready' && !force) return;
    // A failed Overpass lookup must not be retried on every 5 s station tick.
    if (!force && Date.now() < crowdRetryAt) return;

    const ticket = ++crowdToken;
    if (crowdStatus !== 'ready') set(() => ({ crowdStatus: 'loading' }));

    void (async () => {
      try {
        const index = await fetchCrowdIndex(stations, location);
        if (ticket !== crowdToken) return;
        setCrowdIndex(index);
        // Profiles are derived from the mix, so stale ones must be dropped.
        forgetAllProfiles();
        crowdRetryAt = 0;
        set((s) => ({ crowdStatus: 'ready', crowdVersion: s.crowdVersion + 1 }));
      } catch {
        if (ticket !== crowdToken) return;
        // Offline / Overpass rate-limited — keep the deterministic fallback
        // mix so the histogram still differs station by station.
        crowdRetryAt = Date.now() + CROWD_RETRY_MS;
        set(() => ({ crowdStatus: 'unavailable' }));
      }
    })();
  },

  clearNotice: () => set({ notice: null }),
}));

/** Canonical export name used by the UI. */
export const useStore = useFuelStore;

/**
 * Stations visible under the active fuel filter (optionally hiding
 * broken / offline chargers).
 */
export function selectVisibleStations(
  stations: Station[],
  filter: FuelType,
  hideBroken = false,
): Station[] {
  return stations.filter(
    (s) => s.type === filter && (!hideBroken || s.is_operational),
  );
}
