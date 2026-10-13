import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { kpiService } from "./kpi.service.js";

const PERIODS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"] as const;
type Identity = { id: string; companyId: string; role: Role; employeeId: string | null };

async function getIdentity(req: Request): Promise<Identity> {
  const authorization = req.headers.authorization;
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ApiError(401, "A STEMS access token is required in the Authorization header");
  let payload: any;
  try { payload = jwt.verify(token, env.JWT_ACCESS_SECRET); } catch { throw new ApiError(401, "Invalid or expired STEMS access token"); }
  const user = await prisma.user.findUnique({ where: { id: String(payload.id) }, include: { employee: { select: { id: true, companyId: true } } } });
  if (!user || !user.isActive || !user.companyId) throw new ApiError(401, "STEMS user or company context not found");
  if (payload.companyId && payload.companyId !== user.companyId) throw new ApiError(403, "Token company scope does not match the STEMS account");
  return { id: user.id, companyId: user.companyId, role: user.role, employeeId: user.employee?.id || null };
}

function managerRole(identity: Identity) { return identity.role === Role.SUPER_ADMIN || identity.role === Role.HR_ADMIN || identity.role === Role.MANAGER; }
function adminRole(identity: Identity) { return identity.role === Role.SUPER_ADMIN || identity.role === Role.HR_ADMIN; }
async function assertEmployeeScope(identity: Identity, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId: identity.companyId }, select: { id: true, managerId: true } });
  if (!employee) throw new ApiError(404, "Employee not found in your STEMS company");
  if (identity.role === Role.EMPLOYEE && employee.id !== identity.employeeId) throw new ApiError(403, "Employees may only access their own KPI");
  if (identity.role === Role.MANAGER && employee.id !== identity.employeeId && employee.managerId !== identity.employeeId) throw new ApiError(403, "Managers may only access their direct reports");
}
function result(data: unknown, text: string) {
  const structuredContent = Array.isArray(data) ? { results: data } : data as Record<string, unknown>;
  return { content: [{ type: "text" as const, text }], structuredContent };
}
function explainKpi(k: any) {
  const b = k.breakdown;
  const pct = (value: number | null) => value === null ? "unmeasured" : `${value}%`;
  return `${k.employee.name}: ${k.finalKpiScore}/100 (${k.level}). Attendance ${pct(k.attendance)}, active work ${pct(k.activeWork)}, output ${pct(k.output)}, quality ${pct(k.quality)}, efficiency ${pct(k.efficiency)}, reliability ${pct(k.reliability)}. Normalized work: ${k.workUnits} units. ${b.scoreCoverageWeight}% of configured KPI weight had score evidence. Evidence: ${b.activityMeasurement}; ${b.approvedLeaveDays} approved leave day(s), ${b.approvedWfhDays} approved WFH day(s), ${b.lateDays} late arrival(s), ${b.earlyExitDays} early exit(s), ${b.quality.reworkCount} rework(s), ${b.reliability.overdueTasks} overdue task(s).`;
}
function createServer(identity: Identity) {
  const server = new McpServer({ name: "stems-kpi", version: "1.0.0" });
  registerKpiTools(server, identity);
  return server;
}

export function registerKpiTools(server: McpServer, identity: Identity) {

  const periodSchema = z.enum(PERIODS).default("this_month");

  server.registerTool("get_employee_kpi", { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["stems:read"] }] }, title: "Get employee KPI", description: "Get a company's scoped employee KPI score, level, and component scores for a period.", inputSchema: { employee_id: z.string().describe("STEMS employee ID"), period: periodSchema } }, async ({ employee_id, period }) => {
    await assertEmployeeScope(identity, employee_id); const k = await kpiService.getEmployee(identity.companyId, employee_id, period); return result(k, explainKpi(k));
  });
  server.registerTool("get_employee_kpi_breakdown", { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["stems:read"] }] }, title: "Explain employee KPI", description: "Explain an employee's KPI component evidence, attendance, activity, work units, quality, and reliability.", inputSchema: { employee_id: z.string(), period: periodSchema } }, async ({ employee_id, period }) => {
    await assertEmployeeScope(identity, employee_id); const k = await kpiService.getEmployee(identity.companyId, employee_id, period); return result({ employee: k.employee, score: k.finalKpiScore, level: k.level, components: { attendance: k.attendance, activeWork: k.activeWork, output: k.output, quality: k.quality, efficiency: k.efficiency, reliability: k.reliability }, weights: k.weights, workUnits: k.workUnits, evidence: k.breakdown }, explainKpi(k));
  });
  server.registerTool("compare_employee_kpi", { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["stems:read"] }] }, title: "Compare employee KPI", description: "Compare two to ten employees the authenticated user is allowed to view.", inputSchema: { employee_ids: z.array(z.string()).min(2).max(10), period: periodSchema } }, async ({ employee_ids, period }) => {
    if (!managerRole(identity)) throw new ApiError(403, "Employee comparison requires manager or admin access");
    for (const id of employee_ids) await assertEmployeeScope(identity, id);
    const values = await Promise.all(employee_ids.map((id) => kpiService.getEmployee(identity.companyId, id, period)));
    return result(values, values.map(explainKpi).join("\n"));
  });
  server.registerTool("get_team_kpi", { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["stems:read"] }] }, title: "Get team KPI", description: "Get KPI rankings for members of a team in the authenticated user's company.", inputSchema: { team_id: z.string(), period: periodSchema } }, async ({ team_id, period }) => {
    if (!managerRole(identity)) throw new ApiError(403, "Team KPI requires manager or admin access");
    const team = await prisma.team.findFirst({ where: { id: team_id, companyId: identity.companyId }, include: { members: { select: { employeeId: true } } } });
    if (!team) throw new ApiError(404, "Team not found");
    const values = await Promise.all(team.members.map(async (m: any) => { await assertEmployeeScope(identity, m.employeeId); return kpiService.getEmployee(identity.companyId, m.employeeId, period); }));
    values.sort((a: any, b: any) => b.finalKpiScore - a.finalKpiScore); return result(values, values.map(explainKpi).join("\n") || "No team members found.");
  });
  server.registerTool("get_department_kpi", { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["stems:read"] }] }, title: "Get department KPI", description: "Get KPI rankings for a department. Department-wide data is limited to HR/super admins.", inputSchema: { department_id: z.string(), period: periodSchema } }, async ({ department_id, period }) => {
    if (!managerRole(identity)) throw new ApiError(403, "Department KPI requires manager or admin access");
    const department = await prisma.department.findFirst({ where: { id: department_id, companyId: identity.companyId }, select: { id: true } }); if (!department) throw new ApiError(404, "Department not found");
    if (identity.role === Role.MANAGER) {
      const self = await prisma.employee.findUnique({ where: { id: identity.employeeId || "" }, select: { departmentId: true } });
      if (self?.departmentId !== department_id) throw new ApiError(403, "Managers may only access their own department");
    }
    const values = await kpiService.getCollection(identity.companyId, period, { departmentId: department_id });
    const scoped: any[] = [];
    for (const k of values) if (identity.role !== Role.MANAGER || k.employee.id === identity.employeeId || await awaitManagerScope(identity, k.employee.id)) scoped.push(k);
    return result(scoped, scoped.map(explainKpi).join("\n") || "No department employees found.");
  });
  server.registerTool("get_company_kpi", { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["stems:read"] }] }, title: "Get company KPI", description: "Get company KPI summary and employee ranking. HR/super admins only.", inputSchema: { period: periodSchema } }, async ({ period }) => {
    if (!adminRole(identity)) throw new ApiError(403, "Company-wide KPI requires HR admin or super admin access");
    const values = await kpiService.getCollection(identity.companyId, period);
    const avg = values.length ? values.reduce((sum: number, k: any) => sum + k.finalKpiScore, 0) / values.length : 0;
    const data = { period, employeeCount: values.length, averageKpi: Math.round(avg * 100) / 100, employees: values };
    return result(data, `Company average KPI ${data.averageKpi}/100 across ${values.length} employees.\n${values.map(explainKpi).join("\n")}`);
  });
  server.registerTool("get_top_performers", { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["stems:read"] }] }, title: "Get top performers", description: "Get the highest-scoring employees in the period within the user's allowed scope.", inputSchema: { period: periodSchema, limit: z.number().int().min(1).max(50).default(10) } }, async ({ period, limit }) => {
    const values = await scopedRanking(identity, period); const top = values.slice(0, limit); return result(top, top.map(explainKpi).join("\n") || "No KPI records found.");
  });
  server.registerTool("get_low_performers", { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["stems:read"] }] }, title: "Get low performers", description: "Get the lowest-scoring employees within the user's allowed scope, optionally below a score threshold.", inputSchema: { period: periodSchema, limit: z.number().int().min(1).max(50).default(10), below_score: z.number().min(0).max(100).optional() } }, async ({ period, limit, below_score }) => {
    const values = (await scopedRanking(identity, period)).filter((k: any) => below_score === undefined || k.finalKpiScore < below_score).reverse().slice(0, limit); return result(values, values.map(explainKpi).join("\n") || "No employees fall below that score threshold.");
  });
  server.registerTool("get_kpi_trend", { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }, _meta: { securitySchemes: [{ type: "oauth2", scopes: ["stems:read"] }] }, title: "Get KPI trend", description: "Get stored KPI snapshots for an employee. Employees can access self; managers direct reports; admins company members.", inputSchema: { employee_id: z.string(), limit: z.number().int().min(1).max(60).default(12) } }, async ({ employee_id, limit }) => {
    await assertEmployeeScope(identity, employee_id);
    const snapshots = await prisma.employeeKpiSnapshot.findMany({ where: { companyId: identity.companyId, employeeId: employee_id }, orderBy: { periodStart: "desc" }, take: limit });
    return result(snapshots, snapshots.map((s: any) => `${s.period} starting ${s.periodStart.toISOString().slice(0,10)}: ${s.finalKpiScore}/100 (${s.workUnits} work units).`).join("\n") || "No KPI snapshots have been generated yet.");
  });
  return server;
}

async function awaitManagerScope(identity: Identity, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId: identity.companyId }, select: { managerId: true, departmentId: true } });
  return employee?.managerId === identity.employeeId;
}
async function scopedRanking(identity: Identity, period: string) {
  if (adminRole(identity)) return kpiService.getCollection(identity.companyId, period);
  if (identity.role !== Role.MANAGER || !identity.employeeId) return [await kpiService.getEmployee(identity.companyId, identity.employeeId || "", period)];
  const employees = await prisma.employee.findMany({ where: { companyId: identity.companyId, status: "ACTIVE", managerId: identity.employeeId }, select: { id: true } });
  const values = await Promise.all(employees.map((e: any) => kpiService.getEmployee(identity.companyId, e.id, period)));
  return values.sort((a: any, b: any) => b.finalKpiScore - a.finalKpiScore);
}

export async function handleKpiMcp(req: Request, res: Response) {
  try {
    const identity = await getIdentity(req);
    const server = createServer(identity);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => { void transport.close(); void server.close(); });
  } catch (error: any) {
    if (!res.headersSent) res.status(error?.statusCode || 500).json({ error: error?.message || "MCP request failed" });
  }
}
