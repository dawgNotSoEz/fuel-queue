/**
 * FUELWISE — application bootstrap.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Leaflet core styles MUST precede our theme overrides.
import 'leaflet/dist/leaflet.css';
import App from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('FUELWISE: #root container was not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
