import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { sources, dayKey } from "./hr-monitoring.engine.js";
import { collect, readSetting, writeSetting, assertEmployee } from "./hr-monitoring.service.js";
export const hrMonitoringRouter = Router();
hrMonitoringRouter.use(requireAuth, requireRoles(Role.SUPER_ADMIN));
hrMonitoringRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const version = z.string().datetime().nullable();
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const scoresSchema = z.record(z.string().min(1).max(100), z.number().min(0).max(100));
function company(req: any) { if (!req.user?.companyId) throw new ApiError(400, "Company context required"); return req.user.companyId as string; }
const asyncRoute = (handler: (req: any, res: any) => Promise<any>) => async (req: any, res: any, next: any) => { try { await handler(req, res); } catch (error) { next(error); } };
hrMonitoringRouter.get("/dashboard", asyncRoute(async (req, res) => {
  const today = dayKey(new Date());
  const query = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(today.slice(0, 8) + "01"), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(today) }).parse(req.query);
  res.json(await collect(company(req), query.from, query.to));
}));
hrMonitoringRouter.put("/departments/:id/kpis", asyncRoute(async (req, res) => {
  const companyId = company(req);
  const department = await prisma.department.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
  if (!department) throw new ApiError(404, "Department not found");
  const body = z.object({ version, metrics: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(150), weight: z.number().positive().max(100), source: z.enum(sources), calculation: z.enum(["task_completion", "deadline_adherence", "first_pass", "work_discipline", "active_time", "target_achievement", "custom"]), minimum: z.number().min(0).max(100).default(60) })).min(1).max(30) }).parse(req.body);
  if (Math.abs(body.metrics.reduce((sum, metric) => sum + metric.weight, 0) - 100) > 0.001) throw new ApiError(400, "KPI weights must total 100%");
  if (new Set(body.metrics.map(metric => metric.id)).size !== body.metrics.length) throw new ApiError(400, "Metric IDs must be unique");
  if (body.metrics.filter(metric => metric.calculation === "active_time" || metric.calculation === "work_discipline").reduce((sum, metric) => sum + metric.weight, 0) > 20) throw new ApiError(400, "Activity and work discipline may contribute at most 20%; prioritize output, quality and deadlines");
  res.json(await writeSetting(companyId, `template:${department.id}`, { departmentId: department.id, metrics: body.metrics }, body.version));
}));
hrMonitoringRouter.put("/bands", asyncRoute(async (req, res) => {
  const body = z.object({ version, bands: z.array(z.object({ minimum: z.number().min(0).max(100), label: z.string().trim().min(1).max(100) })).min(2).max(12) }).parse(req.body);
  if (!body.bands.some(band => band.minimum === 0) || new Set(body.bands.map(band => band.minimum)).size !== body.bands.length) throw new ApiError(400, "Bands need unique thresholds and a band starting at 0");
  res.json(await writeSetting(company(req), "bands", body.bands.sort((a, b) => b.minimum - a.minimum), body.version));
}));
hrMonitoringRouter.get("/employees/:id/inputs", asyncRoute(async (req, res) => {
  const companyId = company(req); await assertEmployee(companyId, req.params.id);
  const month = monthSchema.parse(req.query.month);
  res.json(await readSetting(companyId, `inputs:${req.params.id}:${month}`));
}));
hrMonitoringRouter.put("/employees/:id/inputs", asyncRoute(async (req, res) => {
  const companyId = company(req); const employee = await assertEmployee(companyId, req.params.id);
  const body = z.object({ version, month: monthSchema, scores: scoresSchema, notes: z.string().max(3000).default("") }).parse(req.body);
  const template = await readSetting(companyId, `template:${employee.departmentId}`);
  const inputIds = new Set((template.value?.metrics || []).filter((metric: any) => !["Manager review"].includes(metric.source) && (["custom", "active_time", "target_achievement"].includes(metric.calculation) || ["Manual entry", "External API"].includes(metric.source))).map((metric: any) => metric.id));
  if (Object.keys(body.scores).some(id => !inputIds.has(id))) throw new ApiError(400, "Only configured manual or imported metrics can be entered");
  res.json(await writeSetting(companyId, `inputs:${employee.id}:${body.month}`, { employeeId: employee.id, month: body.month, scores: body.scores, notes: body.notes, recordedBy: req.user.id, recordedAt: new Date().toISOString() }, body.version));
}));
hrMonitoringRouter.get("/employees/:id/review", asyncRoute(async (req, res) => {
  const companyId = company(req); await assertEmployee(companyId, req.params.id);
  res.json(await readSetting(companyId, `review:${req.params.id}:${monthSchema.parse(req.query.month)}`));
}));
hrMonitoringRouter.put("/employees/:id/review", asyncRoute(async (req, res) => {
  const companyId = company(req); const employee = await assertEmployee(companyId, req.params.id);
  const body = z.object({ version, month: monthSchema, ratings: scoresSchema.refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 30, "Add between 1 and 30 review categories"), remarks: z.string().max(5000).default("") }).parse(req.body);
  res.json(await writeSetting(companyId, `review:${employee.id}:${body.month}`, { employeeId: employee.id, reportingManagerId: employee.managerId, month: body.month, ratings: body.ratings, remarks: body.remarks, reviewedBy: req.user.id, reviewerRole: "SUPER_ADMIN", reviewedAt: new Date().toISOString() }, body.version));
}));
hrMonitoringRouter.post("/employees/:id/snapshots", asyncRoute(async (req, res) => {
  const companyId = company(req); await assertEmployee(companyId, req.params.id);
  const month = monthSchema.parse(req.body.month);
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  if (dayKey(new Date()) <= `${month}-${String(lastDay).padStart(2, "0")}`) throw new ApiError(400, "Only completed months can be finalized; current month stays a preview");
  const data = await collect(companyId, `${month}-01`, `${month}-${String(lastDay).padStart(2, "0")}`);
  const employee = data.employees.find(row => row.id === req.params.id)!;
  if (employee.kpi.score === null) throw new ApiError(400, "Configure department KPIs and supply all required scores before finalizing");
  const id = randomUUID();
  const snapshot = { id, employeeId: employee.id, departmentId: employee.department?.id || null, month, score: employee.kpi.score, label: employee.kpi.label, metrics: employee.kpi.metrics, template: employee.template, bands: data.bands, taskStats: employee.stats, review: employee.reviews.find(review => review.month === month) || null, createdAt: new Date().toISOString(), createdBy: req.user.id };
  await writeSetting(companyId, `snapshot:${employee.id}:${month}:${id}`, snapshot, null);
  res.status(201).json(snapshot);
}));
