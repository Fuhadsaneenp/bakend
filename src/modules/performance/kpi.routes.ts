import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { kpiService, periodRange } from "./kpi.service.js";

export const kpiRouter = Router();
kpiRouter.use(requireAuth);
const managers = [Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER];
const admins = [Role.SUPER_ADMIN, Role.HR_ADMIN];
function company(req: any) { if (!req.user.companyId) throw new ApiError(400, "Company context required"); return req.user.companyId as string; }
async function employeeForUser(userId: string) { const e = await prisma.employee.findUnique({ where: { userId }, select: { id: true } }); if (!e) throw new ApiError(404, "Employee profile not found"); return e.id; }
async function assertEmployeeScope(req: any, employeeId: string) {
  const companyId = company(req);
  if (req.user.role === Role.SUPER_ADMIN || req.user.role === Role.HR_ADMIN) return;
  const actor = await prisma.employee.findUnique({ where: { userId: req.user.id }, select: { id: true } });
  const target = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true, managerId: true, departmentId: true } });
  if (!target) throw new ApiError(404, "Employee not found");
  if (req.user.role === Role.EMPLOYEE && target.id !== actor?.id) throw new ApiError(403, "Employees may only view their own KPI");
  if (req.user.role === Role.MANAGER && target.id !== actor?.id && target.managerId !== actor?.id) throw new ApiError(403, "Managers may only view their direct reports");
}

kpiRouter.get("/settings", requireRoles(...admins), async (req: any, res, next) => { try { res.json(await kpiService.getConfiguration(company(req))); } catch (e) { next(e); } });
kpiRouter.put("/settings", requireRoles(...admins), async (req: any, res, next) => {
  try {
    const body = z.object({
      weights: z.object({ attendance: z.number().min(0), activeWork: z.number().min(0), output: z.number().min(0), quality: z.number().min(0), efficiency: z.number().min(0), reliability: z.number().min(0) }).optional(),
      levels: z.array(z.object({ name: z.string().min(1), min: z.number().min(0).max(100), max: z.number().min(0).max(100) })).optional(),
      maxOutputScore: z.number().min(100).max(200).optional(), minimumActiveRatio: z.number().min(0).max(1).optional(),
      rules: z.array(z.object({ taskType: z.string().min(1), quantity: z.number().positive(), workUnits: z.number().positive() })).optional(),
      targets: z.array(z.object({ scope: z.enum(["COMPANY", "DEPARTMENT", "DESIGNATION", "EMPLOYEE"]), scopeId: z.string().nullable().optional(), dailyWorkUnits: z.number().positive(), expectedMinutes: z.number().int().positive().max(1440) })).optional()
    }).parse(req.body);
    res.json(await kpiService.updateConfiguration(company(req), body));
  } catch (e) { next(e); }
});

kpiRouter.get("/employee/:employeeId", async (req: any, res, next) => {
  try {
    const companyId = company(req);
    const selfId = await employeeForUser(req.user.id);
    const employeeId = managers.includes(req.user.role) ? req.params.employeeId : selfId;
    await assertEmployeeScope(req, employeeId);
    const result = await kpiService.getEmployee(companyId, employeeId, String(req.query.period || "this_month"));
    res.json(result);
  } catch (e) { next(e); }
});
kpiRouter.get("/team/:teamId", requireRoles(...managers), async (req: any, res, next) => { try { const companyId = company(req); const team = await prisma.team.findFirst({ where: { id: req.params.teamId, companyId }, select: { departmentId: true } }); if (!team) throw new ApiError(404, "Team not found"); const managerId = req.user.role === Role.MANAGER ? await employeeForUser(req.user.id) : undefined; res.json(await kpiService.getCollection(companyId, String(req.query.period || "this_month"), { teamId: req.params.teamId, managerId })); } catch (e) { next(e); } });
kpiRouter.get("/department/:departmentId", requireRoles(...managers), async (req: any, res, next) => { try { const companyId = company(req); const dep = await prisma.department.findFirst({ where: { id: req.params.departmentId, companyId }, select: { id: true } }); if (!dep) throw new ApiError(404, "Department not found"); let managerId: string | undefined; if (req.user.role === Role.MANAGER) { managerId = await employeeForUser(req.user.id); const manager = await prisma.employee.findFirst({ where: { id: managerId, companyId }, select: { departmentId: true } }); if (manager?.departmentId !== dep.id) throw new ApiError(403, "Managers may only view their own department"); } res.json(await kpiService.getCollection(companyId, String(req.query.period || "this_month"), { departmentId: req.params.departmentId, managerId })); } catch (e) { next(e); } });
kpiRouter.get("/company", requireRoles(...managers), async (req: any, res, next) => { try { const companyId = company(req); if (req.user.role === Role.MANAGER) { const me = await prisma.employee.findUnique({ where: { userId: req.user.id }, select: { id: true } }); res.json(await kpiService.getCollection(companyId, String(req.query.period || "this_month"), { managerId: me?.id })); } else res.json(await kpiService.getCollection(companyId, String(req.query.period || "this_month"))); } catch (e) { next(e); } });
kpiRouter.get("/ranking", requireRoles(...managers), async (req: any, res, next) => { try { const companyId = company(req); if (req.user.role === Role.MANAGER) { const me = await prisma.employee.findUnique({ where: { userId: req.user.id }, select: { id: true } }); res.json(await kpiService.getCollection(companyId, String(req.query.period || "this_month"), { managerId: me?.id })); } else res.json(await kpiService.getCollection(companyId, String(req.query.period || "this_month"))); } catch (e) { next(e); } });
kpiRouter.get("/comparison", requireRoles(...managers), async (req: any, res, next) => {
  try { const ids = z.array(z.string()).min(2).max(10).parse(String(req.query.employeeIds || "").split(",").filter(Boolean)); const period = String(req.query.period || "this_month"); for (const id of ids) await assertEmployeeScope(req, id); res.json(await Promise.all(ids.map((id) => kpiService.getEmployee(company(req), id, period)))); } catch (e) { next(e); }
});
kpiRouter.get("/trend/:employeeId", async (req: any, res, next) => {
  try {
    const companyId = company(req); const selfId = await employeeForUser(req.user.id);
    const id = managers.includes(req.user.role) ? req.params.employeeId : selfId;
    await assertEmployeeScope(req, id);
    res.json(await prisma.employeeKpiSnapshot.findMany({ where: { companyId, employeeId: id }, orderBy: { periodStart: "asc" }, take: 24 }));
  } catch (e) { next(e); }
});
kpiRouter.post("/snapshots", requireRoles(...admins), async (req: any, res, next) => {
  try { const body = z.object({ period: z.enum(["DAILY", "WEEKLY", "MONTHLY"]), start: z.coerce.date(), end: z.coerce.date() }).parse(req.body); if (body.end < body.start) throw new ApiError(400, "end must be after start"); res.json(await kpiService.snapshot(company(req), body.period, body.start, body.end)); } catch (e) { next(e); }
});
kpiRouter.post("/activity", requireRoles(...admins), async (req: any, res, next) => {
  try {
    const body = z.object({ employeeId: z.string().optional(), workDate: z.coerce.date(), activeMinutes: z.number().int().min(0).max(1440), idleMinutes: z.number().int().min(0).max(1440), breakMinutes: z.number().int().min(0).max(1440), firstActivityAt: z.coerce.date().optional(), lastActivityAt: z.coerce.date().optional(), validEntries: z.number().int().min(0).default(0), incorrectEntries: z.number().int().min(0).default(0), duplicateEntries: z.number().int().min(0).default(0), rejectedItems: z.number().int().min(0).default(0) }).parse(req.body);
    const employeeId = req.user.role === Role.SUPER_ADMIN || req.user.role === Role.HR_ADMIN || req.user.role === Role.MANAGER ? body.employeeId : await employeeForUser(req.user.id);
    if (!employeeId) throw new ApiError(400, "employeeId required for manager submission");
    res.status(201).json(await kpiService.activity(company(req), employeeId, body.workDate, { activeMinutes: body.activeMinutes, idleMinutes: body.idleMinutes, breakMinutes: body.breakMinutes, firstActivityAt: body.firstActivityAt, lastActivityAt: body.lastActivityAt, validEntries: body.validEntries, incorrectEntries: body.incorrectEntries, duplicateEntries: body.duplicateEntries, rejectedItems: body.rejectedItems }));
  } catch (e) { next(e); }
});
kpiRouter.post("/leave", requireRoles(...admins), async (req: any, res, next) => {
  try {
    const body = z.object({ employeeId: z.string(), startDate: z.coerce.date(), endDate: z.coerce.date(), status: z.enum(["APPROVED", "REJECTED", "PENDING"]), halfDay: z.boolean().default(false) }).parse(req.body);
    const companyId = company(req);
    await assertEmployeeScope(req, body.employeeId);
    if (body.endDate < body.startDate) throw new ApiError(400, "endDate must be on or after startDate");
    res.status(201).json(await prisma.kpiLeave.create({ data: { companyId, ...body } }));
  } catch (e) { next(e); }
});

// Internal STEMS activity ingestion: upstream event instrumentation calls this
// after aggregating meaningful work events and excluding idle/break intervals.
kpiRouter.post("/internal/activity", async (req: any, res, next) => {
  try {
    const internalKey = process.env.KPI_INGESTION_KEY;
    if (!internalKey || req.headers["x-kpi-ingestion-key"] !== internalKey) throw new ApiError(401, "Invalid activity ingestion credentials");
    const body = z.object({ companyId: z.string(), employeeId: z.string(), workDate: z.coerce.date(), activeMinutes: z.number().int().min(0).max(1440), idleMinutes: z.number().int().min(0).max(1440), breakMinutes: z.number().int().min(0).max(1440), firstActivityAt: z.coerce.date().optional(), lastActivityAt: z.coerce.date().optional(), validEntries: z.number().int().min(0).default(0), incorrectEntries: z.number().int().min(0).default(0), duplicateEntries: z.number().int().min(0).default(0), rejectedItems: z.number().int().min(0).default(0) }).parse(req.body);
    const { companyId, employeeId, workDate, ...data } = body;
    res.status(201).json(await kpiService.activity(companyId, employeeId, workDate, data));
  } catch (e) { next(e); }
});
