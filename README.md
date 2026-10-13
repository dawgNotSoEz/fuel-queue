# FUELWISE

> AI-powered CNG and EV station intelligence for faster, smarter refueling decisions.

FUELWISE helps drivers find the best nearby CNG pump or EV charger using location-aware search, queue estimates, distance, and travel time. The project combines a React + TypeScript frontend with a FastAPI backend and an offline simulator fallback so it remains useful even when live data is limited or unavailable.

## Features

- Real browser geolocation with an explicit permission prompt
- Nearby CNG and EV station discovery using OpenStreetMap Overpass when available
- Filtered map for CNG and EV stations with operational status awareness
- **Busyness-coloured pins**: every pump is coloured green → amber → orange →
  red by how busy it is right now, so you can see at a glance where to go
- Best-choice ranking based on queue time, distance, and total travel time
- Selected station summary card with a direct Google Maps navigation action
- **Real crowd intelligence**: busyness is derived from the actual places
  mapped around each pump on OpenStreetMap (shops, offices, markets, transit
  stops, schools, restaurants, clinics, homes, industry, through-traffic), so
  **every station gets its own curve and every weekday looks different**
- **Popular times**: a 24-bar busyness histogram per station/day with a live
  caret on the current hour and hover readouts, plus "shaped by …" readouts
  naming the real places driving that pump
- **Live busyness**: "Not busy / A little busy / Busy / As busy as it gets"
  badges plus a less-busy/as-usual/busier-than-usual comparison and a
  rising/clearing trend
- **Live area status**: a map chip naming the busiest pump and counting how
  many visible pumps are busy vs quiet right now
- **Free weather context**: Open-Meteo temperature/condition, which raises the
  expected queue length (rain +18%, storm +32%)
- Lightweight live simulation loop for queue updates in demo/offline mode
- Vercel-ready frontend and backend monorepo structure

## Stack

- Frontend: React, TypeScript, Vite, Leaflet, Tailwind CSS, Zustand
- Backend: FastAPI, Python, OpenStreetMap API integration
- Data: PostgreSQL / TimescaleDB support for local persistence
- ML: optional XGBoost training pipeline for queue prediction workflows

## Repository Layout

```text
fuel-queue/
+-- backend/
�   +-- api/
�   �   +-- index.py              # Vercel FastAPI entrypoint
�   +-- app/
�   �   +-- main.py               # FastAPI application
�   �   +-- busyness.py           # Popular-times histogram engine
�   �   +-- crowd.py              # Real OSM crowd-mix mirror (station curves)
�   �   +-- geo.py                # Geographic helpers
�   �   +-- osm.py                # OpenStreetMap/Overpass integration
�   �   +-- simulator.py          # Queue simulation logic
�   �   +-- station_seed.py       # Fallback station seed data
�   �   +-- routers/              # stations, predict, recommend, busyness
�   +-- models/
�   �   +-- metrics.json          # Training metadata and timestamp
�   +-- scripts/
�   �   +-- seed_db.py            # Station seeding
�   �   +-- simulate.py           # Live queue simulation
�   �   +-- train_model.py       # Training workflow
�   +-- requirements.txt
�   +-- requirements-full.txt
�   +-- Dockerfile
+-- frontend/
�   +-- src/
�   �   +-- components/           # Navbar, map, filters, cards, prompt
�   �   +-- hooks/                # Geolocation logic
�   �   +-- store/                # Zustand state management
�   �   +-- types/                # Shared TypeScript types
�   �   +-- utils/                # API, metrics, map helpers, simulation
�   +-- package.json
�   +-- vite.config.ts
�   +-- vercel.json
+-- docker-compose.yml
+-- docker/postgres/init/
+-- package.json                  # Root scripts for build/typecheck
+-- README.md
+-- vercel.json
+-- .env.example
+-- .gitignore
```

## Requirements

- Node.js 18 or newer
- npm
- Python 3.12 recommended for backend work
- Docker Desktop for the full local stack
- Internet access for map tiles and Overpass queries

## Quick Start

### Frontend only

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and allow access to your location when prompted.

### Root project scripts

```powershell
npm run typecheck
npm run build
```

## Backend Setup

### 1. Create environment files

```powershell
Copy-Item .env.example .env
```

Example:

```dotenv
VITE_API_URL=http://localhost:8000
```

### 2. Install backend dependencies

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-full.txt
```

### 3. Start the API

```powershell
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 4. Seed or train local data

```powershell
python scripts/train_model.py
python scripts/seed_db.py
```

## Docker

```powershell
docker compose --profile app up -d --build
docker compose ps
```

Services are available at:

- Frontend: http://localhost:8080
- API: http://localhost:8000
- pgAdmin: http://localhost:5050 (if enabled)

## API Overview

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /health | Backend health and model status |
| GET | /api/stations?lat=&lng=&type= | Nearby station discovery |
| GET | /api/recommend?lat=&lng=&type= | Best and worst station ranking |
| POST | /api/predict | Queue prediction request |
| GET | /api/busyness?station_id=&type=&hour=&day_of_week=&weather= | Popular-times histogram + busiest/quietest windows |
| POST | /api/report | Crowd wait-time reporting |

## Vercel Deployment

The repo is organized for a monorepo deployment using the root vercel.json config:

- Frontend built from the frontend directory
- Backend served through the FastAPI entrypoint in backend/api/index.py

Typical deployment flow:

```powershell
npx vercel login
npx vercel --prod
```

For same-origin hosting, leave VITE_API_URL unset unless the backend is hosted separately.

## Troubleshooting

### No stations near this location

- Check the backend health endpoint
- Verify VITE_API_URL for local dev
- Confirm Overpass connectivity
- The UI falls back to a simulator when live data is unavailable

### Location permission denied

The app waits for an explicit browser permission instead of silently using a default location.

### Stale Docker state

```powershell
docker compose --profile app down
docker compose --profile app up -d --build
```

## Free data sources

Everything the live view shows is free and key-free — no Google, HERE or TomTom
API keys are required anywhere:

| Source | Used for | Notes |
|---|---|---|
| OpenStreetMap (tiles + Overpass API) | Station discovery, **real crowd sources around each pump** | ODbL attribution stays visible on the map |
| Open-Meteo | Temperature, condition, queue impact | No key, no signup |
| FUELWISE crowd model (local + backend) | Per-station busyness histogram, pin colours, live status | Deterministic, works offline |
| Crowd reports (`POST /api/report`) | Rolling past-data mean per station | Keeps the histogram learning over time |

### How busyness is derived

1. The app fetches the **real places** mapped around the stations — retail,
   offices, markets, transit stops, schools, restaurants, clinics, homes,
   industry and motorway junctions — from OpenStreetMap, one Overpass query
   for the whole area, cached for 15 minutes.
2. Each place category carries its own **weekly and hourly rhythm**: offices
   and schools load weekday mornings, markets peak early at weekends,
   restaurants and malls build through the evening, transit stops double-peak
   every day. Places are weighted by how close they are to the pump
   (full weight inside 350 m, fading to zero at 1 km).
3. Summing the categories a station actually sits in gives **that station its
   own curve, and its own shape for every weekday** — which is why no two
   pumps share a histogram any more.
4. The station's own past-data mean wait (its `historical_avg_wait`, updated by
   crowd reports) sets the absolute scale, adjusted by how crowded the area
   really is. Bars are percentages of the station's weekly peak, so days stay
   comparable — the same normalisation Google Maps uses for "popular times".
5. The **pin colour is that live reading**: green (not busy) → amber → orange →
   red (as busy as it gets), so crowd levels are visible without opening a card.
6. Rain, fog and storms multiply the expected queue (rain +18%, storm +32%).

The frontend owns this maths so the app still works with the backend down; the
backend serves the same profile from `GET /api/busyness`, receiving the same
crowd mix so its histogram is station-specific too (`backend/app/crowd.py`), and
seasons it lightly with the ML wait model. If OpenStreetMap is unreachable each
station falls back to its own stored crowd profile rather than a shared curve.

### Honest labelling: real geography, modelled rhythm

Google's "popular times" are not exposed by the public Places API and there is
no free source of measured footfall, so FUELWISE does not pretend to have one.
Instead it uses **real OpenStreetMap geography** — the shops, offices, markets,
transit stops, schools, restaurants, clinics, homes and junctions actually
mapped around each pump — and applies a per-category weekly/hourly rhythm on
top. The mix, the intensity and the station ranking are real; each category's
hourly shape is a model. The chart labels this ("Real crowd"), names the places
driving the curve, and the pin colours follow the same reading.

## Data Attribution

Map tiles and station data are sourced from OpenStreetMap under the Open Database License. Keep attribution visible where required by your deployment.

Weather data is provided by [Open-Meteo](https://open-meteo.com/) (free, no key required).

Busyness is modelled from real OpenStreetMap places around each station plus past-data queue averages — it is not a measured footfall sensor feed.

This project is a hackathon-ready prototype focused on practical fuel-station decision support.
