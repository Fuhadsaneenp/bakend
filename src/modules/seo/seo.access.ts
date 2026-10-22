import { isSeoCrmClient } from "./seo.clients.js";
import type { AuthUser } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { permissionService } from "../authority/permission.service.js";
export const admin = (u: AuthUser) =>
  ["SUPER_ADMIN", "HR_ADMIN"].includes(u.role);
export function company(u: AuthUser) {
  if (!u.companyId) throw new ApiError(400, "Company context required");
  return u.companyId;
}
export async function scope(
  u: AuthUser,
  workspaceId: string,
  permission = "seo.report.view",
  review = false,
) {
  const workspace = await prisma.seoWorkspace.findFirst({
    where: { id: workspaceId, companyId: company(u) },
    include: {
      client: true,
      members: true,
      property: { include: { connection: { select: { status: true } } } },
    },
  });
  if (!workspace) throw new ApiError(404, "SEO client not found");
  if (!(await isSeoCrmClient(company(u), workspace.client.name)))
    throw new ApiError(404, "Client is not assigned an SEO service in CRM");
  const employee = await prisma.employee.findFirst({
    where: { userId: u.id, companyId: company(u) },
    select: { id: true },
  });
  const member = workspace.members.find((m) => m.employeeId === employee?.id);
  if (!admin(u)) {
    if (!member) throw new ApiError(403, "Client assignment required");
    await permissionService.requirePermission(u.id, permission, {
      companyId: company(u),
      clientId: workspace.clientId,
      employeeId: employee?.id,
      assignedToEmployeeId: employee?.id,
    });
    if (review && member.role !== "HEAD")
      throw new ApiError(403, "SEO head required");
  }
  return {
    workspace,
    employeeId: employee?.id,
    manager: admin(u) || member?.role === "HEAD",
  };
}
export async function employeeAssigned(
  workspaceId: string,
  employeeId: string,
  companyId: string,
) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId, status: "ACTIVE", dateOfExit: null },
  });
  const member = await prisma.seoMember.findUnique({
    where: { workspaceId_employeeId: { workspaceId, employeeId } },
  });
  if (!employee || !member)
    throw new ApiError(
      400,
      "Employee must be active and assigned to this client",
    );
}
