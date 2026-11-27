import type { Db } from "../../../database/sql/sql.service";

/**
 * Trend series and short lists for the dashboards (charts, "recent", "top", "upcoming").
 * Months are Indian calendar months; every number is counted from the database.
 */

/** The last 6 months (oldest first) as `m`: `s`/`e` are the month's start and end as timestamptz, `ym` is YYYY-MM. */
const MONTHS = `(SELECT to_char(m, 'YYYY-MM') AS ym, m AT TIME ZONE 'Asia/Kolkata' AS s, (m + interval '1 month') AT TIME ZONE 'Asia/Kolkata' AS e
   FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '5 months', date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata'), interval '1 month') m) mo`;

export async function adminExtras(db: Db, c: string, today: string) {
  const [trend, topDistributors, complaintsByCategory, upcomingVisits] = await Promise.all([
    db.all(
      `SELECT mo.ym AS month,
              (SELECT count(*)::int FROM leads.purchase_requests r WHERE r.company_id = $1 AND r.created_at >= mo.s AND r.created_at < mo.e) AS requests,
              (SELECT count(*)::int FROM leads.customers cu WHERE cu.company_id = $1 AND cu.created_at >= mo.s AND cu.created_at < mo.e) AS customers,
              (SELECT count(*)::int FROM leads.complaints k WHERE k.company_id = $1 AND k.created_at >= mo.s AND k.created_at < mo.e) AS complaints,
              (SELECT count(*)::int FROM leads.distributors d WHERE d.company_id = $1 AND d.created_at >= mo.s AND d.created_at < mo.e) AS distributors
         FROM ${MONTHS} ORDER BY mo.ym`,
      [c],
    ),
    // Units on approved/processed requests: the platform has no prices, so units are the honest measure.
    db.all(
      `SELECT d.id, d.firm_name, d.city, coalesce(sum(i.quantity), 0)::int AS units, count(DISTINCT r.id)::int AS requests
         FROM leads.purchase_requests r JOIN leads.distributors d ON d.id = r.distributor_id JOIN leads.purchase_request_items i ON i.request_id = r.id
        WHERE r.company_id = $1 AND r.status IN ('approved','processed') GROUP BY d.id ORDER BY units DESC LIMIT 5`,
      [c],
    ),
    db.all(`SELECT category AS key, count(*)::int AS n FROM leads.complaints WHERE company_id = $1 GROUP BY category ORDER BY n DESC`, [c]),
    db.all(
      `SELECT v.id, v.visit_date, v.purpose, d.firm_name AS distributor_name, d.city, e.name AS employee_name FROM leads.sales_visits v
         JOIN leads.distributors d ON d.id = v.distributor_id JOIN leads.employees e ON e.id = v.employee_id
        WHERE v.company_id = $1 AND v.status = 'scheduled' AND v.visit_date >= $2 ORDER BY v.visit_date, v.created_at LIMIT 5`,
      [c, today],
    ),
  ]);
  const customers = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM leads.customers WHERE company_id = $1`, [c]);
  return { trend, topDistributors, complaintsByCategory, upcomingVisits, customers: customers?.n ?? 0 };
}

export async function salesManagerExtras(db: Db, c: string, today: string) {
  const [trend, recentRequests, upcomingVisits] = await Promise.all([
    db.all(
      `SELECT mo.ym AS month,
              (SELECT count(*)::int FROM leads.sales_visits v WHERE v.company_id = $1 AND substr(v.visit_date, 1, 7) = mo.ym AND v.status NOT IN ('cancelled','rescheduled')) AS visits,
              (SELECT count(*)::int FROM leads.purchase_requests r WHERE r.company_id = $1 AND r.created_at >= mo.s AND r.created_at < mo.e) AS requests
         FROM ${MONTHS} ORDER BY mo.ym`,
      [c],
    ),
    db.all(
      `SELECT r.id, r.request_no, r.status, r.created_at, d.firm_name AS distributor_name,
              (SELECT coalesce(sum(i.quantity), 0)::int FROM leads.purchase_request_items i WHERE i.request_id = r.id) AS units,
              (SELECT string_agg(DISTINCT i.product_snapshot->>'category', ' + ') FROM leads.purchase_request_items i WHERE i.request_id = r.id) AS categories
         FROM leads.purchase_requests r JOIN leads.distributors d ON d.id = r.distributor_id WHERE r.company_id = $1 AND r.status <> 'draft' ORDER BY r.created_at DESC LIMIT 5`,
      [c],
    ),
    db.all(
      `SELECT v.id, v.visit_date, v.purpose, d.firm_name AS distributor_name, d.city, e.name AS employee_name FROM leads.sales_visits v
         JOIN leads.distributors d ON d.id = v.distributor_id JOIN leads.employees e ON e.id = v.employee_id
        WHERE v.company_id = $1 AND v.status = 'scheduled' AND v.visit_date >= $2 ORDER BY v.visit_date, v.created_at LIMIT 5`,
      [c, today],
    ),
  ]);
  return { trend, recentRequests, upcomingVisits };
}

export async function teleSalesExtras(db: Db, employeeId: string, userId: string, today: string) {
  const [todaysFollowups, callOutcomes, recentRequests, callsThisWeek] = await Promise.all([
    db.all(
      `SELECT f.id, f.due_date, f.notes, f.source, d.firm_name AS distributor_name, d.mobile FROM leads.followups f JOIN leads.distributors d ON d.id = f.distributor_id
        WHERE f.employee_id = $1 AND f.status = 'pending' AND f.due_date <= $2 ORDER BY f.due_date LIMIT 6`,
      [employeeId, today],
    ),
    db.all(`SELECT coalesce(nullif(outcome, ''), 'Not recorded') AS key, count(*)::int AS n FROM leads.call_logs WHERE employee_id = $1 AND called_at >= now() - interval '7 days' GROUP BY 1 ORDER BY n DESC`, [employeeId]),
    db.all(
      `SELECT r.id, r.request_no, r.status, r.created_at, d.firm_name AS distributor_name FROM leads.purchase_requests r JOIN leads.distributors d ON d.id = r.distributor_id
        WHERE r.creator_user_id = $1 ORDER BY r.created_at DESC LIMIT 5`,
      [userId],
    ),
    db.one<{ n: number }>(`SELECT count(*)::int AS n FROM leads.call_logs WHERE employee_id = $1 AND called_at >= now() - interval '7 days'`, [employeeId]),
  ]);
  return { todaysFollowups, callOutcomes, recentRequests, callsLast7Days: callsThisWeek?.n ?? 0 };
}

export async function supportExtras(db: Db, c: string, today: string) {
  const [trend, recentComplaints, todaysAssignments, avg] = await Promise.all([
    db.all(
      `SELECT mo.ym AS month,
              (SELECT count(*)::int FROM leads.complaints k WHERE k.company_id = $1 AND k.created_at >= mo.s AND k.created_at < mo.e) AS received,
              (SELECT count(*)::int FROM leads.complaints k WHERE k.company_id = $1 AND k.closed_at >= mo.s AND k.closed_at < mo.e) AS closed
         FROM ${MONTHS} ORDER BY mo.ym`,
      [c],
    ),
    db.all(
      `SELECT k.id, k.complaint_no, k.status, k.category, k.created_at, cu.name AS customer_name, cu.city, cp.category AS product_category, cp.model, en.name AS engineer_name
         FROM leads.complaints k JOIN leads.customers cu ON cu.id = k.customer_id JOIN leads.customer_products cp ON cp.id = k.customer_product_id
         LEFT JOIN leads.complaint_assignments a ON a.complaint_id = k.id AND a.is_current LEFT JOIN leads.employees en ON en.id = a.engineer_id
        WHERE k.company_id = $1 ORDER BY k.created_at DESC LIMIT 5`,
      [c],
    ),
    db.all(
      `SELECT e.id AS engineer_id, e.name, count(v.id)::int AS visits, count(v.id) FILTER (WHERE v.status = 'completed')::int AS completed,
              count(v.id) FILTER (WHERE v.status = 'checked_in')::int AS in_progress
         FROM leads.service_visits v JOIN leads.employees e ON e.id = v.engineer_id
        WHERE v.company_id = $1 AND (v.scheduled_date = $2 OR (v.checkin_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date) AND v.status <> 'cancelled' GROUP BY e.id ORDER BY e.name`,
      [c, today],
    ),
    db.one<{ hours: number | null }>(`SELECT round((avg(extract(epoch FROM (closed_at - created_at))) / 3600)::numeric, 1)::float AS hours FROM leads.complaints WHERE company_id = $1 AND closed_at IS NOT NULL`, [c]),
  ]);
  return { trend, recentComplaints, todaysAssignments, avgHoursToClose: avg?.hours ?? null };
}

export async function hrExtras(db: Db, c: string, today: string) {
  const month = today.slice(0, 7);
  const [trend, recentLeaves, expensesByCategory, totals, inactive] = await Promise.all([
    // Present employee-days per month and the average present per day (days so far in the current month).
    db.all(
      `SELECT mo.ym AS month, x.present_days,
              round((x.present_days::numeric / greatest(1, CASE WHEN mo.ym = $2 THEN extract(day FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int ELSE extract(day FROM (mo.e - interval '1 day') AT TIME ZONE 'Asia/Kolkata')::int END)), 1)::float AS avg_present_per_day
         FROM ${MONTHS}
         CROSS JOIN LATERAL (SELECT count(*)::int AS present_days FROM leads.lead_attendances a JOIN leads.employees e ON e.user_id = a.agent_id AND e.company_id = $1
                              WHERE substr(a.date, 1, 7) = mo.ym AND a.checked_in) x
        ORDER BY mo.ym`,
      [c, month],
    ),
    db.all(`SELECT l.id, l.leave_type, l.from_date, l.to_date, l.status, e.name AS employee_name FROM leads.leaves l JOIN leads.employees e ON e.id = l.employee_id WHERE l.company_id = $1 ORDER BY l.created_at DESC LIMIT 5`, [c]),
    db.all(
      `SELECT category, count(*)::int AS claims, coalesce(sum(amount), 0)::float AS amount FROM leads.expenses
        WHERE company_id = $1 AND substr(expense_date, 1, 7) = $2 AND status <> 'rejected' GROUP BY category ORDER BY amount DESC`,
      [c, month],
    ),
    db.one<{ payroll: number; expenses: number }>(
      `SELECT (SELECT coalesce(sum(net_payable), 0)::float FROM leads.payroll WHERE company_id = $1 AND month = $2) AS payroll,
              (SELECT coalesce(sum(amount), 0)::float FROM leads.expenses WHERE company_id = $1 AND substr(expense_date, 1, 7) = $2 AND status IN ('approved','reimbursed')) AS expenses`,
      [c, month],
    ),
    db.one<{ n: number }>(`SELECT count(*)::int AS n FROM leads.employees WHERE company_id = $1 AND NOT is_active`, [c]),
  ]);
  return { trend, recentLeaves, expensesByCategory, payrollTotal: totals?.payroll ?? 0, expensesApprovedMtd: totals?.expenses ?? 0, inactiveEmployees: inactive?.n ?? 0 };
}
