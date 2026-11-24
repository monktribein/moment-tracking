# Movement Tracking — dashboard

The web dashboard on top of the backend API (`../backend`). It is a separate app: the backend
serves no pages. It has two sign-ins:

| Who | Signs in with | Can |
| --- | --- | --- |
| **Super Admin** | email + password | Everything: overview, leads (review, assign, edit, delete), staff accounts of every role, attendance, live GPS tracking and routes, regions, own password |
| **Lead executive** (and supervisors) | mobile number + password | Add leads and assign each one to a field agent of their own district; reassign while the lead is pending; see the district's field agents |

Field agents and document verifiers use the mobile app, not this dashboard.

Stack: React 19, TypeScript, Vite, React Router (hash routes, so any static host works), Leaflet
with OpenStreetMap tiles for the maps.

## Run locally

The backend must be running (by default on `http://localhost:5100`).

```bash
cd admin-dashboard
npm install
npm run dev        # http://localhost:5173
```

To use another API, copy `.env.example` to `.env` and set `VITE_API_URL` (it must end in `/api`).
Outside production, the backend accepts any `http://localhost:*` origin, so no CORS change is needed
locally.

## Create a lead executive

1. Sign in as Super Admin → **Staff** → **Add staff**.
2. Role **Lead executive**, their mobile number and district; keep or change the generated password.
3. Share the sign-in details shown after saving. They choose **Lead executive** on the sign-in page.

A lead executive can only assign field agents of their own district, and only while the lead is
still pending review. The Super Admin can assign any active field agent at any time.

## Deploy (Render static site)

| Setting | Value |
| --- | --- |
| Root Directory | `admin-dashboard` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |
| Environment variable | `VITE_API_URL` = your API's URL + `/api`, e.g. `https://movement-tracking-api.onrender.com/api` |

Then add the dashboard's address (e.g. `https://movement-tracking-dashboard.onrender.com`) to the
backend's `CORS_ORIGINS` and redeploy the backend; without it the browser blocks every request.
`VITE_API_URL` is built into the files, so changing it needs a new deploy of the dashboard.

## Checks

```bash
npm run typecheck
npm run build
```
