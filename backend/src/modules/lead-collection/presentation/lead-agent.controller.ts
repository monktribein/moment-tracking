import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../../../common/decorators/public.decorator";
import { LeadsService } from "../application/leads.service";
import { LeadUsersService } from "../application/lead-users.service";
import type { AuthenticatedLeadUser } from "../domain/lead-collection.types";
import { CurrentLeadAgent } from "./decorators/current-lead-agent.decorator";
import { AssignLeadDto, LeadQueryDto, SaveLeadDto } from "./dtos/lead.dto";
import { LeadAgentGuard } from "./guards/lead-agent.guard";

@ApiTags("Lead Collection")
@Public()
@UseGuards(LeadAgentGuard)
@SkipThrottle({ default: true, ipAbuse: true })
@Controller("lead-collection/agent/leads")
export class LeadAgentController {
  constructor(
    private readonly leads: LeadsService,
    private readonly leadUsers: LeadUsersService,
  ) { }

  private scope(agent: AuthenticatedLeadUser) {
    return {
      capturedBy: agent.id,
      role: agent.role,
      employeeCode: agent.employeeCode,
      state: agent.state,
      district: agent.district,
    };
  }

  @Get()
  async list(
    @CurrentLeadAgent() agent: AuthenticatedLeadUser,
    @Query() query: LeadQueryDto,
  ) {
    return {
      success: true,
      data: await this.leads.list(query, this.scope(agent)),
    };
  }

  @Get("stats")
  async stats(@CurrentLeadAgent() agent: AuthenticatedLeadUser) {
    return {
      success: true,
      data: await this.leads.stats(this.scope(agent)),
    };
  }

  @Get("field-agents")
  async listDistrictFieldAgents(@CurrentLeadAgent() agent: AuthenticatedLeadUser) {
    const result = await this.leadUsers.listByDistrict(
      agent.state || "",
      agent.district || "",
      {
        role: "field_agent",
        limit: 1000,
      },
    );
    return {
      success: true,
      data: result.items,
    };
  }

  @Get(":id")
  async one(
    @CurrentLeadAgent() agent: AuthenticatedLeadUser,
    @Param("id") id: string,
  ) {
    return {
      success: true,
      data: await this.leads.findOne(id, this.scope(agent)),
    };
  }

  @Post()
  async create(
    @CurrentLeadAgent() agent: AuthenticatedLeadUser,
    @Body() dto: SaveLeadDto,
  ) {
    return {
      success: true,
      message: "Lead submitted for review",
      data: await this.leads.create(dto, agent),
    };
  }

  @Put(":id")
  async update(
    @CurrentLeadAgent() agent: AuthenticatedLeadUser,
    @Param("id") id: string,
    @Body() dto: SaveLeadDto,
  ) {
    return {
      success: true,
      message: "Lead updated",
      data: await this.leads.update(id, dto, this.scope(agent), agent),
    };
  }

  /**
   * Lead executives and supervisors: assign a pending lead to a field agent of
   * their own district (`{ agentId: null }` unassigns).
   */
  @Post(":id/assign")
  @HttpCode(200)
  async assign(
    @CurrentLeadAgent() agent: AuthenticatedLeadUser,
    @Param("id") id: string,
    @Body() dto: AssignLeadDto,
  ) {
    if (!LeadsService.canAssign(agent.role))
      throw new ForbiddenException("Only lead executives and supervisors can assign leads");
    return {
      success: true,
      message: dto.agentId ? "Lead assigned" : "Lead unassigned",
      data: await this.leads.assign(
        id,
        dto.agentId,
        { name: agent.name, role: agent.role },
        { scope: this.scope(agent), district: agent.district },
      ),
    };
  }

  @Delete(":id")
  async remove(
    @CurrentLeadAgent() agent: AuthenticatedLeadUser,
    @Param("id") id: string,
  ) {
    return {
      success: true,
      message: "Lead deleted",
      data: await this.leads.remove(id, this.scope(agent)),
    };
  }
}
