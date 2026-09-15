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
