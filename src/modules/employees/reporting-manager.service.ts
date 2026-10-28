import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { isActiveEmployee } from "../../lib/employment.js";
import { isCoreTeamEmployee } from "../../lib/coreTeam.js";
import { allowedCompanyIds } from "../org/company-access.service.js";
import type { AuthUser } from "../../middleware/auth.js";

const managerFields = {
  id: true, companyId: true, firstName: true, middleName: true, lastName: true,
  employeeCode: true, isCoreTeam: true, status: true, dateOfJoining: true, dateOfExit: true,
  department: { select: { name: true, code: true } },
  designation: { select: { title: true } },
  user: { select: { isActive: true, role: true } }
} as const;

export async function assertReportingManager(managerId: string, companyId: string) {
  const manager = await prisma.employee.findUnique({ where: { id: managerId }, select: managerFields });
  if (!manager || !isActiveEmployee(manager)) throw new ApiError(400, "Select an active reporting manager whose employment has started");
  if (manager.companyId !== companyId && !isCoreTeamEmployee(manager)) {
    throw new ApiError(400, "Reporting manager must belong to the employee's company or be a Core Team member");
  }
  return manager;
}

export async function reportingManagerOptions(user: AuthUser, companyId?: string) {
  const accessible = await allowedCompanyIds(user);
  if (companyId && !accessible.includes(companyId)) throw new ApiError(403, "You do not have access to this company");
  const targetCompanies = companyId ? [companyId] : accessible;
  const employees = await prisma.employee.findMany({ select: managerFields, orderBy: [{ firstName: "asc" }, { lastName: "asc" }] });
  // Core Team managers are shared across companies. Only expose fields needed by the selector.
  return employees.filter(employee => targetCompanies.length > 0 && isActiveEmployee(employee) &&
    (targetCompanies.includes(employee.companyId) || isCoreTeamEmployee(employee))).map(employee => ({
      id: employee.id, firstName: employee.firstName, middleName: employee.middleName,
      lastName: employee.lastName, employeeCode: employee.employeeCode,
      isCoreTeam: isCoreTeamEmployee(employee)
    }));
}
