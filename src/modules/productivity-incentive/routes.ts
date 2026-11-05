import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { daySchema, policySchema } from "./domain.js";
import { context, reconcile, report, review, savePolicy, verify } from "./service.js";

export const productivityIncentiveRouter = Router();
productivityIncentiveRouter.use(requireAuth);
productivityIncentiveRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const filters = z.object({ month: monthSchema, day: daySchema.optional(), employeeId: z.string().optional() }).refine(v => !v.day || v.day.startsWith(v.month), "Daily filter must be inside the selected month");
productivityIncentiveRouter.get("/report", async (req, res, next) => {
  try { const q = filters.parse(req.query); res.json(await report(req.user!, q.month, q.day, q.employeeId)); } catch (e) { next(e); }
});
productivityIncentiveRouter.post("/sync", async (req, res, next) => {
  try {
    const { month, recalculate, reason } = z.object({ month: monthSchema, recalculate: z.boolean().default(false), reason: z.string().trim().max(1000).optional() }).parse(req.body);
    const ctx = await context(req.user!);
    if (recalculate && (!ctx.admin || !reason)) throw new ApiError(403, "Historical recalculation requires an administrator and a reason");
    if (recalculate) await prisma.incentiveAudit.create({ data: { companyId: ctx.company.id, actorId: req.user!.id, action: "RECALCULATION_REQUESTED", detail: { month, reason } } });
    res.json(await reconcile(ctx.company.id, month, req.user!.id, recalculate));
  } catch (e) { next(e); }
});
productivityIncentiveRouter.use(async (req, _res, next) => {
  try { if (!(await context(req.user!)).admin) throw new ApiError(403, "Incentive administration requires HR Admin or Super Admin"); next(); } catch (e) { next(e); }
});
productivityIncentiveRouter.post("/policies", async (req, res, next) => {
  try { const { effectiveFrom, config } = z.object({ effectiveFrom: daySchema, config: policySchema }).parse(req.body); const ctx = await context(req.user!); res.status(201).json(await savePolicy(ctx.company.id, req.user!.id, effectiveFrom, config)); } catch (e) { next(e); }
});
productivityIncentiveRouter.post("/credits/:id/verify", async (req, res, next) => {
  try {
    const { revision, ...interval } = z.object({ revision: z.number().int().positive(), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), evidence: z.string().trim().min(5).max(1000) }).parse(req.body);
    const ctx = await context(req.user!); await verify(ctx.company.id, req.params.id, revision, req.user!.id, interval); res.json({ verified: true });
  } catch (e) { next(e); }
});
productivityIncentiveRouter.post("/credits/:id/review", async (req, res, next) => {
  try {
    const body = z.object({ revision: z.number().int().positive(), action: z.enum(["APPROVE", "REJECT", "REOPEN"]), reason: z.string().trim().min(3).max(1000) }).parse(req.body);
    const ctx = await context(req.user!);
    const row = await prisma.incentiveCredit.findFirst({ where: { id: req.params.id, companyId: ctx.company.id }, select: { month: true } });
    if (!row) throw new ApiError(404, "Credit not found");
    await reconcile(ctx.company.id, row.month, req.user!.id);
    const result = await review(ctx.company.id, req.params.id, body.revision, req.user!.id, body.action, body.reason);
    if (body.action === "REOPEN") await reconcile(ctx.company.id, row.month, req.user!.id);
    res.json(result);
  } catch (e) { next(e); }
});
