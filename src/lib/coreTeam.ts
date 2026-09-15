import { Role } from "@prisma/client";
import { prisma } from "./prisma.js";
import type { AuthUser } from "../middleware/auth.js";

export function isCoreTeamEmployee(employee?: {
  isCoreTeam?: boolean | null;
  department?: { name?: string | null; code?: string | null } | null;
  designation?: { title?: string | null } | null;
  user?: { role?: Role | string | null } | null;
} | null): boolean {
  if (!employee) return false;
  if (employee.isCoreTeam) return true;
  if (employee.user?.role === Role.SUPER_ADMIN) return true;

  const deptName = employee.department?.name?.toLowerCase() || "";
  const deptCode = employee.department?.code?.toLowerCase() || "";
  const title = employee.designation?.title?.toLowerCase() || "";

  return (
    deptCode === "root" ||
    deptCode === "core" ||
    deptName.includes("core team") ||
    title.includes("core team")
  );
}

export async function isRequesterCoreTeam(user: AuthUser): Promise<boolean> {
  if (user.role === Role.SUPER_ADMIN) return true;

  const emp = await prisma.employee.findUnique({
    where: { userId: user.id },
    include: {
      department: true,
      designation: true,
      user: true
    }
  });

  return isCoreTeamEmployee(emp);
}

export function isHrEmployee(employee?: {
  isHrHead?: boolean | null;
  department?: { name?: string | null; code?: string | null } | null;
  designation?: { title?: string | null } | null;
  user?: { role?: Role | string | null } | null;
} | null): boolean {
  if (!employee) return false;
  if (employee.isHrHead) return true;
  if (employee.user?.role === Role.SUPER_ADMIN || employee.user?.role === Role.HR_ADMIN) return true;

  const deptName = employee.department?.name?.toLowerCase() || "";
  const deptCode = employee.department?.code?.toLowerCase() || "";
  const title = employee.designation?.title?.toLowerCase() || "";

  return (
    deptName === "hr" ||
    deptName.includes("human resource") ||
    deptName.startsWith("hr ") ||
    deptName.endsWith(" hr") ||
    deptName.includes(" hr ") ||
    deptCode.includes("hr") ||
    title === "hr" ||
    title.startsWith("hr ") ||
    title.endsWith(" hr") ||
    title.includes(" hr ") ||
    title.includes("hr executive") ||
    title.includes("hr manager") ||
    title.includes("human resource")
  );
}

export async function isRequesterHr(user: AuthUser): Promise<boolean> {
  if (user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN) return true;

  const emp = await prisma.employee.findUnique({
    where: { userId: user.id },
    include: {
      department: true,
      designation: true,
      user: true
    }
  });

  return isHrEmployee(emp);
}
