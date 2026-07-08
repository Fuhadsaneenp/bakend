import { ApprovalStatus, ExpenseCategory, ReimbursementStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";
import { notificationService } from "../notifications/notification.service.js";
import type { AuthUser } from "../../middleware/auth.js";

export const expenseService = {
  async submit(userId: string, data: { category: ExpenseCategory; amount: number; currency?: string; description: string; receiptKey?: string }) {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw notFound("Employee");
    return prisma.expenseClaim.create({
      data: {
        employeeId: employee.id,
        category: data.category,
        amount: data.amount,
        currency: data.currency ?? employee.baseCurrency,
        description: data.description,
        receiptKey: data.receiptKey
      }
    });
  },

  async listForUser(user: AuthUser) {
    if (!user.companyId) return [];

    if (user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN) {
      return prisma.expenseClaim.findMany({
        where: { employee: { companyId: user.companyId } },
        include: { employee: true },
        orderBy: { createdAt: "desc" }
      });
    }

    const employee = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!employee) return [];

    if (user.role === Role.MANAGER) {
      return prisma.expenseClaim.findMany({
        where: { employee: { managerId: employee.id } },
        include: { employee: true },
        orderBy: { createdAt: "desc" }
      });
    }

    return prisma.expenseClaim.findMany({
      where: { employeeId: employee.id },
      include: { employee: true },
      orderBy: { createdAt: "desc" }
    });
  },

  async managerReview(id: string, reviewer: AuthUser, status: ApprovalStatus) {
    if (reviewer.role === Role.MANAGER) {
      const manager = await prisma.employee.findUnique({ where: { userId: reviewer.id } });
      const claim = await prisma.expenseClaim.findUnique({ where: { id }, include: { employee: true } });
      if (!manager || !claim || claim.employee.managerId !== manager.id) {
        throw new ApiError(403, "Managers can only review direct-report claims");
      }
    }

    const claim = await prisma.expenseClaim.update({ where: { id }, data: { managerStatus: status }, include: { employee: true } });
    await notificationService.inApp(claim.employee.userId, `Expense ${status.toLowerCase()}`, `Your manager ${status.toLowerCase()} an expense claim.`);
    return claim;
  },

  async hrReview(id: string, status: ApprovalStatus, reimbursementStatus?: ReimbursementStatus) {
    const claim = await prisma.expenseClaim.update({
      where: { id },
      data: { hrStatus: status, reimbursementStatus: reimbursementStatus ?? (status === ApprovalStatus.APPROVED ? ReimbursementStatus.READY : ReimbursementStatus.NOT_READY) },
      include: { employee: true }
    });
    await notificationService.inApp(claim.employee.userId, `Expense ${status.toLowerCase()}`, `HR ${status.toLowerCase()} an expense claim.`);
    return claim;
  }
};
