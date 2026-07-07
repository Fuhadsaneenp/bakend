import { startOfMonth } from "date-fns";
import { prisma } from "../../lib/prisma.js";

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
  }
};
