/**
 * FUELWISE — useGeolocation hook.
 *
 * Thin wrapper over the browser Geolocation API with a state machine the
 * LocationPrompt overlay can react to:
 *
 *   idle -> loading -> success | error
 *
 * If the user denies (or the lookup fails/timeouts) the caller is expected
 * to fall back to the default Pune city centre — see App.tsx.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { UserLocation } from '../types';
import { resolveEnvCenter } from '../utils/constants';

export type GeoStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseGeolocationResult {
  status: GeoStatus;
  /** Resolved position when status === 'success'. */
  coords: UserLocation | null;
  /** Human-readable failure reason (permission / timeout / unavailable). */
  error: string | null;
  /** Trigger the browser permission prompt + GPS fix. */
  requestLocation: () => void;
  /** Build the guaranteed-to-work fallback centre (Pune). */
  fallbackLocation: () => UserLocation;
}

export function useGeolocation(): UseGeolocationResult {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [coords, setCoords] = useState<UserLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => () => { requestId.current += 1; }, []);

  const fallbackLocation = useCallback<UseGeolocationResult['fallbackLocation']>(
    () => {
      const center = resolveEnvCenter();
      return {
        lat: center.lat,
        lng: center.lng,
        source: 'fallback',
        label: 'Pune · Demo Region',
      };
    },
    [],
  );

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by this browser.');
      setStatus('error');
      return;
    }

    const ticket = ++requestId.current;
    setStatus('loading');
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId.current !== ticket) return; // stale (component reused)
        const { latitude, longitude, accuracy } = position.coords;
        setCoords({
          lat: latitude,
          lng: longitude,
          accuracy,
          source: 'user',
          label: 'Live Location',
        });
        setStatus('success');
      },
      (err) => {
        if (requestId.current !== ticket) return;
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied.'
            : err.code === err.TIMEOUT
              ? 'Location lookup timed out.'
              : 'Unable to determine your location.';
        setError(message);
        setStatus('error');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }, []);

  return { status, coords, error, requestLocation, fallbackLocation };
}
