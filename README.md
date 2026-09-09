# FUELWISE

> AI-powered CNG and EV station intelligence for faster, smarter refueling decisions.

FUELWISE helps drivers find the best nearby CNG pump or EV charger using location-aware search, queue estimates, distance, and travel time. The project combines a React + TypeScript frontend with a FastAPI backend and an offline simulator fallback so it remains useful even when live data is limited or unavailable.

## Features

- Real browser geolocation with an explicit permission prompt
- Nearby CNG and EV station discovery using OpenStreetMap Overpass when available
- Filtered map for CNG and EV stations with operational status awareness
- Best-choice ranking based on queue time, distance, and total travel time
- Selected station summary card with a direct Google Maps navigation action
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
¦   +-- api/
¦   ¦   +-- index.py              # Vercel FastAPI entrypoint
¦   +-- app/
¦   ¦   +-- main.py               # FastAPI application
¦   ¦   +-- geo.py                # Geographic helpers
¦   ¦   +-- osm.py                # OpenStreetMap/Overpass integration
¦   ¦   +-- simulator.py          # Queue simulation logic
¦   ¦   +-- station_seed.py       # Fallback station seed data
¦   ¦   +-- routers/              # stations, predict, recommend
¦   +-- models/
¦   ¦   +-- metrics.json          # Training metadata and timestamp
¦   +-- scripts/
¦   ¦   +-- seed_db.py            # Station seeding
¦   ¦   +-- simulate.py           # Live queue simulation
¦   ¦   +-- train_model.py       # Training workflow
¦   +-- requirements.txt
¦   +-- requirements-full.txt
¦   +-- Dockerfile
+-- frontend/
¦   +-- src/
¦   ¦   +-- components/           # Navbar, map, filters, cards, prompt
¦   ¦   +-- hooks/                # Geolocation logic
¦   ¦   +-- store/                # Zustand state management
¦   ¦   +-- types/                # Shared TypeScript types
¦   ¦   +-- utils/                # API, metrics, map helpers, simulation
¦   +-- package.json
¦   +-- vite.config.ts
¦   +-- vercel.json
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

## Data Attribution

Map tiles and station data are sourced from OpenStreetMap under the Open Database License. Keep attribution visible where required by your deployment.

This project is a hackathon-ready prototype focused on practical fuel-station decision support.
