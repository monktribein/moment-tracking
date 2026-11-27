import { NotFoundException } from "@nestjs/common";
import type { Db } from "../../../database/sql/sql.service";
import type { Principal } from "../../rbac/domain/principal";

export interface ComplaintRow {
  id: string;
  companyId: string;
  complaintNo: string;
  customerId: string;
  customerProductId: string;
  category: string;
  status: string;
  customerMobile: string;
  customerName: string;
  customerUserId: string | null;
  engineerId: string | null;
  engineerUserId: string | null;
  assignmentId: string | null;
  reopenCount: number;
}

const BASE = `SELECT c.*, cu.mobile AS customer_mobile, cu.name AS customer_name, cu.user_id AS customer_user_id,
    a.engineer_id AS engineer_id, a.id AS assignment_id, ee.user_id AS engineer_user_id
  FROM leads.complaints c JOIN leads.customers cu ON cu.id = c.customer_id
  LEFT JOIN leads.complaint_assignments a ON a.complaint_id = c.id AND a.is_current
  LEFT JOIN leads.employees ee ON ee.id = a.engineer_id`;

/** Loads a complaint (optionally locking it) with its customer and current engineer. */
export async function loadComplaint(db: Db, companyId: string, id: string, lock = false): Promise<ComplaintRow> {
  const row = await db.one<ComplaintRow>(`${BASE} WHERE c.id = $1 AND c.company_id = $2${lock ? " FOR UPDATE OF c" : ""}`, [id, companyId]);
  if (!row) throw new NotFoundException("Complaint not found");
  return row;
}

/** A customer sees only their own complaints, an engineer only the ones assigned to them; support staff all. */
export function assertCanSeeComplaint(actor: Principal, c: Pick<ComplaintRow, "customerId" | "engineerId">): void {
  const denied = new NotFoundException("Complaint not found");
  if (actor.role === "customer" && c.customerId !== actor.customerId) throw denied;
  if (actor.role === "field_support" && c.engineerId !== actor.employeeId) throw denied;
}

export async function logComplaintStatus(db: Db, actor: Principal, c: Pick<ComplaintRow, "id" | "companyId">, from: string | null, to: string, reason?: string | null): Promise<void> {
  await db.exec(`INSERT INTO leads.complaint_status_logs (company_id, complaint_id, from_status, to_status, actor_id, reason) VALUES ($1, $2, $3, $4, $5, $6)`, [c.companyId, c.id, from, to, actor.id, reason ?? null]);
}

/** The complaint with its product, assignment and a single time-ordered timeline. */
export async function complaintDetail(db: Db, companyId: string, id: string) {
  const header = await db.one<any>(
    `SELECT c.id, c.complaint_no, c.customer_id, cu.name AS customer_name, cu.mobile AS customer_mobile, c.customer_product_id, cp.category AS product_category, cp.model, cp.serial_no, cp.warranty_status,
            c.category, c.description, c.photos, c.warranty_proof_key, c.service_address, c.contact, c.status, c.reopen_count, c.resolved_at, c.closed_at, c.created_at, c.updated_at,
            a.engineer_id, en.name AS engineer_name, en.mobile AS engineer_mobile
       FROM leads.complaints c JOIN leads.customers cu ON cu.id = c.customer_id JOIN leads.customer_products cp ON cp.id = c.customer_product_id
       LEFT JOIN leads.complaint_assignments a ON a.complaint_id = c.id AND a.is_current LEFT JOIN leads.employees en ON en.id = a.engineer_id
      WHERE c.id = $1 AND c.company_id = $2`,
    [id, companyId],
  );
  if (!header) throw new NotFoundException("Complaint not found");
  const [statusLogs, assignments, visits, reports] = await Promise.all([
    db.all<any>(`SELECT l.id, l.from_status, l.to_status, l.reason, l.at, u.name AS actor_name FROM leads.complaint_status_logs l LEFT JOIN leads.lead_users u ON u.id = l.actor_id WHERE l.complaint_id = $1`, [id]),
    db.all<any>(`SELECT a.id, a.assigned_at, a.unassigned_at, a.is_current, a.reason, a.scheduled_date, e.name AS engineer_name FROM leads.complaint_assignments a JOIN leads.employees e ON e.id = a.engineer_id WHERE a.complaint_id = $1`, [id]),
    db.all<any>(`SELECT v.id, v.status, v.scheduled_date, v.checkin_at, v.checkin_lat, v.checkin_lng, v.checkin_accuracy, e.name AS engineer_name FROM leads.service_visits v JOIN leads.employees e ON e.id = v.engineer_id WHERE v.complaint_id = $1`, [id]),
    db.all<any>(`SELECT r.id, r.diagnosis, r.action_taken, r.notes, r.photos, r.further_action, r.submitted_at, e.name AS engineer_name FROM leads.service_reports r JOIN leads.employees e ON e.id = r.engineer_id WHERE r.complaint_id = $1`, [id]),
  ]);
  const timeline = [
    ...statusLogs.map((l) => ({ at: l.at, type: "status", from: l.fromStatus, to: l.toStatus, reason: l.reason, by: l.actorName })),
    ...assignments.map((a) => ({ at: a.assignedAt, type: "assigned", engineer: a.engineerName, scheduledDate: a.scheduledDate, reason: a.reason })),
    ...visits.filter((v) => v.checkinAt).map((v) => ({ at: v.checkinAt, type: "engineer_check_in", engineer: v.engineerName, lat: v.checkinLat, lng: v.checkinLng, accuracy: v.checkinAccuracy })),
    ...reports.map((r) => ({ at: r.submittedAt, type: "service_report", engineer: r.engineerName, diagnosis: r.diagnosis, actionTaken: r.actionTaken, furtherAction: r.furtherAction })),
  ].sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
  return { ...header, assignments, visits, reports, timeline };
}
