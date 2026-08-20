import { ApprovalStatus, ExpenseCategory, ReimbursementStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { expenseService } from "./expense.service.js";
import { advanceService } from "./advance.service.js";
import { prisma } from "../../lib/prisma.js";

export const expenseRouter = Router();
expenseRouter.use(requireAuth);

expenseRouter.post("/submit", async (req: any, res, next) => {
  try {
    const body = z.object({
      category: z.nativeEnum(ExpenseCategory),
      amount: z.number().positive(),
      currency: z.string().length(3).optional(),
      description: z.string().min(5),
      receiptKey: z.string().optional(),
      advanceId: z.string().optional()
    }).parse(req.body);
    res.status(201).json(await expenseService.submit(req.user!.id, body));
  } catch (error) {
    next(error);
  }
});

expenseRouter.get("/", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await expenseService.listForUser(req.user));
  } catch (error) {
    next(error);
  }
});

expenseRouter.patch("/:id/manager-review", requireRoles(Role.MANAGER, Role.HR_ADMIN, Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED]) }).parse(req.body);
    res.json(await expenseService.managerReview(req.params.id, req.user!, body.status));
  } catch (error) {
    next(error);
  }
});

expenseRouter.patch("/:id/hr-review", requireRoles(Role.HR_ADMIN, Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({
      status: z.enum([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED]),
      reimbursementStatus: z.nativeEnum(ReimbursementStatus).optional()
    }).parse(req.body);
    res.json(await expenseService.hrReview(req.params.id, body.status, body.reimbursementStatus));
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Advances Endpoints
// -------------------------------------------------------------
expenseRouter.get("/advances", async (req: any, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    
    if (req.user.role === Role.SUPER_ADMIN || req.user.role === Role.HR_ADMIN) {
      const advances = await advanceService.getCompanyAdvances(req.user.companyId);
      return res.json(advances);
    }

    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) throw new ApiError(404, "Employee profile not found");

    if (req.user.role === Role.MANAGER) {
      // Return advances for direct reports plus manager's own advances
      const companyAdvances = await advanceService.getCompanyAdvances(req.user.companyId);
      const filtered = companyAdvances.filter(a => a.employeeId === employee.id || a.employee.managerId === employee.id);
      return res.json(filtered);
    }

    const advances = await advanceService.getEmployeeAdvances(employee.id);
    res.json(advances);
  } catch (error) {
    next(error);
  }
});

expenseRouter.post("/advances", async (req: any, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) throw new ApiError(404, "Employee profile not found");

    const body = z.object({
      purpose: z.string().min(5),
      amount: z.number().positive(),
      currency: z.string().length(3).optional()
    }).parse(req.body);

    const advance = await advanceService.createAdvanceRequest(employee.id, body.purpose, body.amount, body.currency);
    res.status(201).json(advance);
  } catch (error) {
    next(error);
  }
});

expenseRouter.patch("/advances/:id/status", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req: any, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");

    const body = z.object({
      managerStatus: z.nativeEnum(ApprovalStatus).optional(),
      hrStatus: z.nativeEnum(ApprovalStatus).optional(),
      status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAID", "SETTLED"]).optional()
    }).parse(req.body);

    const updated = await advanceService.updateAdvanceStatus(req.params.id, req.user.companyId, body);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});
