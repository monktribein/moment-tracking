import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { guarded, todayIst } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import type { Principal } from "../../rbac/domain/principal";
import { readFix } from "../../sales/domain/visit-state";
import { NEW_ID } from "../../users-employees/application/account.service";
import type { AttendanceCorrectionDto, AttendanceMarkDto, AttendanceQueryDto, HolidayDto, UpdateHolidayDto } from "../presentation/hr.dto";

const IST = "Asia/Kolkata";
const formatIst = (d: Date): string => d.toLocaleString("en-IN", { timeZone: IST, dateStyle: "medium", timeStyle: "short" });
const hours = (minutes: number): string => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
const mapsUrl = (lat: number, lng: number): string => `https://www.google.com/maps?q=${lat},${lng}`;

const COLS = `a.id, a.agent_id, a.agent_name, e.id AS employee_id, e.employee_code, a.date, a.checked_in, a.check_in_time, a.check_in_coords, a.checked_out, a.check_out_time, a.check_out_coords,
  a.total_working_minutes, a.formatted_working_hours, a.status, a.notes, a.updated_at`;
const FROM = `leads.lead_attendances a LEFT JOIN leads.employees e ON e.user_id = a.agent_id AND e.company_id = a.company_id`;

/**
 * Daily attendance for Eco Sor employees. It uses the existing attendance table (one row per
 * person per day, shared with the field-agent app), so a person never has two records for a day.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
  ) {}

  private needEmployee(actor: Principal): void {
    if (!actor.employeeId) throw new ForbiddenException("Attendance is for employee accounts");
  }

  /** One check-in a day. `field` needs a GPS fix; `office` (approved web process) does not. */
  async checkIn(actor: Principal, dto: AttendanceMarkDto) {
    this.needEmployee(actor);
    const mode = dto.mode ?? "field";
    const fix = dto.lat !== undefined && dto.lng !== undefined ? readFix({ lat: dto.lat, lng: dto.lng, accuracy: dto.accuracy }) : null;
    if (mode === "field" && !fix) throw new BadRequestException("A valid GPS location is required to check in. Allow location access and try again.");
    const date = todayIst();
    const now = new Date();
    return guarded(
      () =>
        this.sql.tx(async (db) => {
          const existing = await db.one<any>(`SELECT id, checked_in FROM leads.lead_attendances WHERE agent_id = $1 AND date = $2 FOR UPDATE`, [actor.id, date]);
          if (existing?.checkedIn) throw new ConflictException("You have already checked in today");
          const coords = fix ? JSON.stringify({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }) : null;
          const values = [actor.companyId, actor.id, actor.name, actor.phone, actor.role, date, now, formatIst(now), coords, fix ? mapsUrl(fix.lat, fix.lng) : null, dto.notes ?? (mode === "office" ? "Office attendance (web)" : "")];
          const row = existing
            ? await db.one<{ id: string }>(
                `UPDATE leads.lead_attendances SET checked_in = true, checked_out = false, check_in_time = $7, check_in_formatted_time = $8, check_in_coords = $9::jsonb, check_in_maps_url = $10, status = 'checked_in', notes = $11, company_id = $1, user_id = $2 WHERE id = $12 RETURNING id`,
                [...values, existing.id],
              )
            : await db.one<{ id: string }>(
                `INSERT INTO leads.lead_attendances (id, company_id, agent_id, user_id, agent_name, agent_phone, role, state, district, date, checked_in, checked_out, check_in_time, check_in_formatted_time, check_in_coords, check_in_maps_url, status, notes, created_at, updated_at)
                 VALUES (${NEW_ID}, $1, $2, $2, $3, $4, $5, '', '', $6, true, false, $7, $8, $9::jsonb, $10, 'checked_in', $11, now(), now()) RETURNING id`,
                values,
              );
          await this.audit.log(actor, "attendance.checked_in", "attendance", row!.id, null, { date, mode, lat: fix?.lat ?? null, lng: fix?.lng ?? null }, null, db);
          return db.one(`SELECT ${COLS} FROM ${FROM} WHERE a.id = $1`, [row!.id]);
        }),
      "You have already checked in today",
    );
  }

  /** Check-out needs a check-in the same day, and only once. */
  async checkOut(actor: Principal, dto: AttendanceMarkDto) {
    this.needEmployee(actor);
    const fix = dto.lat !== undefined && dto.lng !== undefined ? readFix({ lat: dto.lat, lng: dto.lng, accuracy: dto.accuracy }) : null;
    if ((dto.mode ?? "field") === "field" && !fix) throw new BadRequestException("A valid GPS location is required to check out.");
    const now = new Date();
    return this.sql.tx(async (db) => {
      const row = await db.one<any>(`SELECT * FROM leads.lead_attendances WHERE agent_id = $1 AND date = $2 FOR UPDATE`, [actor.id, todayIst()]);
      if (!row?.checkedIn) throw new ConflictException("Check in first: you have not checked in today");
      if (row.checkedOut) throw new ConflictException("You have already checked out today");
      const minutes = Math.max(0, (now.getTime() - new Date(row.checkInTime).getTime()) / 60000);
      await db.exec(
        `UPDATE leads.lead_attendances SET checked_out = true, check_out_time = $2, check_out_formatted_time = $3, check_out_coords = $4::jsonb, check_out_maps_url = $5, total_working_minutes = $6, formatted_working_hours = $7, status = 'checked_out' WHERE id = $1`,
        [row.id, now, formatIst(now), fix ? JSON.stringify({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }) : null, fix ? mapsUrl(fix.lat, fix.lng) : null, Math.round(minutes), hours(minutes)],
      );
      await this.audit.log(actor, "attendance.checked_out", "attendance", row.id, null, { minutes: Math.round(minutes) }, null, db);
      return db.one(`SELECT ${COLS} FROM ${FROM} WHERE a.id = $1`, [row.id]);
    });
  }

  today(actor: Principal) {
    return this.sql.one(`SELECT ${COLS} FROM ${FROM} WHERE a.agent_id = $1 AND a.date = $2`, [actor.id, todayIst()]);
  }

  history(actor: Principal, query: AttendanceQueryDto) {
    const where = new Where().eq("a.agent_id = ?", actor.id).eq("a.date >= ?", query.from).eq("a.date <= ?", query.to);
    return paginate(this.sql, { select: COLS, from: FROM, where, sorts: { date: "a.date" }, query, tiebreak: "a.id" });
  }

  /** HR / managers: everyone's attendance for a date range. */
  list(actor: Principal, query: AttendanceQueryDto) {
    const where = new Where().eq("a.company_id = ?", actor.companyId).eq("a.date >= ?", query.from).eq("a.date <= ?", query.to).eq("e.id = ?", query.employeeId);
    where.search(["a.agent_name", "e.employee_code"], query.search);
    return paginate(this.sql, { select: COLS, from: FROM, where, sorts: { date: "a.date", name: "a.agent_name" }, query, tiebreak: "a.id" });
  }

  /** HR corrects a day with a mandatory reason; old and new values are kept (attendance_corrections + audit log). */
  correct(actor: Principal, dto: AttendanceCorrectionDto) {
    return this.sql.tx(async (db) => {
      const row = await db.one<any>(`SELECT * FROM leads.lead_attendances WHERE id = $1 AND company_id = $2 FOR UPDATE`, [dto.attendanceId, actor.companyId]);
      if (!row) throw new NotFoundException("Attendance record not found");
      const inTime = dto.checkInTime ? new Date(dto.checkInTime) : row.checkInTime ? new Date(row.checkInTime) : null;
      const outTime = dto.checkOutTime ? new Date(dto.checkOutTime) : row.checkOutTime ? new Date(row.checkOutTime) : null;
      if (inTime && outTime && outTime < inTime) throw new BadRequestException("Check-out cannot be before check-in");
      const minutes = inTime && outTime ? Math.round((outTime.getTime() - inTime.getTime()) / 60000) : row.totalWorkingMinutes;
      const status = dto.status ?? (outTime ? "checked_out" : inTime ? "checked_in" : row.status);
      const attended = status !== "absent" && Boolean(inTime);
      const snapshot = (r: any) => ({ checkInTime: r.checkInTime, checkOutTime: r.checkOutTime, status: r.status, notes: r.notes, totalWorkingMinutes: r.totalWorkingMinutes });
      await db.exec(
        `UPDATE leads.lead_attendances SET check_in_time = $2, check_out_time = $3, checked_in = $4, checked_out = $5, status = $6, notes = $7, total_working_minutes = $8, formatted_working_hours = $9 WHERE id = $1`,
        [row.id, inTime, outTime, attended, attended && Boolean(outTime), status, dto.notes ?? row.notes, minutes ?? null, minutes !== null && minutes !== undefined ? hours(minutes) : row.formattedWorkingHours],
      );
      const after = await db.one<any>(`SELECT * FROM leads.lead_attendances WHERE id = $1`, [row.id]);
      const employee = await db.one<{ id: string }>(`SELECT id FROM leads.employees WHERE user_id = $1 AND company_id = $2`, [row.agentId, actor.companyId]);
      await db.exec(`INSERT INTO leads.attendance_corrections (company_id, attendance_id, employee_id, old_values, new_values, reason, corrected_by) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`, [actor.companyId, row.id, employee?.id ?? null, JSON.stringify(snapshot(row)), JSON.stringify(snapshot(after)), dto.reason, actor.id]);
      await this.audit.log(actor, "attendance.corrected", "attendance", row.id, snapshot(row), snapshot(after), dto.reason, db);
      return db.one(`SELECT ${COLS} FROM ${FROM} WHERE a.id = $1`, [row.id]);
    });
  }

  // ---------------------------------------------------------------- holidays
  listHolidays(actor: Principal, year?: string) {
    return this.sql.all(`SELECT id, holiday_date, name, is_optional FROM leads.holidays WHERE company_id = $1 AND ($2::text IS NULL OR substr(holiday_date, 1, 4) = $2) ORDER BY holiday_date`, [actor.companyId, year ?? null]);
  }

  createHoliday(actor: Principal, dto: HolidayDto) {
    return guarded(
      () =>
        this.sql.tx(async (db) => {
          const row = await db.one<any>(`INSERT INTO leads.holidays (id, company_id, holiday_date, name, is_optional, created_by) VALUES (${NEW_ID}, $1, $2, $3, $4, $5) RETURNING id, holiday_date, name, is_optional`, [actor.companyId, dto.holidayDate, dto.name, dto.isOptional ?? false, actor.id]);
          await this.audit.log(actor, "holiday.created", "holiday", row.id, null, row, null, db);
          return row;
        }),
      "A holiday already exists on that date",
    );
  }

  updateHoliday(actor: Principal, id: string, dto: UpdateHolidayDto) {
    return guarded(
      () =>
        this.sql.tx(async (db) => {
          const before = await db.one<any>(`SELECT id, holiday_date, name, is_optional FROM leads.holidays WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
          if (!before) throw new NotFoundException("Holiday not found");
          const after = await db.one<any>(`UPDATE leads.holidays SET holiday_date = coalesce($2, holiday_date), name = coalesce($3, name), is_optional = coalesce($4, is_optional) WHERE id = $1 RETURNING id, holiday_date, name, is_optional`, [id, dto.holidayDate ?? null, dto.name ?? null, dto.isOptional ?? null]);
          await this.audit.log(actor, "holiday.updated", "holiday", id, before, after, null, db);
          return after;
        }),
      "A holiday already exists on that date",
    );
  }

  deleteHoliday(actor: Principal, id: string) {
    return this.sql.tx(async (db) => {
      const before = await db.one<any>(`DELETE FROM leads.holidays WHERE id = $1 AND company_id = $2 RETURNING id, holiday_date, name`, [id, actor.companyId]);
      if (!before) throw new NotFoundException("Holiday not found");
      await this.audit.log(actor, "holiday.deleted", "holiday", id, before, null, null, db);
      return { deleted: true };
    });
  }
}
