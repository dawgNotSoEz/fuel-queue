import type { UserLocation } from '../types';

/** Open a Google Maps driving route from the user's live position. */
export function openGoogleMapsDirections(
  origin: UserLocation,
  destination: { lat: number; lng: number },
): void {
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'driving',
  });
  window.open(
    `https://www.google.com/maps/dir/?${params.toString()}`,
    '_blank',
    'noopener,noreferrer',
  );
}