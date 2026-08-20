import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { ApprovalStatus } from "@prisma/client";

export const advanceService = {
  async createAdvanceRequest(employeeId: string, purpose: string, amount: number, currency = "INR") {
    return prisma.employeeAdvance.create({
      data: {
        employeeId,
        purpose,
        amount,
        currency,
        status: "PENDING",
        managerStatus: "PENDING",
        hrStatus: "PENDING",
        claimedAmount: 0.00
      }
    });
  },

  async getEmployeeAdvances(employeeId: string) {
    return prisma.employeeAdvance.findMany({
      where: { employeeId },
      include: { expenseClaims: true },
      orderBy: { createdAt: "desc" }
    });
  },

  async getCompanyAdvances(companyId: string) {
    return prisma.employeeAdvance.findMany({
      where: {
        employee: { companyId }
      },
      include: {
        employee: true,
        expenseClaims: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async updateAdvanceStatus(
    advanceId: string,
    companyId: string,
    updates: { managerStatus?: ApprovalStatus; hrStatus?: ApprovalStatus; status?: string }
  ) {
    const advance = await prisma.employeeAdvance.findFirst({
      where: { id: advanceId, employee: { companyId } }
    });
    if (!advance) throw new ApiError(404, "Advance request not found");

    const data: any = {};
    if (updates.managerStatus) data.managerStatus = updates.managerStatus;
    if (updates.hrStatus) data.hrStatus = updates.hrStatus;
    if (updates.status) data.status = updates.status;

    // Check auto approval flow
    const nextManagerStatus = updates.managerStatus || advance.managerStatus;
    const nextHrStatus = updates.hrStatus || advance.hrStatus;

    if (nextManagerStatus === "REJECTED" || nextHrStatus === "REJECTED") {
      data.status = "REJECTED";
    } else if (nextManagerStatus === "APPROVED" && nextHrStatus === "APPROVED" && !updates.status) {
      data.status = "APPROVED";
    }

    return prisma.employeeAdvance.update({
      where: { id: advanceId },
      data,
      include: { employee: true }
    });
  },

  async linkExpenseClaimToAdvance(advanceId: string, amount: number) {
    const advance = await prisma.employeeAdvance.findUnique({
      where: { id: advanceId }
    });
    if (!advance) return;

    const nextClaimedAmount = Number(advance.claimedAmount) + amount;
    const status = nextClaimedAmount >= Number(advance.amount) ? "SETTLED" : advance.status;

    await prisma.employeeAdvance.update({
      where: { id: advanceId },
      data: {
        claimedAmount: nextClaimedAmount,
        status
      }
    });
  }
};
