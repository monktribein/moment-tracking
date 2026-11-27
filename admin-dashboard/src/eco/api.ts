import { apiDownload, apiRequest, requestPage, type Query } from "../api";

/** A row from an /api/v1 list or detail (camelCase keys, as the API returns them). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface EcoUser {
  id: string;
  kind: "user" | "admin";
  name: string;
  email: string;
  phone: string;
  role: EcoRole;
  permissions: string[];
  companyId: string;
  company: { id: string; name: string } | null;
  employeeId: string | null;
  distributorId: string | null;
  customerId: string | null;
}

export type EcoRole = "admin" | "sales_manager" | "tele_sales" | "field_sales" | "support_manager" | "field_support" | "hr" | "distributor" | "customer";

export interface EcoSession {
  token: string;
  expiresIn: string;
  user: EcoUser;
}

const V = "/v1";
const enc = encodeURIComponent;
const get = <T = Row>(path: string, query?: Query) => apiRequest<T>(`${V}${path}`, { query });
const list = <T = Row>(path: string, query?: Query) => requestPage<T>(`${V}${path}`, { query });
const post = <T = Row>(path: string, body: unknown = {}, headers?: Record<string, string>) => apiRequest<T>(`${V}${path}`, { method: "POST", body, headers });
const patch = <T = Row>(path: string, body: unknown) => apiRequest<T>(`${V}${path}`, { method: "PATCH", body });
const put = <T = Row>(path: string, body: unknown) => apiRequest<T>(`${V}${path}`, { method: "PUT", body });
const del = <T = Row>(path: string) => apiRequest<T>(`${V}${path}`, { method: "DELETE" });
const upload = <T = Row>(path: string, fields: Record<string, string | number | undefined>, file?: File | null) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== "") form.append(k, String(v));
  if (file) form.append("file", file);
  return apiRequest<T>(`${V}${path}`, { method: "POST", form });
};

/** Every Eco Sor endpoint the dashboard uses (see the backend's /api/docs). */
export const eco = {
  // auth
  login: (identifier: string, password: string) => apiRequest<EcoSession>(`${V}/auth/login`, { method: "POST", body: { identifier, password }, auth: false }),
  me: () => get<EcoUser>("/auth/me"),
  logout: () => post("/auth/logout"),
  changePassword: (currentPassword: string, newPassword: string) => post<{ token: string }>("/auth/change-password", { currentPassword, newPassword }),
  forgotPassword: (identifier: string) => apiRequest<Row>(`${V}/auth/forgot-password`, { method: "POST", body: { identifier }, auth: false }),
  resetPassword: (identifier: string, otp: string, newPassword: string) => apiRequest<Row>(`${V}/auth/reset-password`, { method: "POST", body: { identifier, otp, newPassword }, auth: false }),

  dashboard: (kind: "admin" | "sales-manager" | "tele-sales" | "support-manager" | "hr" | "distributor") => get(`/dashboard/${kind}`),

  // people
  employees: (q: Query) => list("/employees", q),
  employee: (id: string) => get(`/employees/${enc(id)}`),
  createEmployee: (body: Row) => post<{ employee: Row; temporaryPassword?: string }>("/employees", body),
  updateEmployee: (id: string, body: Row) => patch(`/employees/${enc(id)}`, body),
  setEmployeeActive: (id: string, active: boolean, reason?: string) => post(`/employees/${enc(id)}/${active ? "activate" : "deactivate"}`, reason ? { reason } : {}),
  resetEmployeePassword: (id: string) => post<{ temporaryPassword: string }>(`/employees/${enc(id)}/reset-password`),

  // products
  products: (q: Query) => list("/products", q),
  createProduct: (body: Row) => post("/products", body),
  updateProduct: (id: string, body: Row) => patch(`/products/${enc(id)}`, body),
  setProductActive: (id: string, isActive: boolean) => patch(`/products/${enc(id)}/active`, { isActive }),
  productImage: (id: string, file: File) => upload(`/products/${enc(id)}/image`, {}, file),

  // distributors
  distributors: (q: Query) => list("/distributors", q),
  distributor: (id: string) => get(`/distributors/${enc(id)}`),
  distributorHistory: (id: string) => get(`/distributors/${enc(id)}/history`),
  createDistributor: (body: Row) => post("/distributors", body),
  updateDistributor: (id: string, body: Row) => patch(`/distributors/${enc(id)}`, body),
  assignExecutive: (id: string, employeeId: string, reason?: string) => post(`/distributors/${enc(id)}/assign`, { employeeId, ...(reason ? { reason } : {}) }),
  portalAccess: (id: string, enabled: boolean) => post<{ distributor: Row; temporaryPassword?: string }>(`/distributors/${enc(id)}/portal-access`, { enabled }),
  importDistributors: (file: File, dryRun: boolean) => {
    const form = new FormData();
    form.append("file", file);
    return apiRequest<Row>(`${V}/distributors/import`, { method: "POST", form, query: { dryRun } });
  },

  // sales
  visits: (q: Query) => list("/sales/visits", q),
  visit: (id: string) => get(`/sales/visits/${enc(id)}`),
  createVisit: (body: Row) => post("/sales/visits", body),
  visitAction: (id: string, action: "complete" | "cancel" | "reschedule", body: Row = {}) => post(`/sales/visits/${enc(id)}/${action}`, body),
  followups: (q: Query) => list("/sales/followups", q),
  createFollowup: (body: Row) => post("/sales/followups", body),
  followupAction: (id: string, action: "complete" | "cancel") => post(`/sales/followups/${enc(id)}/${action}`),
  calls: (q: Query) => list("/sales/call-logs", q),
  createCall: (body: Row) => post("/sales/call-logs", body),

  // purchases and payments
  requests: (q: Query) => list("/purchase-requests", q),
  request: (id: string) => get(`/purchase-requests/${enc(id)}`),
  requestHistory: (id: string) => get(`/purchase-requests/${enc(id)}/history`),
  createRequest: (body: Row, idempotencyKey: string) => post<{ request: Row; replayed: boolean }>("/purchase-requests", body, { "Idempotency-Key": idempotencyKey }),
  updateDraft: (id: string, body: Row) => patch(`/purchase-requests/${enc(id)}/draft`, body),
  paymentProof: (id: string, fields: { amount: number; method: string; paymentDate: string; utr: string }, file: File) => upload(`/purchase-requests/${enc(id)}/payment-proof`, fields, file),
  requestAction: (id: string, action: "submit" | "resubmit" | "approve" | "reject" | "cancel" | "process" | "verify-payment" | "reject-payment", body: Row = {}, idempotencyKey?: string) =>
    post(`/purchase-requests/${enc(id)}/${action}`, body, idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined),
  paymentQueue: (q: Query) => list("/payments/verification-queue", q),
  proofUrl: (paymentId: string) => get<{ url: string; expiresAt: string }>(`/payments/${enc(paymentId)}/proof-url`),

  // service
  complaints: (q: Query) => list("/complaints", q),
  complaint: (id: string) => get(`/complaints/${enc(id)}`),
  complaintAction: (id: string, action: "assign" | "reassign" | "reopen", body: Row) => post(`/complaints/${enc(id)}/${action}`, body),

  // HR
  attendance: (q: Query) => list("/attendance", q),
  correctAttendance: (body: Row) => post("/attendance/corrections", body),
  expenses: (q: Query) => list("/expenses", q),
  expenseAction: (id: string, action: "approve" | "reject" | "reimburse", body: Row = {}) => post(`/expenses/${enc(id)}/${action}`, body),
  leaves: (q: Query) => list("/leaves", q),
  leaveAction: (id: string, action: "approve" | "reject", body: Row = {}) => post(`/leaves/${enc(id)}/${action}`, body),
  holidays: (year?: string) => get<Row[]>("/holidays", { year }),
  createHoliday: (body: Row) => post("/holidays", body),
  deleteHoliday: (id: string) => del(`/holidays/${enc(id)}`),
  payroll: (q: Query) => list("/payroll", q),
  generatePayroll: (month: string) => apiRequest<Row>(`${V}/payroll/generate`, { method: "POST", query: { month }, body: {} }),
  adjustPayroll: (id: string, adjustments: number, note?: string) => patch(`/payroll/${enc(id)}/adjustment`, { adjustments, ...(note ? { note } : {}) }),
  payrollAction: (id: string, action: "approve" | "finalize") => post(`/payroll/${enc(id)}/${action}`),

  // reports, audit, files
  report: (kind: string, q: Query) => list(`/reports/${kind}`, q),
  reportCsv: (kind: string, q: Query) => apiDownload(`${V}/reports/${kind}`, { ...q, format: "csv" }, `${kind}-${q.section ?? "report"}-${new Date().toISOString().slice(0, 10)}.csv`),
  auditLogs: (q: Query) => list("/audit-logs", q),
  fileUrl: (key: string) => get<{ url: string; expiresAt: string }>("/uploads/url", { key }),
  put,
};
