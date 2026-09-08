# ⚡ FUELQUEUE

> **AI that knows where to go and how long you'll wait — before you leave.**
> No sensors. No IoT. Just smart algorithms that save millions of hours.

FUELWISE unifies **CNG + EV** refuelling discovery, live (simulated) queue-wait
forecasting, and smart load-balancing so drivers never waste hours in a 3-hour queue.

---

## 🚀 One-Line Pitch

**"FUELQUEUE: AI that knows where to go and how long you'll wait — before you leave."**

## 🧠 Core Innovations

| # | Innovation | Phase | Status |
|---|-----------|-------|--------|
| 1 | **Predictive AI Engine** — XGBoost regression forecasting wait times (85%+ accuracy target) | 2–4 | Planned |
| 2 | **Demand Distribution Algorithm** — total time = drive time + predicted wait, balanced across stations | 2 | Planned |
| 3 | **Gamification** — FUEL POINTS rewarding real-time reporting | 3 | Planned |
| 4 | **Voice Assistant** — eyes-free, natural-language operation | 5 | Planned |
| 5 | **Unified Platform** — first combined CNG + EV intelligent routing | 1 | ✅ In progress |

## ✨ Phase 1 Highlights (this scaffold)

- ⬛ **Strict black & white** minimal UI — no neon, no glow, no "AI stereotype"
  demo look. Serious, premium, high-contrast utility (Inter typeface, gray-scale semantics).
- 🗺️ **Free map stack** — React Leaflet + OpenStreetMap. **Zero API keys required.**
- 📍 Browser geolocation with graceful **Pune fallback** (`18.5204, 73.8567`).
- ⛽ Monochrome **CNG pins** (teardrop, black fill + white stroke) &
  🔲 monochrome **EV pins** (diamond, dark-gray fill).
- ⬜ **Best/Worst language via stroke** (no colors): thick solid white = best,
  thin dashed gray = worst — computed from `distance + wait` (lowest/highest).
- 🔄 Simulated **live data**: wait times re-roll every 10 s so markers / popups update in real time.
- 🧠 Zustand global state, memoized markers, Framer Motion micro-transitions.

## 🗂️ Repository Layout

```
fuelqueue/
├── .env                      # All env vars (copy .env.example)
├── docker-compose.yml        # TimescaleDB + pgAdmin (+ optional api/web)
├── docker/postgres/init/     # Provisions fuelwise_tsdb
├── backend/                  # FastAPI skeleton (Phase 2 ready)
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py           # GET / -> {"status": "ok"}
│       ├── database.py       # SQLAlchemy engine placeholder
│       └── models.py         # ORM mirrors of the frontend Station type
└── frontend/                 # React + TypeScript + Vite
    ├── Dockerfile
    └── src/
        ├── App.tsx
        ├── components/       # Navbar, Map, pins, popup, prompt…
        ├── hooks/            # useGeolocation
        ├── store/            # Zustand store (useStore.ts)
        ├── utils/            # mock data + monochrome SVG pins
        └── types/            # Station, UserLocation …
```

## 🛠️ Getting Started

### 1) Frontend (the star of Phase 1)
No accounts, no API keys — just run it:
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```
The app requests your location, then generates **18 CNG + 16 EV** mock stations
inside a 10 km radius. Allow geolocation (or pick **Guest → Pune demo**). The map
renders as a grayscale OSM layer so it stays inside the black & white theme.

### 2) Databases (optional for Phase 1)
```bash
docker compose up -d db pgadmin
# pgAdmin -> http://localhost:5050  (admin@fuelwise.dev / fuelwise_admin)
```

### 3) Backend (Phase 2 placeholder)
```bash
cd backend
python -m venv .venv && source .venv/Scripts/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# -> http://localhost:8000  { "status": "ok" }
```

## ▲ Deploying the frontend to Vercel

The frontend is a **fully static React app** — maps come from OpenStreetMap and
need **no API keys**, so it deploys to Vercel as-is. Without a backend URL it
automatically falls back to **real nearby stations from OpenStreetMap** and then
to the built-in live-feel simulator, so the demo always works.

1. Push this repo to GitHub, then go to **vercel.com → New Project → Import** the
   `fuel-queue` repo.
2. Keep the **repository root** as the project root. The root `vercel.json`
   declares the Vite frontend and FastAPI backend services and routes `/api/*`
   to the backend.
3. **Framework Preset:** Vite. Build command and output directory are declared
   by the frontend service (`npm run build` → `dist`).
4. (Optional) **Environment Variable:** add `VITE_API_URL` pointing at a hosted
   FastAPI backend if you run the AI layer somewhere (Render / Railway / a VPS).
   Leave it unset for the pure frontend demo.

> **Deployment note:** The Python backend is exposed through `backend/api/index.py`.
> FastAPI + XGBoost + TimescaleDB is not ideal for Vercel — it uses a
> background simulator thread, Postgres, and `.pkl` model files — so run it
> locally with Docker for the full demo, or host it separately.

CLI equivalent:
```bash
npm i -g vercel
vercel --cwd frontend --prod
```

## 🧪 Verifying the Map
1. `npm run dev` — tiles load straight from OpenStreetMap (internet required;
   attribution stays visible on the map).
2. Allow location → pins appear around you; deny → Pune demo region loads.
3. Default filter is **CNG**; toggle to **EV** to see diamond pins (a few are
   deliberately offline, ~18 %).
4. Watch the **LIVE** chip — wait times re-roll every 10 s and the best/worst
   stroke logic re-evaluates automatically.

> **Tile note:** OSM tiles are fine for light demo traffic with attribution.
> For heavy production use, serve tiles from your own proxy or vendor.

## 🗺️ Phase Roadmap
- **Phase 2** — FastAPI endpoints, TimescaleDB hypertables, station CRUD.
- **Phase 3** — Queue telemetry ingestion + gamified FUEL POINTS.
- **Phase 4** — XGBoost predictive wait-time model + Demand Distribution Algorithm.
- **Phase 5** — Voice assistant, FUEL POINTS redemptions, deployments.

---
Made with ⚡ for the 48-hour hackathon.
