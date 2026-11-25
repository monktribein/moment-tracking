import { withLocation, type LocationScope } from "../../../common/auth/location-scope";
import { LEAD_LOCATION_FIELDS } from "../domain/lead-collection.constants";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "../../../database/orm-nest";
import { Types, type Model } from "../../../database/orm";
import { escapeRegex } from "../../../common/utils/escape-regex";
import {
  LEAD_ASSIGNER_ROLES,
  LEAD_CONNECTION,
  LEAD_MODEL,
  LEAD_USER_MODEL,
} from "../domain/lead-collection.constants";
import type {
  AuthenticatedLeadUser,
  LeadDocument,
  LeadRecord,
  LeadUserDocument,
  LeadUserRecord,
} from "../domain/lead-collection.types";
import type {
  LeadDecisionDto,
  LeadQueryDto,
  SaveLeadDto,
} from "../presentation/dtos/lead.dto";
import type { LeadAdminActor } from "./lead-users.service";

export interface LeadListResult {
  items: LeadRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface LeadStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  converted: number;
  interested: number;
  meetingsRequested: number;
  capturedLast7Days: number;
}

export interface AgentLeadScope {
  capturedBy: string;
  role?: string;
  employeeCode?: string;
  state?: string;
  district?: string;
}

/** Who changed a lead's assignment: recorded as lastUpdatedByName / lastUpdatedByRole. */
export interface LeadAssigner {
  name: string;
  role: string;
}

interface LeadAssignment {
  assignedAgentId: Types.ObjectId | null;
  assignedAgentName: string;
  assignedAgentCode: string;
}

const sameDistrict = (a?: string, b?: string): boolean =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(LEAD_MODEL, LEAD_CONNECTION)
    private readonly leads: Model<LeadDocument>,
    @InjectModel(LEAD_USER_MODEL, LEAD_CONNECTION)
    private readonly leadUsers: Model<LeadUserDocument>,
  ) {}

  private objectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException("Invalid lead id");
    return new Types.ObjectId(id);
  }

  static canAssign(role?: string): boolean {
    return LEAD_ASSIGNER_ROLES.some((r) => r === role);
  }

  /**
   * The assignment fields for a field agent, read from their account (a name or
   * code sent by the client is never trusted); an empty id unassigns.
   * `district`, when given, limits the choice to field agents of that district.
   */
  private async assignmentFor(
    agentId: string | null | undefined,
    district?: string,
  ): Promise<LeadAssignment> {
    if (!agentId) return { assignedAgentId: null, assignedAgentName: "", assignedAgentCode: "" };
    if (!Types.ObjectId.isValid(agentId))
      throw new BadRequestException("Invalid field agent id");
    const agent = await this.leadUsers
      .findById(new Types.ObjectId(agentId))
      .lean<LeadUserRecord>();
    if (!agent || agent.role !== "field_agent")
      throw new BadRequestException("Choose a field agent to assign this lead to");
    if (agent.status !== "active")
      throw new BadRequestException("This field agent's account is suspended");
    if (district !== undefined && !sameDistrict(agent.district, district))
      throw new ForbiddenException("You can only assign field agents of your own district");
    return {
      assignedAgentId: agent._id,
      assignedAgentName: agent.name,
      assignedAgentCode: agent.employeeCode ?? "",
    };
  }

  private toDocument(
    dto: SaveLeadDto,
    jurisdiction?: { state: string; district: string },
    existing?: LeadRecord,
  ): Record<string, unknown> {
    const lat =
      dto.location?.coordinates?.lat !== undefined
        ? dto.location.coordinates.lat
        : (existing?.location?.coordinates?.lat ?? null);
    const lng =
      dto.location?.coordinates?.lng !== undefined
        ? dto.location.coordinates.lng
        : (existing?.location?.coordinates?.lng ?? null);
    const hasFix = typeof lat === "number" && typeof lng === "number";

    return {
      name: (dto.name ?? existing?.name ?? "").trim(),
      location: {
        address:
          dto.location?.address !== undefined
            ? dto.location.address.trim()
            : (existing?.location?.address ?? ""),
        googleMapsUrl:
          dto.location?.googleMapsUrl !== undefined
            ? dto.location.googleMapsUrl.trim()
            : (existing?.location?.googleMapsUrl ?? ""),
        city:
          dto.location?.city !== undefined
            ? dto.location.city.trim()
            : (existing?.location?.city ?? ""),
        district:
          jurisdiction?.district ??
          (dto.location?.district !== undefined
            ? dto.location.district.trim()
            : (existing?.location?.district ?? "")),
        state:
          jurisdiction?.state ??
          (dto.location?.state !== undefined
            ? dto.location.state.trim()
            : (existing?.location?.state ?? "")),
        coordinates: { lat, lng },
      },
      geo: hasFix ? { type: "Point", coordinates: [lng, lat] } : undefined,
      roomInventory: {
        totalRooms:
          dto.roomInventory?.totalRooms !== undefined
            ? dto.roomInventory.totalRooms
            : (existing?.roomInventory?.totalRooms ?? null),
        roomPrice:
          dto.roomInventory?.roomPrice !== undefined
            ? dto.roomInventory.roomPrice
            : (existing?.roomInventory?.roomPrice ?? null),
        onlineRooms:
          dto.roomInventory?.onlineRooms !== undefined
            ? dto.roomInventory.onlineRooms
            : (existing?.roomInventory?.onlineRooms ?? null),
        offlineRooms:
          dto.roomInventory?.offlineRooms !== undefined
            ? dto.roomInventory.offlineRooms
            : (existing?.roomInventory?.offlineRooms ?? null),
      },
      contact: {
        ownerName:
          dto.contact?.ownerName !== undefined
            ? dto.contact.ownerName.trim()
            : (existing?.contact?.ownerName ?? ""),
        phone:
          dto.contact?.phone !== undefined
            ? dto.contact.phone.trim()
            : (existing?.contact?.phone ?? ""),
      },
      notes: dto.notes !== undefined ? dto.notes.trim() : (existing?.notes ?? ""),
      agentNotes:
        dto.agentNotes !== undefined
          ? dto.agentNotes.trim()
          : (existing?.agentNotes ?? ""),
      interest: dto.interest ?? existing?.interest ?? "Interested",
      meeting: {
        requested:
          dto.meeting?.requested !== undefined
            ? dto.meeting.requested
            : (existing?.meeting?.requested ?? false),
        time:
          dto.meeting?.time !== undefined
            ? dto.meeting.time.trim()
            : (existing?.meeting?.time ?? ""),
        mode:
          dto.meeting?.mode !== undefined
            ? dto.meeting.mode
            : (existing?.meeting?.mode ?? ""),
      },
      images: dto.images ?? existing?.images ?? [],
      // assignedAgentId / Name / Code are set only through assignmentFor().
      documentChecklist:
        dto.documentChecklist !== undefined
          ? dto.documentChecklist
          : (existing?.documentChecklist ?? null),
      documentCategory:
        dto.documentCategory !== undefined
          ? dto.documentCategory
          : (existing?.documentCategory ?? ""),
      docVerificationStatus:
        dto.docVerificationStatus !== undefined
          ? dto.docVerificationStatus
          : (existing?.docVerificationStatus ?? "pending"),
      documentVerified:
        dto.documentVerified !== undefined
          ? dto.documentVerified
          : (existing?.documentVerified ?? false),
      docVerifiedAt:
        dto.docVerifiedAt !== undefined
          ? dto.docVerifiedAt ? new Date(dto.docVerifiedAt) : null
          : (existing?.docVerifiedAt ?? null),
      docVerifiedByName:
        dto.docVerifiedByName !== undefined
          ? dto.docVerifiedByName
          : (existing?.docVerifiedByName ?? ""),
      docVerifiedById:
        dto.docVerifiedById !== undefined
          ? dto.docVerifiedById && Types.ObjectId.isValid(dto.docVerifiedById)
            ? new Types.ObjectId(dto.docVerifiedById)
            : null
          : (existing?.docVerifiedById ?? null),
      docVerificationNotes:
        dto.docVerificationNotes !== undefined
          ? dto.docVerificationNotes
          : (existing?.docVerificationNotes ?? ""),
      fieldVerified:
        dto.fieldVerified !== undefined
          ? dto.fieldVerified
          : (existing?.fieldVerified ?? false),
      fieldVerifiedByName:
        dto.fieldVerifiedByName !== undefined
          ? dto.fieldVerifiedByName
          : (existing?.fieldVerifiedByName ?? ""),
    };
  }

  private buildFilter(query: LeadQueryDto): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.interest) filter.interest = query.interest;
    if (query.city?.trim())
      filter["location.city"] = new RegExp(
        `^${escapeRegex(query.city.trim())}$`,
        "i",
      );
    if (query.capturedBy) filter.capturedBy = this.objectId(query.capturedBy);
    if (query.search?.trim()) {
      const term = new RegExp(escapeRegex(query.search.trim()), "i");
      filter.$or = [
        { name: term },
        { "location.city": term },
        { "location.address": term },
        { "contact.ownerName": term },
        { "contact.phone": term },
        { capturedByName: term },
      ];
    }
    return filter;
  }

  async list(
    query: LeadQueryDto,
    scope?: AgentLeadScope,
    location: LocationScope = null,
  ): Promise<LeadListResult> {
    const filter = this.buildFilter(query);
    if (scope) {
      const agentObjId = Types.ObjectId.isValid(scope.capturedBy)
        ? this.objectId(scope.capturedBy)
        : null;

      if (scope.role === "field_agent") {
        // Field agent sees leads captured by them OR assigned to them
        const accessOr: Record<string, unknown>[] = [];
        if (agentObjId) {
          accessOr.push({ capturedBy: agentObjId });
          accessOr.push({ assignedAgentId: agentObjId });
        }
        if (scope.employeeCode?.trim()) {
          accessOr.push({ assignedAgentCode: scope.employeeCode.trim() });
        }
        if (accessOr.length > 0) {
          if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, { $or: accessOr }];
            delete filter.$or;
          } else {
            filter.$or = accessOr;
          }
        }
      } else if (scope.role === "document_verifier" || scope.role === "field_supervisor") {
        // Document verifiers and Supervisors see all leads in their region
      } else if (agentObjId) {
        // Lead executives and standard agents see only their own captured leads
        filter.capturedBy = agentObjId;
      }

      // A field agent sees exactly their own and their assigned leads, wherever
      // they are: the Super Admin may assign a lead outside the agent's district.
      if (scope.role === "field_agent") {
        // no area filter
      } else if (scope.district?.trim()) {
        const dRegex = new RegExp(escapeRegex(scope.district.trim()), "i");
        const locFilter = {
          $or: [
            { "location.district": dRegex },
            { "location.city": dRegex },
            { "location.address": dRegex },
          ],
        };
        if (filter.$and) {
          (filter.$and as Record<string, unknown>[]).push(locFilter);
        } else if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, locFilter];
          delete filter.$or;
        } else {
          Object.assign(filter, locFilter);
        }
      } else if (scope.state?.trim()) {
        filter["location.state"] = new RegExp(`^${escapeRegex(scope.state.trim())}$`, "i");
      }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await Promise.all([
      this.leads
        .find(withLocation(filter, location, LEAD_LOCATION_FIELDS))
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeadRecord[]>(),
      this.leads.countDocuments(withLocation(filter, location, LEAD_LOCATION_FIELDS)),
    ]);
    return { items, total, page, limit };
  }

  async findOne(id: string, scope?: AgentLeadScope): Promise<LeadRecord> {
    const row = await this.leads.findById(this.objectId(id)).lean<LeadRecord>();
    if (!row) throw new NotFoundException("Lead not found");
    const isOwner = Boolean(scope) && String(row.capturedBy ?? "") === scope?.capturedBy;
    const isAssigned = Boolean(
      scope &&
        ((row.assignedAgentId && String(row.assignedAgentId) === scope.capturedBy) ||
          (scope.employeeCode && row.assignedAgentCode === scope.employeeCode)),
    );
    if (scope) {
      if (scope.role === "field_agent") {
        if (!isOwner && !isAssigned) {
          // If unassigned but in same region, allow access
          if (scope.district?.trim() && row.location) {
            const d = scope.district.trim().toLowerCase();
            const match =
              (row.location.district && row.location.district.toLowerCase().includes(d)) ||
              (row.location.city && row.location.city.toLowerCase().includes(d)) ||
              (row.location.address && row.location.address.toLowerCase().includes(d));
            if (!match) {
              throw new ForbiddenException("This lead is not assigned to you");
            }
          }
        }
      } else if (
        scope.role === "document_verifier" ||
        scope.role === "field_supervisor"
      ) {
        // Authorized KYC and supervision roles can view leads in their jurisdiction
      } else if (!isOwner && !isAssigned) {
        throw new ForbiddenException("This lead belongs to another agent");
      }
    }
    // A field agent's own or assigned lead stays open to them in any district.
    const ownedOrAssigned = scope?.role === "field_agent" && (isOwner || isAssigned);
    if (scope?.district?.trim() && row.location && !ownedOrAssigned) {
      const d = scope.district.trim().toLowerCase();
      const match =
        (row.location.district && row.location.district.toLowerCase().includes(d)) ||
        (row.location.city && row.location.city.toLowerCase().includes(d)) ||
        (row.location.address && row.location.address.toLowerCase().includes(d));
      if (!match && scope.role !== "document_verifier" && scope.role !== "field_supervisor") {
        throw new ForbiddenException("This lead is outside your assigned region");
      }
    }
    return row;
  }

  async create(
    dto: SaveLeadDto,
    agent: AuthenticatedLeadUser,
  ): Promise<LeadRecord> {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException("Stay name is required");
    }
    let assignment: Partial<LeadAssignment> = {};
    if (dto.assignedAgentId) {
      if (!LeadsService.canAssign(agent.role))
        throw new ForbiddenException("Only lead executives and supervisors can assign leads");
      assignment = await this.assignmentFor(dto.assignedAgentId, agent.district);
    }
    const created = await this.leads.create({
      ...this.toDocument(dto, {
        state: agent.state,
        district: agent.district,
      }),
      ...assignment,
      status: "pending",
      capturedBy: new Types.ObjectId(agent.id),
      capturedByName: agent.name,
      capturedAt: new Date(),
    });
    return this.findOne(created._id.toString());
  }

  async createAsAdmin(dto: SaveLeadDto): Promise<LeadRecord> {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException("Stay name is required");
    }
    const assignment = dto.assignedAgentId ? await this.assignmentFor(dto.assignedAgentId) : {};
    const created = await this.leads.create({
      ...this.toDocument(dto),
      ...assignment,
      status: dto.status ?? "pending",
      capturedByName: "Admin console",
      capturedAt: new Date(),
    });
    return this.findOne(created._id.toString());
  }

  /**
   * Assigns a lead to a field agent (null unassigns). On the agent routes
   * (`scope` given) the lead must be visible to the caller and still pending,
   * and `district` limits the choice to field agents of the caller's district.
   */
  async assign(
    id: string,
    agentId: string | null,
    assigner: LeadAssigner,
    options: { scope?: AgentLeadScope; district?: string } = {},
  ): Promise<LeadRecord> {
    const existing = await this.findOne(id, options.scope);
    if (options.scope && existing.status !== "pending")
      throw new ForbiddenException(
        "This lead has already been reviewed and can no longer be reassigned",
      );
    const assignment = await this.assignmentFor(agentId, options.district);
    const row = await this.leads
      .findByIdAndUpdate(
        this.objectId(id),
        {
          $set: {
            ...assignment,
            lastUpdatedByName: assigner.name,
            lastUpdatedByRole: assigner.role,
          },
        },
        { new: true },
      )
      .lean<LeadRecord>();
    if (!row) throw new NotFoundException("Lead not found");
    return row;
  }

  async update(
    id: string,
    dto: SaveLeadDto,
    scope?: AgentLeadScope,
    actor?: AuthenticatedLeadUser,
  ): Promise<LeadRecord> {
    const existing = await this.findOne(id, scope);
    if (scope && existing.status !== "pending")
      throw new ForbiddenException(
        "This lead has already been reviewed and can no longer be edited",
      );

    const update = this.toDocument(
      dto,
      scope?.state && scope?.district
        ? { state: scope.state, district: scope.district }
        : undefined,
      existing,
    );
    const unset = update.geo === undefined ? { geo: "" } : undefined;
    if (unset) delete update.geo;
    if (!scope && dto.status) update.status = dto.status;

    // Sending the same assignee back (a full-object save) changes nothing.
    const currentAgent = existing.assignedAgentId ? String(existing.assignedAgentId) : "";
    if (dto.assignedAgentId !== undefined && (dto.assignedAgentId || "") !== currentAgent) {
      if (!scope) {
        Object.assign(update, await this.assignmentFor(dto.assignedAgentId));
      } else if (LeadsService.canAssign(actor?.role ?? scope.role)) {
        Object.assign(
          update,
          await this.assignmentFor(dto.assignedAgentId, actor?.district ?? scope.district ?? ""),
        );
      } else {
        throw new ForbiddenException("Only lead executives and supervisors can assign leads");
      }
    }

    // Track field agent update / verification
    if (actor?.role === "field_agent" || scope?.role === "field_agent") {
      (update as any).fieldVerified = true;
      (update as any).fieldVerifiedAt = new Date();
      (update as any).fieldVerifiedByName =
        actor?.name || existing.assignedAgentName || "";
      if (actor?.id && Types.ObjectId.isValid(actor.id)) {
        (update as any).fieldVerifiedById = new Types.ObjectId(actor.id);
      }
      (update as any).lastUpdatedByName = actor?.name || "";
      (update as any).lastUpdatedByRole = actor?.role || "field_agent";
    } else if (actor) {
      (update as any).lastUpdatedByName = actor.name;
      (update as any).lastUpdatedByRole = actor.role;
    }

    const row = await this.leads
      .findByIdAndUpdate(
        this.objectId(id),
        unset ? { $set: update, $unset: unset } : { $set: update },
        { new: true },
      )
      .lean<LeadRecord>();
    if (!row) throw new NotFoundException("Lead not found");
    return row;
  }

  async decide(
    id: string,
    status: "approved" | "rejected" | "converted" | "pending",
    dto: LeadDecisionDto,
    actor: LeadAdminActor,
  ): Promise<LeadRecord> {
    const row = await this.leads
      .findByIdAndUpdate(
        this.objectId(id),
        {
          $set: {
            status,
            reviewNote: dto.note?.trim() ?? "",
            reviewedByAdminId: actor.id,
            reviewedByAdminName: actor.name,
            reviewedAt: new Date(),
          },
        },
        { new: true },
      )
      .lean<LeadRecord>();
    if (!row) throw new NotFoundException("Lead not found");
    return row;
  }

  async remove(
    id: string,
    scope?: AgentLeadScope,
  ): Promise<{ id: string }> {
    const row = await this.findOne(id, scope);
    // A lead assigned to a field agent belongs to whoever added it.
    if (scope?.role === "field_agent" && String(row.capturedBy ?? "") !== scope.capturedBy)
      throw new ForbiddenException("Only the person who added this lead can delete it");
    await this.leads.findByIdAndDelete(this.objectId(id));
    return { id };
  }

  async stats(scope?: AgentLeadScope, location: LocationScope = null): Promise<LeadStats> {
    const match: Record<string, unknown> = {};
    if (scope) {
      const agentObjId = Types.ObjectId.isValid(scope.capturedBy)
        ? this.objectId(scope.capturedBy)
        : null;

      if (scope.role === "field_agent") {
        const accessOr: Record<string, unknown>[] = [];
        if (agentObjId) {
          accessOr.push({ capturedBy: agentObjId });
          accessOr.push({ assignedAgentId: agentObjId });
        }
        if (scope.employeeCode?.trim()) {
          accessOr.push({ assignedAgentCode: scope.employeeCode.trim() });
        }
        if (accessOr.length > 0) match.$or = accessOr;
      } else if (agentObjId) {
        match.capturedBy = agentObjId;
      }
      // Same rule as list(): a field agent's own and assigned leads count anywhere.
      if (scope.role !== "field_agent") {
        if (scope.state) match["location.state"] = scope.state;
        if (scope.district) match["location.district"] = scope.district;
      }
    }
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [row] = await this.leads.aggregate<LeadStats>([
      { $match: withLocation(match, location, LEAD_LOCATION_FIELDS) },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          approved: {
            $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
          },
          rejected: {
            $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
          },
          converted: {
            $sum: { $cond: [{ $eq: ["$status", "converted"] }, 1, 0] },
          },
          interested: {
            $sum: { $cond: [{ $eq: ["$interest", "Interested"] }, 1, 0] },
          },
          meetingsRequested: {
            $sum: { $cond: [{ $eq: ["$meeting.requested", true] }, 1, 0] },
          },
          capturedLast7Days: {
            $sum: { $cond: [{ $gte: ["$capturedAt", sevenDaysAgo] }, 1, 0] },
          },
        },
      },
      { $project: { _id: 0 } },
    ]);

    return (
      row ?? {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        converted: 0,
        interested: 0,
        meetingsRequested: 0,
        capturedLast7Days: 0,
      }
    );
  }

  async listByDistrict(
    query: LeadQueryDto,
    state: string,
    district: string,
    agentId?: string,
  ): Promise<LeadListResult> {
    const filter = this.buildFilter(query);
    const districtRegex = new RegExp(escapeRegex(district.trim()), "i");
    filter.$or = [
      { "location.district": districtRegex },
      { "location.city": districtRegex },
      { "location.address": districtRegex },
    ];
    if (agentId) filter.capturedBy = this.objectId(agentId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await Promise.all([
      this.leads
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeadRecord[]>(),
      this.leads.countDocuments(filter),
    ]);
    return { items, total, page, limit };
  }

  async statsByDistrict(state: string, district: string): Promise<LeadStats> {
    const districtRegex = new RegExp(escapeRegex(district.trim()), "i");
    const match: Record<string, unknown> = {
      $or: [
        { "location.district": districtRegex },
        { "location.city": districtRegex },
        { "location.address": districtRegex },
      ],
    };
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [row] = await this.leads.aggregate<LeadStats>([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          approved: {
            $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
          },
          rejected: {
            $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
          },
          converted: {
            $sum: { $cond: [{ $eq: ["$status", "converted"] }, 1, 0] },
          },
          interested: {
            $sum: { $cond: [{ $eq: ["$interest", "Interested"] }, 1, 0] },
          },
          meetingsRequested: {
            $sum: { $cond: [{ $eq: ["$meeting.requested", true] }, 1, 0] },
          },
          capturedLast7Days: {
            $sum: { $cond: [{ $gte: ["$capturedAt", sevenDaysAgo] }, 1, 0] },
          },
        },
      },
      { $project: { _id: 0 } },
    ]);

    return (
      row ?? {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        converted: 0,
        interested: 0,
        meetingsRequested: 0,
        capturedLast7Days: 0,
      }
    );
  }
}

