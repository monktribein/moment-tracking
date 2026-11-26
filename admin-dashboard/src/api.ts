import type {
  AdminProfile,
  AdminSession,
  AgentAttendance,
  AttendanceSummary,
  Lead,
  LeadStats,
  LiveFix,
  Paged,
  Region,
  SaveLead,
  ShiftRoute,
  Staff,
  StaffSession,
  StaffUser,
  TrackedDay,
  TrackingConsent,
  TrackingDay,
} from "./types";

/** The backend API base URL, e.g. http://localhost:5100/api (set VITE_API_URL to change it). */
export const API_URL = String(import.meta.env.VITE_API_URL || "http://localhost:5100/api").replace(/\/+$/, "");

export type SessionKind = "admin" | "staff";
interface StoredSession {
  kind: SessionKind;
  token: string;
}

const SESSION_KEY = "mt-dashboard-session";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let session: StoredSession | null = (() => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredSession) : null;
    return parsed?.token && (parsed.kind === "admin" || parsed.kind === "staff") ? parsed : null;
  } catch {
    return null;
  }
})();

let onSessionEnded: (() => void) | null = null;

export const getSession = (): StoredSession | null => session;

export function setSession(next: StoredSession | null): void {
  session = next;
  if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  else localStorage.removeItem(SESSION_KEY);
}

/** Called when the API rejects the stored token (expired, password changed, account suspended). */
export function onUnauthorized(handler: (() => void) | null): void {
  onSessionEnded = handler;
}

type Query = Record<string, string | number | boolean | null | undefined>;

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, query, auth = true } = options;
  const url = new URL(API_URL + path);
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const sent = auth ? session : null;
  if (sent) headers.Authorization = `Bearer ${sent.token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(`Cannot reach the server (${API_URL}). Check that the backend is running.`, 0);
  }

  let payload: { success?: boolean; data?: T; message?: string | string[] } | null = null;
  try {
    payload = await response.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (response.status === 401 && sent) {
    // Only end the session that made this call (a newer sign-in may have replaced it).
    if (session?.token === sent.token) {
      setSession(null);
      onSessionEnded?.();
    }
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }
  if (!response.ok || payload?.success === false) {
    const raw = payload?.message;
    const message = Array.isArray(raw) ? raw.join(". ") : raw;
    throw new ApiError(message || `Request failed (${response.status})`, response.status);
  }
  return payload?.data as T;
}

const enc = encodeURIComponent;

/** Loads every page of a paged list (100 per request). */
async function everyPage<T>(load: (page: number) => Promise<Paged<T>>): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const data = await load(page);
    all.push(...(data?.items ?? []));
    if (!data?.items?.length || all.length >= Number(data.total ?? 0)) break;
  }
  return all;
}

export type LeadQuery = {
  status?: string;
  interest?: string;
  search?: string;
  capturedBy?: string;
  page?: number;
  limit?: number;
};

export type LeadDecision = "approve" | "reject" | "convert" | "reopen";

export interface StaffInput {
  name?: string;
  phone?: string;
  email?: string;
  password?: string;
  role?: string;
  status?: string;
  state?: string;
  district?: string;
  employeeCode?: string;
  notes?: string;
}

const A = "/lead-collection/admin";

/** Super Admin routes (/api/auth and /api/lead-collection/admin). */
export const adminApi = {
  login: (email: string, password: string) =>
    request<AdminSession>("/auth/login", { method: "POST", body: { email, password }, auth: false }),
  me: () => request<AdminProfile>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<AdminSession>("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),

  leadStats: () => request<LeadStats>(`${A}/leads/stats`),
  leads: (query: LeadQuery) => request<Paged<Lead>>(`${A}/leads`, { query }),
  /** Every lead created since `since`. The list is newest first, so paging stops at the first older one. */
  leadsSince: async (since: Date): Promise<Lead[]> => {
    const all: Lead[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const data = await request<Paged<Lead>>(`${A}/leads`, { query: { page, limit: 100 } });
      const items = data?.items ?? [];
      all.push(...items);
      const oldest = items[items.length - 1];
      if (!oldest || new Date(oldest.createdAt ?? oldest.capturedAt).getTime() < since.getTime() || all.length >= Number(data.total ?? 0)) break;
    }
    return all;
  },
  lead: (id: string) => request<Lead>(`${A}/leads/${enc(id)}`),
  createLead: (body: SaveLead) => request<Lead>(`${A}/leads`, { method: "POST", body }),
  updateLead: (id: string, body: SaveLead) => request<Lead>(`${A}/leads/${enc(id)}`, { method: "PUT", body }),
  assignLead: (id: string, agentId: string | null) =>
    request<Lead>(`${A}/leads/${enc(id)}/assign`, { method: "POST", body: { agentId } }),
  decideLead: (id: string, decision: LeadDecision, note: string) =>
    request<Lead>(`${A}/leads/${enc(id)}/${decision}`, { method: "POST", body: note.trim() ? { note: note.trim() } : {} }),
  deleteLead: (id: string) => request<{ id: string }>(`${A}/leads/${enc(id)}`, { method: "DELETE" }),

  regions: () => request<Region[]>(`${A}/regions`),
  addRegion: (state: string, district: string) =>
    request<Region>(`${A}/regions`, { method: "POST", body: { state, district } }),
  removeRegion: (state: string, district: string) =>
    request<{ deleted: boolean }>(`${A}/regions`, { method: "DELETE", query: { state, district } }),

  allStaff: () => everyPage((page) => request<Paged<Staff>>(`${A}/users`, { query: { page, limit: 100 } })),
  staff: (id: string) => request<Staff>(`${A}/users/${enc(id)}`),
  createStaff: (body: StaffInput) => request<Staff>(`${A}/users`, { method: "POST", body }),
  updateStaff: (id: string, body: StaffInput) => request<Staff>(`${A}/users/${enc(id)}`, { method: "PUT", body }),
  resetPassword: (id: string, password?: string) =>
    request<{ id: string; temporaryPassword?: string }>(`${A}/users/${enc(id)}/reset-password`, {
      method: "POST",
      body: password ? { password } : {},
    }),
  deleteStaff: (id: string) =>
    request<{ id: string; leadsRetained: number }>(`${A}/users/${enc(id)}`, { method: "DELETE" }),

  attendanceSummary: () => request<AttendanceSummary>(`${A}/attendance/summary`),
  agentAttendance: (id: string, limit = 31) =>
    request<AgentAttendance>(`${A}/attendance/agent/${enc(id)}`, { query: { limit } }),

  live: () => request<LiveFix[]>(`${A}/tracking/live`),
  agentDay: (id: string, date: string) =>
    request<{ agent: { id: string; consent: TrackingConsent }; day: TrackingDay }>(
      `${A}/agents/${enc(id)}/tracking`,
      { query: { date } },
    ),
  /** Per-day totals for days with GPS points, newest first (at most 90 days). */
  agentDays: (id: string, range: { startDate?: string; endDate?: string } = {}) =>
    request<TrackedDay[]>(`${A}/agents/${enc(id)}/tracking/history`, { query: range }),
  shiftRoute: (agentId: string, attendanceId: string) =>
    request<{ shift: ShiftRoute }>(`${A}/agents/${enc(agentId)}/shifts/${enc(attendanceId)}/route`),
};

const S = "/lead-collection/agent/leads";

/** Lead executive / supervisor routes (/api/lead-collection/auth and /agent/leads). */
export const staffApi = {
  login: (phone: string, password: string) =>
    request<StaffSession>("/lead-collection/auth/login", { method: "POST", body: { phone, password }, auth: false }),
  me: () => request<StaffUser>("/lead-collection/auth/me"),

  stats: () => request<LeadStats>(`${S}/stats`),
  leads: (query: LeadQuery) => request<Paged<Lead>>(S, { query }),
  lead: (id: string) => request<Lead>(`${S}/${enc(id)}`),
  createLead: (body: SaveLead) => request<Lead>(S, { method: "POST", body }),
  updateLead: (id: string, body: SaveLead) => request<Lead>(`${S}/${enc(id)}`, { method: "PUT", body }),
  assignLead: (id: string, agentId: string | null) =>
    request<Lead>(`${S}/${enc(id)}/assign`, { method: "POST", body: { agentId } }),
  /** Field agents of the signed-in user's district. */
  fieldAgents: () => request<Staff[]>(`${S}/field-agents`),
};

/** Runs `work` over `items`, at most `limit` at a time, keeping the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
