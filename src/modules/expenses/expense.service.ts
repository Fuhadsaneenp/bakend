import { ApprovalStatus, ExpenseCategory, ReimbursementStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../lib/errors.js";
import { notificationService } from "../notifications/notification.service.js";

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

  list(companyId: string) {
    return prisma.expenseClaim.findMany({
      where: { employee: { companyId } },
      include: { employee: true },
      orderBy: { createdAt: "desc" }
    });
  },

  async managerReview(id: string, status: ApprovalStatus) {
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
