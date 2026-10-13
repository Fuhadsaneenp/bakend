import { prisma } from "./prisma.js";
import { ApiError } from "./errors.js";
import { isActiveEmployee, employedDuring } from "./employment.js";
export async function assertActiveEmployee(employeeId: string, companyId?: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, ...(companyId ? { companyId } : {}) }, include: { user: { select: { isActive: true } } } });
  if (!employee || !isActiveEmployee(employee)) throw new ApiError(400, "Employee is not eligible for active workflows");
  return employee;
}
export async function assertEmployedDuring(employeeId: string, start: Date, end: Date) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || !employedDuring(employee, start, end)) throw new ApiError(400, "Employee was not employed during this period");
  return employee;
}

export function activeEmployeeWhere(at = new Date()) {
  const day = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at));
  return { status: "ACTIVE" as const, dateOfJoining: { lte: day }, user: { isActive: true }, OR: [{ dateOfExit: null }, { dateOfExit: { gte: day } }] };
}
