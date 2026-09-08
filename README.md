# FUELQUEUE

> Real-time CNG and EV station discovery with nearby routing, queue estimates, station health, and OpenStreetMap data.

FUELQUEUE helps drivers find the best nearby CNG pump or EV charger by combining live browser location, real station data, queue estimates, station health, and total travel time. It is a hackathon-ready monorepo with a React frontend, FastAPI backend, optional PostgreSQL/TimescaleDB, and an XGBoost prediction pipeline.

## Features

- Real browser geolocation with no silent default city or invented coordinates.
- Real CNG pumps and EV chargers from OpenStreetMap Overpass.
- Curated real-coordinate Pune fallback for offline backend seeding.
- Free React Leaflet maps using OpenStreetMap tiles. No map API key required.
- CNG and EV filters, connector details, operational status, queue estimates, and station health scores.
- Haversine nearby search with a default 10 km radius, sorted nearest first.
- FastAPI endpoints for stations, recommendations, predictions, and crowd reports.
- Live-feel updates every 5 seconds through the backend simulator or frontend fallback simulator.
- XGBoost training pipeline with 10,000 synthetic training records for the full local/Docker setup.
- Vercel configuration for the Vite frontend and FastAPI service routing.

## Repository Layout

```text
fuel-queue/
├── backend/
│   ├── api/index.py              # Vercel FastAPI entrypoint
│   ├── app/
│   │   ├── main.py               # FastAPI application
│   │   ├── osm.py                # Overpass API client
│   │   ├── station_seed.py       # Curated Pune fallback stations
│   │   └── routers/              # stations, predict, recommend
│   ├── scripts/
│   │   ├── seed_db.py            # OSM + fallback database seeder
│   │   └── train_model.py        # XGBoost training script
│   ├── requirements.txt          # Lightweight Vercel dependencies
│   ├── requirements-full.txt     # Local/Docker ML dependencies
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/           # Map, filters, station cards, prompt
│   │   ├── hooks/                # Browser geolocation
│   │   ├── store/                # Zustand state
│   │   └── utils/                # API, Overpass, metrics, map helpers
│   ├── package.json
│   └── vercel.json
├── docker-compose.yml            # TimescaleDB, pgAdmin, optional app profile
├── docker/postgres/init/         # Database initialization
├── .env.example
└── vercel.json                   # Frontend/backend service routing
```

## Requirements

- Node.js 18 or newer and npm
- Python 3.12 recommended
- Docker Desktop, only if you want PostgreSQL/TimescaleDB or the full container setup
- Internet access for OpenStreetMap tiles and Overpass station queries

No Google Maps key, OpenAI key, or other API key is required for the default setup.

## Quick Start: Frontend Only

The frontend can run without Python, Docker, or a database. It tries the backend when configured, then OpenStreetMap, then a local simulator if external data is unavailable.

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Click **Use my location** and allow the browser permission. The application does not use Pune or any other default location when permission is denied.

For a production build:

```powershell
npm run typecheck
npm run build
npm run preview
```

## Full Local Setup

### 1. Configure environment variables

From the repository root:

```powershell
Copy-Item .env.example .env
```

For local frontend-to-backend communication, keep this value in `.env`:

```dotenv
VITE_API_URL=http://localhost:8000
```

The frontend uses the same-origin `/api` path when deployed and `localhost:8000` during local development.

### 2. Start PostgreSQL/TimescaleDB

```powershell
docker compose up -d db
docker compose ps
```

Optional pgAdmin:

```powershell
docker compose up -d pgadmin
```

Open `http://localhost:5050`. Credentials are defined in `.env` and `.env.example`.

### 3. Install backend dependencies

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-full.txt
```

### 4. Train the local prediction model

```powershell
python scripts/train_model.py
```

This creates ignored model artifacts under `backend/models/`. The Vercel runtime intentionally omits these heavy ML packages and uses the transparent heuristic fallback.

### 5. Seed real stations

With the database running, from `backend/`:

```powershell
python scripts/seed_db.py
```

The seeder queries Overpass for real Pune CNG and EV stations. If Overpass is unavailable or rate-limited, it inserts the curated real-coordinate Pune fallback. To replace existing rows:

```powershell
python scripts/seed_db.py --reset
```

### 6. Start FastAPI

```powershell
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Useful checks:

```powershell
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod "http://localhost:8000/api/stations?lat=18.5204&lng=73.8567"
```

Then open the frontend at `http://localhost:5173` and allow location access.

## Docker App Profile

To run the backend and frontend containers as well as the database:

```powershell
docker compose --profile app up -d --build
docker compose ps
```

The Docker frontend is served on `http://localhost:8080` and the API on `http://localhost:8000`.

Rebuild after source or dependency changes:

```powershell
docker compose --profile app down
docker compose --profile app up -d --build
```

## API Reference

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Backend liveness and model status |
| `GET` | `/api/stations?lat=&lng=&type=` | Nearby stations sorted by distance |
| `GET` | `/api/recommend?lat=&lng=&type=` | Best/worst station ranking |
| `POST` | `/api/predict` | Predict queue wait time |
| `POST` | `/api/report` | Submit a crowd wait observation |

The station endpoint defaults to a 10 km radius. It returns an empty list when a requested location is outside the backend's curated Pune cache; the frontend then queries OpenStreetMap directly for real nearby stations.

## Vercel Deployment

The repository contains a root `vercel.json` with two services:

- `frontend`: Vite build from `frontend/`
- `backend`: FastAPI entrypoint at `backend/api/index.py`

### Dashboard deployment

1. Import `dawgNotSoEz/fuel-queue` in Vercel.
2. Keep the project root at the repository root. Do not set the root directory to `frontend`; the root config declares both services.
3. Deploy the `main` branch.
4. Add `VITE_API_URL` only if the backend is hosted separately. Leave it unset when using the same-origin Vercel service route.

### CLI deployment

```powershell
npx vercel login
npx vercel --prod
```

The Python service uses lightweight `backend/requirements.txt`. Heavy XGBoost and pandas dependencies are in `requirements-full.txt` for local/Docker use, keeping the Vercel function below its bundle-size limit.

## Troubleshooting

### “No stations found near this location”

This is the final fallback state. Check `/health`, confirm `VITE_API_URL`, and verify that Overpass is reachable. Public Overpass mirrors can rate-limit or time out; the frontend retries multiple mirrors and then uses the local live-feel simulator.

### Location permission denied

The app intentionally stays on the location prompt. Enable browser location permission and click **Use my location** again. No default Pune coordinates are selected automatically.

### Backend is unreachable

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --port 8000
```

### Docker is serving stale code

```powershell
docker compose --profile app down
docker compose --profile app up -d --build
```

## Validation Commands

```powershell
npm --prefix frontend run build
backend\.venv\Scripts\python.exe -m compileall -q backend\app backend\scripts
git status
```

## Data and Attribution

OpenStreetMap data is © OpenStreetMap contributors and is used under the Open Database License. Keep the attribution visible when using the map.

This project is a hackathon prototype.
