# Movement Tracking — backend

The Movement Tracking API: field agents, leads, regions, attendance (check-in / check-out), GPS
movement tracking and supervisor tools, for **many companies** on one server. A **platform owner**
creates each company and its **Super Admin**; each Super Admin manages only their own company.
No UI here: the web dashboard lives in `../admin-dashboard` and the field app is built separately, both
on the API below.

Stack: NestJS 11 and Postgres (Supabase) through the model layer in `src/database`, with its own
migration tools in `database/`. Every route lives under `/api`; the lead system's routes are
`/api/lead-collection/...`.

## Folders

| Path | What it is |
| --- | --- |
| `src/modules/lead-collection/` | The lead system: leads, field agents, regions, attendance, GPS tracking, supervisors |
| `src/modules/super-admin/` | Console sign-in (platform owner and Super Admins), password change |
| `src/modules/platform/` | The platform owner's API: companies and their Super Admin accounts |
| `src/modules/uploads/` | Cloudinary uploads (agent photos / documents) |
| `src/database/` | Postgres model layer + `pg/registry.generated.ts` (table map) |
| `database/` | `migrate.js`, `verify.js`, `generate.js` and `migrations/` |
| `test/movement-tracking.pg-spec.ts` | Whole-API test on a fresh, throw-away Postgres, including company isolation |
| `test/companies-upgrade.pg-spec.ts` | Upgrading a database from before companies (migration 0003) |

## First run (local)

1. **Create the database.** A new Supabase project (use its *Session pooler* URL, port 5432) or a
   local Postgres database. It must be a new, empty database.
2. **Settings.** Copy `.env.example` to `.env` and fill it in: the database URL in
   `SUPABASE_DB_URL`, two random secrets, the platform owner login and the Cloudinary keys.
   `.env.example` explains every setting. Never commit `.env`.
3. **Install and create the tables:**
   ```bash
   npm install
   npm run db:migrate     # creates the 7 tables in schema "leads"
   npm run db:verify      # optional: confirms the layout
   ```
4. **Start:** `npm run start:dev` (watch mode) or `npm run build && npm run start:prod`.
   The API listens on `http://localhost:5100/api`; API docs at `/api/docs`; health at `/api/health`.

## Companies, platform owner and Super Admins

| Who | Does | Routes |
| --- | --- | --- |
| **Platform owner** (one account, the higher authority) | Creates companies, each with its Super Admin; adds more Super Admins; resets their passwords; suspends a company or a Super Admin. Sees each company's totals, never its staff, leads or tracking | `/api/platform/*` |
| **Super Admin** (one or more per company) | Everything inside their own company: staff, leads, regions, attendance, tracking | `/api/lead-collection/admin/*` |
| **Staff** (field agents, lead executives, supervisors, verifiers) | As before, inside their own company | `/api/lead-collection/agent/*`, `/supervisor/*` |

How companies are kept apart:
- Every staff account, lead, region, attendance row and GPS point stores its `companyId`. The
  company always comes from the signed-in account, never from the request, and every query filters
  on it. Another company's record answers **404**, as if it did not exist.
- Regions are per company: two companies may both add the same district.
- A mobile number (staff sign-in) and an admin email are unique across **all** companies, because
  that is what people sign in with. Reusing one gives 409.
- Suspending a company signs out its Super Admins and staff at once and blocks their sign-in until
  it is activated again. Nothing is deleted.

Platform owner:
- On first start, if no platform owner exists, one is created from `PLATFORM_OWNER_EMAIL`,
  `PLATFORM_OWNER_PASSWORD` and `PLATFORM_OWNER_NAME` in `.env`. Later edits to these never change
  the existing account. (`SUPER_ADMIN_*` settings are no longer used: Super Admins are created by
  the platform owner.)
- Routes (platform owner token): `GET`/`POST companies`, `GET`/`PUT companies/:id`
  (`{ name, status: "active" | "suspended", contactPerson, contactEmail, contactPhone, notes }`),
  `POST companies/:id/admins` (`{ name, email, password? }`), `PUT admins/:adminId`
  (`{ name, email, status }`), `POST admins/:adminId/reset-password` (`{ password? }`).
  `POST companies` takes `{ name, ..., adminName, adminEmail, adminPassword? }` and creates the
  company with its first Super Admin. Without a password, a strong one is generated and returned
  once as `temporaryPassword`.

Sign-in (both kinds of admin):
- `POST /api/auth/login` with `{ "email", "password" }` → `data.token` and `data.admin`, whose
  `role` is `platform_owner` or `super_admin`; a Super Admin's also carries `company`
  (`{ id, name, status }`). Send the token as `Authorization: Bearer <token>`.
- A Super Admin token gets 403 on `/api/platform/*`, and the platform owner's gets 403 on
  `/api/lead-collection/admin/*`.
- Change the password after the first sign-in: `POST /api/auth/change-password` with
  `{ "currentPassword", "newPassword" }` (10+ characters). This signs out every other session and
  returns a new token.
- A Super Admin token never works on field-agent routes, and a field-agent token never works on
  admin routes (separate secrets, issuer, audience and scope).

## API map

All responses are `{ "success": true, "data": ... }`. Request bodies are validated; unknown fields
are rejected.

**Admin sign-in** (platform owner and Super Admins) — `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`

**Platform owner** (`/api/platform`, platform owner token) — see *Companies, platform owner and Super Admins* above.

**Super Admin console** (`/api/lead-collection/admin`, Super Admin token; everything is limited to the admin's own company)

| Area | Routes |
| --- | --- |
| Leads | `GET leads`, `GET leads/stats`, `GET leads/:id`, `POST leads`, `PUT leads/:id`, `DELETE leads/:id`, `POST leads/:id/assign` (`{ agentId }`, `null` unassigns), `POST leads/:id/approve` · `reject` · `convert` · `reopen` (`{ note }`) |
| Regions | `GET regions`, `POST regions` (`{ state, district }`), `DELETE regions?state=&district=` |
| Field agents | `GET users`, `GET users/:id`, `POST users`, `PUT users/:id`, `POST users/:id/reset-password`, `DELETE users/:id` |
| Attendance | `GET attendance/summary`, `GET attendance/agent/:id` |
| Tracking | `GET tracking/live`, `GET agents/:agentId/tracking`, `GET agents/:agentId/tracking/history`, `GET agents/:agentId/shifts/:attendanceId/route` |

**Field agents** (lead app)

| Area | Routes |
| --- | --- |
| Sign-in | `POST /api/lead-collection/auth/login` (`{ phone, password }`), `GET /api/lead-collection/auth/me` |
| Leads | `/api/lead-collection/agent/leads`: `GET`, `GET stats`, `GET field-agents`, `GET :id`, `POST`, `PUT :id`, `DELETE :id`, `POST :id/assign` (lead executives and supervisors) |
| Attendance | `/api/lead-collection/agent/attendance`: `POST check-in` (`{ coords: { lat, lng, accuracy } }`), `POST check-out`, `GET today`, `GET history` |
| Tracking | `/api/lead-collection/agent/tracking`: `GET`/`POST consent`, `POST fixes` (batch of up to 100 GPS points, `recordedAt` in UTC ISO), `GET today`, `GET day`, `GET history` |
| Uploads | `POST /api/lead-collection/agent/uploads` (multipart `file`) |

**Field supervisors** (agent token with role `field_supervisor`) — `/api/lead-collection/supervisor`:
`GET dashboard`, `GET`/`POST agents`, `GET`/`PUT`/`DELETE agents/:agentId`,
`POST agents/:agentId/reset-password`, `GET agents/:agentId/leads`, `GET`/`PUT agents/:agentId/leads/:leadId`,
`GET attendance/summary`, `GET agents/:agentId/attendance`, `GET agents/:agentId/shifts/:attendanceId/route`,
`GET agents/:agentId/tracking`, `GET agents/:agentId/tracking/history`, `GET tracking/live`.

**Lead executives** (agent token with role `lead_executive`) sign in like field agents
(`POST /api/lead-collection/auth/login`), add leads with `POST /agent/leads` and assign them to a
field agent: `assignedAgentId` on create / update, or `POST /agent/leads/:id/assign` with
`{ agentId }` (`null` unassigns). `GET /agent/leads/field-agents` lists who they can choose.

Assignment rules:
- Only lead executives, supervisors and the Super Admin assign, and only to agents of the same company. A field agent who sends a different
  `assignedAgentId` gets 403; sending the current one back unchanged is fine.
- The assignee must be an active `field_agent`. Lead executives and supervisors may only pick agents
  of their own district, and only while the lead is `pending`.
- The assignee's name and code are read from their account (`assignedAgentName` /
  `assignedAgentCode` sent by a client are ignored).
- A field agent sees their own and their assigned leads in any district, and can delete only leads
  they added themselves.

Rules: check-in needs GPS coordinates; shifts left open are closed 9 hours
after check-in (`LEAD_AUTO_CHECKOUT_ENABLED=false` turns this off); raw GPS points are kept 180 days.

## Deploying (separate server)

1. Server env: everything in `.env.example`, with `NODE_ENV=production`, the production database
   URL, `CORS_ORIGINS` (the web dashboard's URL(s); required), `TRUST_PROXY=true` behind nginx, and
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

### Upgrading a server from before companies

1. Add `PLATFORM_OWNER_EMAIL`, `PLATFORM_OWNER_PASSWORD` (10+ characters) and `PLATFORM_OWNER_NAME`
   to the server's environment. Use an email that is **not** the existing Super Admin's.
2. Deploy as usual. `npm run db:migrate` applies `0003_companies.sql`, which puts the existing
   Super Admin(s), staff, leads, regions, attendance and GPS points into one company called
   **Default company**. They keep signing in as before and see the same data.
3. Sign in to the dashboard as the platform owner, rename *Default company*, and add the other
   companies. `SUPER_ADMIN_*` can be removed from the environment.

## Changing the database layout

Edit the model schema, then `npm run db:generate -- <name>` (writes the next
`database/migrations/NNNN_<name>.sql` and updates the registry; touches no database), review it,
and `npm run db:migrate`. Migrations only add — never drop or alter.

## Checks

```bash
npm run lint && npm run typecheck && npm test
npm run test:pg        # starts its own throw-away Postgres
```
