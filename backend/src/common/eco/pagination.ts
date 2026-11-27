import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { Db, Row } from "../../database/sql/sql.service";

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(40) sort?: string;
  @IsOptional() @Transform(({ value }) => String(value).toLowerCase()) @IsIn(["asc", "desc"]) order?: "asc" | "desc";
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

/** Collects WHERE conditions with numbered parameters. */
export class Where {
  readonly params: unknown[] = [];
  private readonly parts: string[] = [];

  /** `cond` uses `?` where the value goes; a null/undefined/"" value skips the condition. */
  eq(cond: string, value: unknown): this {
    if (value === undefined || value === null || value === "") return this;
    this.parts.push(cond.replace("?", `$${this.params.push(value)}`));
    return this;
  }

  raw(cond: string): this {
    this.parts.push(cond);
    return this;
  }

  /** ILIKE across several columns. */
  search(columns: string[], text?: string): this {
    const term = text?.trim();
    if (!term) return this;
    const p = `$${this.params.push(`%${term.replace(/[\\%_]/g, "\\$&")}%`)}`;
    this.parts.push(`(${columns.map((c) => `${c} ILIKE ${p}`).join(" OR ")})`);
    return this;
  }

  param(value: unknown): string {
    return `$${this.params.push(value)}`;
  }

  get sql(): string {
    return this.parts.length ? `WHERE ${this.parts.join(" AND ")}` : "";
  }
}

export interface PageSpec {
  select: string;
  from: string;
  where: Where;
  /** API sort key -> SQL expression. The first entry is the default. */
  sorts: Record<string, string>;
  query: PageQueryDto;
  /** Default direction when the caller gives none. */
  defaultOrder?: "asc" | "desc";
  tiebreak?: string;
}

/** One page of rows plus the total, with a whitelisted ORDER BY. */
export async function paginate<T = Row>(db: Db, spec: PageSpec): Promise<{ items: T[]; page: number; limit: number; total: number }> {
  const page = spec.query.page ?? 1;
  const limit = spec.query.limit ?? 20;
  const keys = Object.keys(spec.sorts);
  const column = spec.sorts[spec.query.sort ?? ""] ?? spec.sorts[keys[0]];
  const direction = (spec.query.order ?? spec.defaultOrder ?? "desc") === "asc" ? "ASC" : "DESC";
  const where = spec.where;
  const total = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ${spec.from} ${where.sql}`, where.params);
  const items = await db.all<T>(
    `SELECT ${spec.select} FROM ${spec.from} ${where.sql} ORDER BY ${column} ${direction}${spec.tiebreak ? `, ${spec.tiebreak}` : ""} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    where.params,
  );
  return { items, page, limit, total: total?.n ?? 0 };
}
