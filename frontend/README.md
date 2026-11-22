# Hotel Offer Orchestrator — frontend

A single-page Vite + React + TypeScript + Tailwind CSS app for the Hotel Offer Orchestrator API. It searches hotels by city and price range, shows the best offer per hotel with cache and workflow details, polls `/health`, and includes an outage simulator for the two mock suppliers.

## Run locally

Requires Node 22 and the backend running (by default on `http://localhost:3000`).

```bash
npm install
cp .env.example .env   # optional; only needed to point at a different backend
npm run dev            # http://localhost:5173
```

Other scripts:

| Script | What it does |
|---|---|
| `npm run build` | Type-checks (`tsc -b`) and builds to `dist/` |
| `npm run preview` | Serves the production build locally |

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Backend base URL. Read at build time, so set it in the hosting provider's environment before building. |

The backend must allow the frontend's origin via CORS and expose the `X-Cache`, `X-Workflow-Id`, `X-Failed-Suppliers` and `X-Request-Id` headers.
