import { Role } from "@prisma/client";
import { startOfMonth } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import type { AuthUser } from "../../middleware/auth.js";

export const dashboardService = {
  async company(companyId: string) {
    const monthStart = startOfMonth(new Date());
    const [employees, pendingWfh, pendingExpenses, payrollRuns, attendanceToday] = await Promise.all([
      prisma.employee.count({ where: { companyId, status: "ACTIVE" } }),
      prisma.wFHRequest.count({ where: { employee: { companyId }, status: "PENDING" } }),
      prisma.expenseClaim.count({ where: { employee: { companyId }, OR: [{ managerStatus: "PENDING" }, { hrStatus: "PENDING" }] } }),
      prisma.payrollRun.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 6 }),
      prisma.attendance.count({ where: { employee: { companyId }, workDate: { gte: monthStart } } })
    ]);

    return {
      employees,
      pendingApprovals: pendingWfh + pendingExpenses,
      payrollRuns,
      attendancePunchesThisMonth: attendanceToday
    };
  },

  async forUser(user: AuthUser) {
    if (!user.companyId) {
      return { employees: 0, pendingApprovals: 0, payrollRuns: [], attendancePunchesThisMonth: 0 };
    }

    if (user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN) {
      return this.company(user.companyId);
    }

    const monthStart = startOfMonth(new Date());
    const employee = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!employee) {
      return { employees: 0, pendingApprovals: 0, payrollRuns: [], attendancePunchesThisMonth: 0 };
    }

    if (user.role === Role.MANAGER) {
      const [reports, pendingWfh, pendingExpenses, attendancePunches] = await Promise.all([
        prisma.employee.count({ where: { companyId: user.companyId, managerId: employee.id, status: "ACTIVE" } }),
        prisma.wFHRequest.count({ where: { employee: { managerId: employee.id }, status: "PENDING" } }),
        prisma.expenseClaim.count({ where: { employee: { managerId: employee.id }, managerStatus: "PENDING" } }),
        prisma.attendance.count({ where: { employee: { managerId: employee.id }, workDate: { gte: monthStart } } })
      ]);

      return {
        employees: reports,
        pendingApprovals: pendingWfh + pendingExpenses,
        payrollRuns: [],
        attendancePunchesThisMonth: attendancePunches
      };
    }

    const [pendingWfh, pendingExpenses, attendancePunches] = await Promise.all([
      prisma.wFHRequest.count({ where: { employeeId: employee.id, status: "PENDING" } }),
      prisma.expenseClaim.count({ where: { employeeId: employee.id, OR: [{ managerStatus: "PENDING" }, { hrStatus: "PENDING" }] } }),
      prisma.attendance.count({ where: { employeeId: employee.id, workDate: { gte: monthStart } } })
    ]);

    return {
      employees: 1,
      pendingApprovals: pendingWfh + pendingExpenses,
      payrollRuns: [],
      attendancePunchesThisMonth: attendancePunches
    };
  }
};
