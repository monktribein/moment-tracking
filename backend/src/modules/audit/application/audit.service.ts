import { Injectable, Logger } from "@nestjs/common";
import { Db, SqlService } from "../../../database/sql/sql.service";
import { paginate, Where, type PageQueryDto } from "../../../common/eco/pagination";

export interface AuditActor {
  id?: string | null;
  role?: string | null;
  companyId: string;
  ip?: string | null;
}

const SECRET_KEY = /password|passwd|hash|otp|token|secret|storage_?key/i;

/** Copies a value for the audit trail with anything secret-looking blanked out. */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return depth > 5 ? "[...]" : value.map((v) => redactForAudit(v, depth + 1));
  if (typeof value === "object") {
    if (depth > 5) return "[...]";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactForAudit(v, depth + 1);
    return out;
  }
  return value;
}

/**
 * The audit trail (append-only table audit_logs). Every state change in every
 * module calls `log`; pass the transaction's `db` so the entry commits or rolls
 * back together with the change it describes.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly sql: SqlService) {}

  async log(
    actor: AuditActor,
    action: string,
    entity: string,
    entityId: string | null,
    oldValues: unknown = null,
    newValues: unknown = null,
    reason: string | null = null,
    db: Db = this.sql,
  ): Promise<void> {
    await db.exec(
      `INSERT INTO leads.audit_logs (company_id, actor_id, actor_role, action, entity, entity_id, old_values, new_values, reason, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
      [
        actor.companyId,
        actor.id ?? null,
        actor.role ?? null,
        action,
        entity,
        entityId,
        oldValues === null ? null : JSON.stringify(redactForAudit(oldValues)),
        newValues === null ? null : JSON.stringify(redactForAudit(newValues)),
        reason,
        actor.ip ?? null,
      ],
    );
  }

  /** Best-effort variant for events outside a transaction (login, notifications): never fails the request. */
  async logQuietly(...args: Parameters<AuditService["log"]>): Promise<void> {
    try {
      await this.log(...args);
    } catch (error) {
      this.logger.error(`audit write failed: ${(error as Error).message}`);
    }
  }

  async list(
    companyId: string,
    filters: { entity?: string; entityId?: string; action?: string; actorId?: string; from?: string; to?: string },
    query: PageQueryDto,
  ) {
    const where = new Where().eq("a.company_id = ?", companyId);
    where.eq("a.entity = ?", filters.entity).eq("a.entity_id = ?", filters.entityId).eq("a.action = ?", filters.action).eq("a.actor_id = ?", filters.actorId);
    where.eq("a.at >= (?::date)::timestamptz", filters.from).eq("a.at < ((?::date) + 1)::timestamptz", filters.to);
    where.search(["a.action", "a.entity", "a.reason"], query.search);
    return paginate(this.sql, {
      select: "a.id, a.actor_id, a.actor_role, u.name AS actor_name, a.action, a.entity, a.entity_id, a.old_values, a.new_values, a.reason, a.ip, a.at",
      from: "leads.audit_logs a LEFT JOIN leads.lead_users u ON u.id = a.actor_id",
      where,
      sorts: { at: "a.at", action: "a.action", entity: "a.entity" },
      query,
      tiebreak: "a.id",
    });
  }
}
