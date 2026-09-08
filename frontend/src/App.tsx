/**
 * FUELWISE — App shell (Phase 1).
 *
 * Flow:
 *   1. Render Navbar (mock auth) always.
 *   2. Until a location resolves -> full-screen LocationPrompt overlay.
 *   3. Once resolved -> mount the light map + filters + live simulator.
 *
 * The live simulator re-rolls queue waits every 10 s (see constants.ts).
 */

import { useEffect } from 'react';

import FilterToggle from './components/FilterToggle';
import LocationPrompt from './components/LocationPrompt';
import MapContainer from './components/MapContainer';
import Navbar from './components/Navbar';
import { useStore } from './store/useStore';
import { SIMULATION_INTERVAL_MS } from './utils/constants';

/** Drives the mock "real-time" telemetry loop while the map is live. */
function SimulationLoop() {
  const locationReady = useStore((s) => s.location !== null);
  const runSimulationTick = useStore((s) => s.runSimulationTick);

  useEffect(() => {
    if (!locationReady) return;
    const id = window.setInterval(runSimulationTick, SIMULATION_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [locationReady, runSimulationTick]);

  return null;
}

export default function App() {
  const location = useStore((s) => s.location);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-canvas font-sans text-ink">
      <Navbar />

      {location ? (
        <>
          <MapContainer />
          <FilterToggle />
        </>
      ) : (
        <LocationPrompt />
      )}

      <SimulationLoop />
    </div>
  );
}
