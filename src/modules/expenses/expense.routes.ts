import { ApprovalStatus, ExpenseCategory, ReimbursementStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { expenseService } from "./expense.service.js";

export const expenseRouter = Router();
expenseRouter.use(requireAuth);

expenseRouter.post("/submit", async (req, res, next) => {
  try {
    const body = z.object({
      category: z.nativeEnum(ExpenseCategory),
      amount: z.number().positive(),
      currency: z.string().length(3).optional(),
      description: z.string().min(5),
      receiptKey: z.string().optional()
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
