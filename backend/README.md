# Movement Tracking — backend

The Tirvona lead system as its own product: field agents, leads, regions, attendance (check-in /
check-out), GPS movement tracking and supervisor tools, plus a **Super Admin** who manages
everything. Its own database, its own deploy. No UI here — any app or admin panel is built on
the API below.

Same stack and code as Tirvona's `Newbackend`: NestJS 11, Postgres through the same model layer
(`src/database`), the same migration tools. The lead code (`src/modules/lead-collection`) is a copy
of Tirvona's (commit `4f9aed6`, 2026-11-20), and the routes are the same (`/api/lead-collection/...`),
so Tirvona's lead app can point at this server without changes.

## Folders

| Path | What it is |
| --- | --- |
| `src/modules/lead-collection/` | The lead system, copied from Tirvona (see "Differences from Tirvona") |
| `src/modules/super-admin/` | Super Admin accounts, sign-in, password change |
| `src/modules/uploads/` | Cloudinary uploads (agent photos / documents) |
| `src/database/` | Postgres model layer + `pg/registry.generated.ts` (table map) |
| `database/` | `migrate.js`, `verify.js`, `generate.js` and `migrations/` |
| `test/movement-tracking.pg-spec.ts` | Whole-API test on a fresh, throw-away Postgres |

## First run (local)

1. **Create the database.** A new Supabase project (use its *Session pooler* URL, port 5432) or a
   local Postgres database. It must be a new, empty database — not Tirvona's.
2. **Settings.** `.env` is already filled in (new secrets, the Super Admin login, the Cloudinary
   keys from Tirvona). Put the new database URL in `SUPABASE_DB_URL`. `.env.example` lists every
   setting with an explanation.
3. **Install and create the tables:**
   ```bash
   npm install
   npm run db:migrate     # creates the 6 tables in schema "leads"
   npm run db:verify      # optional: confirms the layout
   ```
4. **Start:** `npm run start:dev` (watch mode) or `npm run build && npm run start:prod`.
   The API listens on `http://localhost:5100/api`; API docs at `/api/docs`; health at `/api/health`.

## Super Admin

- On first start, if no Super Admin exists, one is created from `SUPER_ADMIN_EMAIL`,
  `SUPER_ADMIN_PASSWORD` and `SUPER_ADMIN_NAME` in `.env`. Later edits to these never change an
  existing account.
- Sign in: `POST /api/auth/login` with `{ "email", "password" }` → `data.token`. Send it as
  `Authorization: Bearer <token>` on every `/api/lead-collection/admin/*` call.
- Change the password after the first sign-in: `POST /api/auth/change-password` with
  `{ "currentPassword", "newPassword" }` (10+ characters). This signs out every other session and
  returns a new token.
- A Super Admin token never works on field-agent routes, and a field-agent token never works on
  admin routes (separate secrets, issuer, audience and scope).

## API map

All responses are `{ "success": true, "data": ... }`. Request bodies are validated; unknown fields
are rejected.

**Super Admin sign-in** — `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`

**Super Admin console** (`/api/lead-collection/admin`, Super Admin token)

| Area | Routes |
| --- | --- |
| Leads | `GET leads`, `GET leads/stats`, `GET leads/:id`, `POST leads`, `PUT leads/:id`, `DELETE leads/:id`, `POST leads/:id/approve` · `reject` · `convert` · `reopen` (`{ note }`) |
| Regions | `GET regions`, `POST regions` (`{ state, district }`), `DELETE regions?state=&district=` |
| Field agents | `GET users`, `GET users/:id`, `POST users`, `PUT users/:id`, `POST users/:id/reset-password`, `DELETE users/:id` |
| Attendance | `GET attendance/summary`, `GET attendance/agent/:id` |
| Tracking | `GET tracking/live`, `GET agents/:agentId/tracking`, `GET agents/:agentId/tracking/history`, `GET agents/:agentId/shifts/:attendanceId/route` |

**Field agents** (lead app)

| Area | Routes |
| --- | --- |
| Sign-in | `POST /api/lead-collection/auth/login` (`{ phone, password }`), `GET /api/lead-collection/auth/me` |
| Leads | `/api/lead-collection/agent/leads`: `GET`, `GET stats`, `GET field-agents`, `GET :id`, `POST`, `PUT :id`, `DELETE :id` |
| Attendance | `/api/lead-collection/agent/attendance`: `POST check-in` (`{ coords: { lat, lng, accuracy } }`), `POST check-out`, `GET today`, `GET history` |
| Tracking | `/api/lead-collection/agent/tracking`: `GET`/`POST consent`, `POST fixes` (batch of up to 100 GPS points, `recordedAt` in UTC ISO), `GET today`, `GET day`, `GET history` |
| Uploads | `POST /api/lead-collection/agent/uploads` (multipart `file`) |

**Field supervisors** (agent token with role `field_supervisor`) — `/api/lead-collection/supervisor`:
`GET dashboard`, `GET`/`POST agents`, `GET`/`PUT`/`DELETE agents/:agentId`,
`POST agents/:agentId/reset-password`, `GET agents/:agentId/leads`, `GET`/`PUT agents/:agentId/leads/:leadId`,
`GET attendance/summary`, `GET agents/:agentId/attendance`, `GET agents/:agentId/shifts/:attendanceId/route`,
`GET agents/:agentId/tracking`, `GET agents/:agentId/tracking/history`, `GET tracking/live`.

Rules carried over from Tirvona: check-in needs GPS coordinates; shifts left open are closed 9 hours
after check-in (`LEAD_AUTO_CHECKOUT_ENABLED=false` turns this off); raw GPS points are kept 180 days.

## Deploying (separate server)

1. Server env: everything in `.env.example`, with `NODE_ENV=production`, the production database
   URL, `CORS_ORIGINS` (the web app's URL(s); required), `TRUST_PROXY=true` behind nginx, and
   `SWAGGER_ENABLED=false` if the docs should not be public. `JWT_SECRET` and `LEAD_JWT_SECRET`
   must be 32+ characters (the API refuses to start otherwise).
2. Each deploy:
   ```bash
   npm ci
   npm run build
   npm run db:migrate     # before restarting: the API refuses to start if tables and code disagree
   npm run start:prod     # or: pm2 start dist/main.js --name movement-tracking-api
   ```
3. `GET /api/health/live` = process up; `GET /api/health` = database reachable too.

## Changing the database layout

Edit the model schema, then `npm run db:generate -- <name>` (writes the next
`database/migrations/NNNN_<name>.sql` and updates the registry; touches no database), review it,
and `npm run db:migrate`. Migrations only add — never drop or alter.

## Checks

```bash
npm run lint && npm run typecheck && npm test
npm run test:pg        # starts its own throw-away Postgres
```

## Differences from Tirvona

Only these lead files differ from Tirvona's copy:

- `lead-collection.module.ts` — imports `SuperAdminModule` instead of Tirvona's `HrLocationModule`
  and `AshramsModule`.
- `presentation/lead-admin.controller.ts` — area scope from `AdminScopeService` (Super Admin sees
  everything) instead of Tirvona's HR-office scope.
- `application/lead-users.service.ts` — regions are the built-in list plus the custom catalogue
  (Tirvona also added districts of its stays, which do not exist here).

Everything else in `src/modules/lead-collection` is unchanged, so fixes made in Tirvona can be
copied across file by file. The five lead tables have the same columns as Tirvona's `leads`
schema, so existing Tirvona lead data could be copied over later if wanted (not done).
