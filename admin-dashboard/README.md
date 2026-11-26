# Movement Tracking — dashboard

The web dashboard on top of the backend API (`../backend`). It is a separate app: the backend
serves no pages. It is shared by many companies, and has these sign-ins:

| Who | Signs in with | Can |
| --- | --- | --- |
| **Platform owner** | email + password (tab *Admin*) | **Companies**: add a company with its Super Admin, add more Super Admins, reset their passwords, suspend a company or an admin. Sees each company's totals, never its records |
| **Super Admin** (per company) | email + password (tab *Admin*) | Everything inside their own company: overview, leads (review, assign, edit, delete), staff accounts of every role, attendance, live GPS tracking and routes, regions, own password. Never sees another company |
| **Lead executive** (and supervisors) | mobile number + password | Add leads and assign each one to a field agent of their own district; reassign while the lead is pending; see the district's field agents |

Field agents and document verifiers use the mobile app, not this dashboard.

Stack: React 19, TypeScript, Vite, React Router (hash routes, so any static host works), Google
Maps JavaScript API for the Live tracking map.

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

## Google Maps key

Live tracking needs a Google Maps key in `VITE_GOOGLE_MAPS_API_KEY` (in `.env` locally, and in the
host's environment variables for the deployed dashboard). In Google Cloud Console:

1. Enable **Maps JavaScript API** for the project, with billing turned on.
2. Restrict the key to **Websites**: add `http://localhost:5173/*` and your dashboard's address,
   e.g. `https://moment-tracking.vercel.app/*`, and limit it to the Maps JavaScript API.

The key ships inside the page, so the website restriction is what stops others from using it.
Markers use Google's `DEMO_MAP_ID` unless you set your own map ID in `VITE_GOOGLE_MAPS_MAP_ID`.
If the key is missing or refused, the map shows a message saying so.

## Add a company

1. Sign in as the platform owner (the account from `PLATFORM_OWNER_EMAIL` in the backend's settings).
2. **Companies** → **Add company**: the company's name and contact, then its Super Admin's name,
   email and password (a strong one is filled in; keep or change it).
3. Share the sign-in details shown after saving. The Super Admin signs in under **Admin** and
   creates the company's staff. Suspending a company (power button) signs out everyone in it.

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
| Environment variable | `VITE_GOOGLE_MAPS_API_KEY` = your Google Maps key (see above) |

Then add the dashboard's address (e.g. `https://movement-tracking-dashboard.onrender.com`) to the
backend's `CORS_ORIGINS` and redeploy the backend; without it the browser blocks every request.
`VITE_*` values are built into the files, so changing one needs a new deploy of the dashboard.

## Checks

```bash
npm run typecheck
npm run build
```
