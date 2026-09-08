/**
 * FUELWISE — backwards-compatible shim.
 *
 * The store now lives in `./useStore.ts` (per the project file structure).
 * This module re-exports it so older import paths keep working.
 */

export {
  useFuelStore,
  useStore,
  selectVisibleStations,
} from './useStore';
