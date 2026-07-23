import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { payrollService } from "./payroll.service.js";
import { prisma } from "../../lib/prisma.js";

export const payrollRouter = Router();
payrollRouter.use(requireAuth);

payrollRouter.get("/", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const draftRuns = await prisma.payrollRun.findMany({
      where: {
        companyId: req.user.companyId,
        status: { in: ["DRAFT", "DRAFT_FINAL"] }
      },
      select: { id: true }
    });

    for (const run of draftRuns) {
      await payrollService.recalculateDraftRun(req.user.companyId, run.id);
    }

    const runs = await prisma.payrollRun.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: "desc" },
      include: {
        payslips: {
          include: {
            employee: {
              include: {
                salary: true
              }
            }
          }
        }
      }
    });
    res.json(runs);
  } catch (error) {
    next(error);
  }
});

payrollRouter.post("/generate", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      month: z.number().min(1).max(12),
      year: z.number().min(2020),
      type: z.enum(["REGULAR", "FINAL"]).optional().default("REGULAR")
    }).parse(req.body);
    res.status(201).json(await payrollService.generate(req.user.companyId, req.user.id, body.month, body.year, body.type));
  } catch (error) {
    next(error);
  }
});

payrollRouter.patch("/:id/status", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({ status: z.enum(["DRAFT", "APPROVED", "PAID"]) }).parse(req.body);
    const run = await prisma.payrollRun.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId }
    });
    if (!run) throw new ApiError(404, "Payroll run not found");

    const newStatus = run.status.endsWith("_FINAL") ? `${body.status}_FINAL` : body.status;

    res.json(await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: newStatus },
      include: { payslips: { include: { employee: { include: { salary: true } } } } }
    }));
  } catch (error) {
    next(error);
  }
});

payrollRouter.patch("/payslips/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      payableDays: z.number().min(0),
      basic: z.number().min(0),
      allowances: z.number().min(0),
      deductions: z.number().min(0),
      gratuity: z.number().optional(),
      leaveEncashment: z.number().optional(),
      noticePay: z.number().optional()
    }).parse(req.body);

    const result = await payrollService.updatePayslip(req.user.companyId, req.params.id, body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

payrollRouter.delete("/payslips/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const result = await payrollService.skipPayslip(req.user.companyId, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

payrollRouter.post("/payslips/:id/send", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    res.json(await payrollService.sendPayslip(req.params.id));
  } catch (error) {
    next(error);
  }
});

payrollRouter.post("/runs/:id/send-all", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    res.json(await payrollService.sendAllPayslips(req.params.id));
  } catch (error) {
    next(error);
  }
});

payrollRouter.delete("/runs/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const runId = req.params.id;
    const run = await prisma.payrollRun.findFirst({
      where: req.user!.role === Role.SUPER_ADMIN ? { id: runId } : { id: runId, companyId: req.user!.companyId || undefined }
    });
    if (!run) throw new ApiError(404, "Payroll run not found");

    await prisma.$transaction([
      prisma.payslip.deleteMany({ where: { payrollRunId: runId } }),
      prisma.payrollRun.delete({ where: { id: runId } })
    ]);

    res.json({ message: "Payroll run deleted successfully" });
  } catch (error) {
    next(error);
  }
});
