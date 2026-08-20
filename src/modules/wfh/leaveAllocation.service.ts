import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { differenceInDays } from "date-fns";

export const leaveAllocationService = {
  async createOrUpdateAllocation(employeeId: string, leaveType: string, year: number, maxDays: number) {
    return prisma.leaveAllocation.upsert({
      where: {
        employeeId_leaveType_year: {
          employeeId,
          leaveType,
          year
        }
      },
      update: {
        maxDays
      },
      create: {
        employeeId,
        leaveType,
        year,
        maxDays,
        usedDays: 0.00
      }
    });
  },

  async getEmployeeAllocations(employeeId: string) {
    return prisma.leaveAllocation.findMany({
      where: { employeeId },
      orderBy: { year: "desc" }
    });
  },

  async getCompanyAllocations(companyId: string) {
    return prisma.leaveAllocation.findMany({
      where: {
        employee: { companyId }
      },
      include: { employee: true },
      orderBy: [{ year: "desc" }, { leaveType: "asc" }]
    });
  },

  // Helper validation
  async validateLeaveBalance(employeeId: string, leaveType: string, startDate: Date, endDate: Date) {
    const requestedDays = differenceInDays(new Date(endDate), new Date(startDate)) + 1;
    const year = new Date(startDate).getFullYear();

    const allocation = await prisma.leaveAllocation.findUnique({
      where: {
        employeeId_leaveType_year: {
          employeeId,
          leaveType,
          year
        }
      }
    });

    if (!allocation) {
      throw new ApiError(400, `No leave allocation set up for '${leaveType}' in year ${year}.`);
    }

    const remaining = Number(allocation.maxDays) - Number(allocation.usedDays);
    if (requestedDays > remaining) {
      throw new ApiError(
        400,
        `Insufficient leave balance for '${leaveType}'. Remaining: ${remaining} days. Requested: ${requestedDays} days.`
      );
    }

    return { allocation, requestedDays };
  },

  async recordLeaveUsage(employeeId: string, leaveType: string, startDate: Date, endDate: Date, isDeduct: boolean) {
    const requestedDays = differenceInDays(new Date(endDate), new Date(startDate)) + 1;
    const year = new Date(startDate).getFullYear();

    const allocation = await prisma.leaveAllocation.findUnique({
      where: {
        employeeId_leaveType_year: {
          employeeId,
          leaveType,
          year
        }
      }
    });

    if (!allocation) return;

    const change = isDeduct ? requestedDays : -requestedDays;
    const nextUsedDays = Math.max(0, Number(allocation.usedDays) + change);

    await prisma.leaveAllocation.update({
      where: { id: allocation.id },
      data: { usedDays: nextUsedDays }
    });
  }
};
