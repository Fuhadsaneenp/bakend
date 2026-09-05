import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAnyPermission, requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { payrollService } from "./payroll.service.js";
import { prisma } from "../../lib/prisma.js";

export const payrollRouter = Router();
payrollRouter.use(requireAuth);

async function resolvePayrollCompanyId(req: any, requestedCompanyId?: string) {
  const isFullAdmin = req.user?.role === Role.SUPER_ADMIN || req.user?.role === Role.HR_ADMIN;
  let companyId: string | undefined;

  if (isFullAdmin) {
    companyId = requestedCompanyId || req.user?.companyId;
  } else {
    companyId = req.user?.companyId;
    if (!companyId && req.user?.id) {
      const emp = await prisma.employee.findFirst({ where: { userId: req.user.id }, select: { companyId: true } });
      if (emp?.companyId) companyId = emp.companyId;
    }
    if (!companyId && req.user?.email) {
      const empByEmail = await prisma.employee.findFirst({ where: { user: { email: req.user.email } }, select: { companyId: true } });
      if (empByEmail?.companyId) companyId = empByEmail.companyId;
    }
  }

  if (!companyId) {
    const firstCompany = await prisma.company.findFirst({ select: { id: true } });
    if (firstCompany) companyId = firstCompany.id;
  }
  if (!companyId) throw new ApiError(400, "Company context required");

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw new ApiError(404, "Company not found");

  return company.id;
}

payrollRouter.get("/", requireAnyPermission(["payroll.run.view", "payroll.run.process", "payroll.run.approve"]), async (req, res, next) => {
  try {
    const requestedCompanyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    const companyId = await resolvePayrollCompanyId(req, requestedCompanyId);
    const draftRuns = await prisma.payrollRun.findMany({
      where: {
        companyId,
        status: { in: ["DRAFT", "DRAFT_FINAL"] }
      },
      select: { id: true }
    });

    for (const run of draftRuns) {
      await payrollService.recalculateDraftRun(companyId, run.id);
    }

    const runs = await prisma.payrollRun.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: {
        company: true,
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

payrollRouter.post("/generate", requireAnyPermission(["payroll.run.process", "payroll.run.approve"]), async (req, res, next) => {
  try {
    if (!req.user) throw new ApiError(401, "Unauthenticated");
    const body = z.object({
      companyId: z.string().optional(),
      month: z.number().min(1).max(12),
      year: z.number().min(2020),
      type: z.enum(["REGULAR", "FINAL"]).optional().default("REGULAR")
    }).parse(req.body);
    const companyId = await resolvePayrollCompanyId(req, body.companyId);
    res.status(201).json(await payrollService.generate(companyId, req.user.id, body.month, body.year, body.type));
  } catch (error) {
    next(error);
  }
});

payrollRouter.patch("/:id/status", requireAnyPermission(["payroll.run.process", "payroll.run.approve"]), async (req, res, next) => {
  try {
    const hasFullAdmin = req.user!.role === Role.SUPER_ADMIN || req.user!.role === Role.HR_ADMIN;
    const body = z.object({ status: z.enum(["DRAFT", "APPROVED", "PAID"]) }).parse(req.body);
    const companyId = await resolvePayrollCompanyId(req);
    const run = await prisma.payrollRun.findFirst({
      where: hasFullAdmin ? { id: req.params.id } : { id: req.params.id, companyId }
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

payrollRouter.patch("/payslips/:id", requireAnyPermission(["payroll.run.process", "payroll.run.approve"]), async (req, res, next) => {
  try {
    const payslip = await prisma.payslip.findUnique({ where: { id: req.params.id }, include: { payrollRun: true } });
    if (!payslip) throw new ApiError(404, "Payslip not found");

    const body = z.object({
      payableDays: z.number().min(0),
      basic: z.number().min(0),
      allowances: z.number().min(0),
      deductions: z.number().min(0),
      gratuity: z.number().optional(),
      leaveEncashment: z.number().optional(),
      noticePay: z.number().optional()
    }).parse(req.body);

    const result = await payrollService.updatePayslip(payslip.payrollRun.companyId, req.params.id, body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

payrollRouter.delete("/payslips/:id", requireAnyPermission(["payroll.run.process", "payroll.run.approve"]), async (req, res, next) => {
  try {
    const payslip = await prisma.payslip.findUnique({ where: { id: req.params.id }, include: { payrollRun: true } });
    if (!payslip) throw new ApiError(404, "Payslip not found");

    const result = await payrollService.skipPayslip(payslip.payrollRun.companyId, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

payrollRouter.post("/payslips/:id/send", requireAnyPermission(["payroll.run.process", "payroll.run.approve"]), async (req, res, next) => {
  try {
    res.json(await payrollService.sendPayslip(req.params.id));
  } catch (error) {
    next(error);
  }
});

payrollRouter.post("/runs/:id/send-all", requireAnyPermission(["payroll.run.process", "payroll.run.approve"]), async (req, res, next) => {
  try {
    res.json(await payrollService.sendAllPayslips(req.params.id));
  } catch (error) {
    next(error);
  }
});

payrollRouter.delete("/runs/:id", requireAnyPermission(["payroll.run.process", "payroll.run.approve"]), async (req, res, next) => {
  try {
    const runId = req.params.id;
    const hasFullAdmin = req.user!.role === Role.SUPER_ADMIN || req.user!.role === Role.HR_ADMIN;
    const companyId = await resolvePayrollCompanyId(req);
    const run = await prisma.payrollRun.findFirst({
      where: hasFullAdmin ? { id: runId } : { id: runId, companyId }
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
