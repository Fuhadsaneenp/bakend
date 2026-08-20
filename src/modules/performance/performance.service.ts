import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

export const performanceService = {
  // Appraisal Cycle
  async createAppraisalCycle(companyId: string, title: string, startDate: Date, endDate: Date) {
    return prisma.appraisalCycle.create({
      data: {
        companyId,
        title,
        startDate,
        endDate,
        status: "DRAFT"
      }
    });
  },

  async getAppraisalCycles(companyId: string) {
    return prisma.appraisalCycle.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      include: {
        appraisals: {
          include: {
            employee: true
          }
        }
      }
    });
  },

  async updateAppraisalCycleStatus(companyId: string, cycleId: string, status: string) {
    const cycle = await prisma.appraisalCycle.findFirst({
      where: { id: cycleId, companyId }
    });
    if (!cycle) throw new ApiError(404, "Appraisal Cycle not found");

    return prisma.appraisalCycle.update({
      where: { id: cycleId },
      data: { status }
    });
  },

  // Key Result Areas (KRAs)
  async createKRA(employeeId: string, title: string, weightage: number, description?: string) {
    return prisma.kRA.create({
      data: {
        employeeId,
        title,
        weightage,
        description
      }
    });
  },

  async getEmployeeKRAs(employeeId: string) {
    return prisma.kRA.findMany({
      where: { employeeId },
      orderBy: { createdAt: "desc" }
    });
  },

  async deleteKRA(employeeId: string, kraId: string) {
    const kra = await prisma.kRA.findFirst({
      where: { id: kraId, employeeId }
    });
    if (!kra) throw new ApiError(404, "KRA not found");

    return prisma.kRA.delete({
      where: { id: kraId }
    });
  },

  // Goals
  async createGoal(
    employeeId: string,
    title: string,
    target: number,
    startDate: Date,
    endDate: Date,
    description?: string,
    kraId?: string
  ) {
    return prisma.goal.create({
      data: {
        employeeId,
        title,
        target,
        startDate,
        endDate,
        description,
        kraId,
        status: "PENDING"
      }
    });
  },

  async getEmployeeGoals(employeeId: string) {
    return prisma.goal.findMany({
      where: { employeeId },
      include: { kra: true },
      orderBy: { createdAt: "desc" }
    });
  },

  async updateGoalProgress(employeeId: string, goalId: string, achieved: number, status: string) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, employeeId }
    });
    if (!goal) throw new ApiError(404, "Goal not found");

    return prisma.goal.update({
      where: { id: goalId },
      data: { achieved, status }
    });
  },

  async deleteGoal(employeeId: string, goalId: string) {
    const goal = await prisma.goal.findFirst({
      where: { id: goalId, employeeId }
    });
    if (!goal) throw new ApiError(404, "Goal not found");

    return prisma.goal.delete({
      where: { id: goalId }
    });
  },

  // Appraisals
  async createAppraisal(companyId: string, employeeId: string, appraisalCycleId: string, selfScore?: number, selfFeedback?: string) {
    const existing = await prisma.appraisal.findFirst({
      where: { employeeId, appraisalCycleId }
    });

    if (existing) {
      return prisma.appraisal.update({
        where: { id: existing.id },
        data: {
          status: "SUBMITTED",
          selfScore,
          selfFeedback
        }
      });
    }

    return prisma.appraisal.create({
      data: {
        companyId,
        employeeId,
        appraisalCycleId,
        selfScore,
        selfFeedback,
        status: "SUBMITTED"
      }
    });
  },

  async getEmployeeAppraisals(employeeId: string) {
    return prisma.appraisal.findMany({
      where: { employeeId },
      include: {
        appraisalCycle: true,
        approvedBy: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getCycleAppraisals(companyId: string, cycleId: string) {
    return prisma.appraisal.findMany({
      where: { companyId, appraisalCycleId: cycleId },
      include: {
        employee: true,
        appraisalCycle: true,
        approvedBy: true
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async reviewAppraisal(companyId: string, appraisalId: string, managerScore: number, managerFeedback?: string) {
    const appraisal = await prisma.appraisal.findFirst({
      where: { id: appraisalId, companyId }
    });
    if (!appraisal) throw new ApiError(404, "Appraisal not found");

    return prisma.appraisal.update({
      where: { id: appraisalId },
      data: {
        managerScore,
        managerFeedback,
        status: "REVIEWED"
      }
    });
  },

  async approveAppraisal(companyId: string, appraisalId: string, finalScore: number, approvedById: string) {
    const appraisal = await prisma.appraisal.findFirst({
      where: { id: appraisalId, companyId }
    });
    if (!appraisal) throw new ApiError(404, "Appraisal not found");

    return prisma.appraisal.update({
      where: { id: appraisalId },
      data: {
        finalScore,
        approvedById,
        status: "APPROVED"
      }
    });
  }
};
