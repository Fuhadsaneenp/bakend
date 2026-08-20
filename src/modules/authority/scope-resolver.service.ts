import { AccessScopeType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { AccessContext, EffectivePermission } from "./access-resolver.service.js";

type ScopeCheckInput = {
  companyId?: string | null;
  employeeId?: string | null;
  departmentId?: string | null;
  officeId?: string | null;
  clientId?: string | null;
  assignedToEmployeeId?: string | null;
  createdByEmployeeId?: string | null;
};

async function matchesScope(
  actor: AccessContext,
  permission: EffectivePermission,
  input: ScopeCheckInput
) {
  if (actor.user.role === "SUPER_ADMIN") return true;
  if (!permission.scopes.length) return permission.allowed;

  for (const scope of permission.scopes) {
    switch (scope.type) {
      case AccessScopeType.GLOBAL:
        return true;
      case AccessScopeType.COMPANY:
        if (!input.companyId || input.companyId === actor.user.companyId) return true;
        break;
      case AccessScopeType.SELF:
        if (!input.employeeId || input.employeeId === actor.employee?.id) return true;
        break;
      case AccessScopeType.DIRECT_REPORTS:
        if (input.employeeId) {
          const target = await prisma.employee.findUnique({
            where: { id: input.employeeId },
            select: { managerId: true }
          });
          if (target?.managerId === actor.employee?.id) return true;
        }
        break;
      case AccessScopeType.DEPARTMENT:
        if (input.departmentId && input.departmentId === actor.employee?.departmentId) return true;
        break;
      case AccessScopeType.TEAM:
        if (scope.refId) {
          const membership = await prisma.teamMember.findFirst({
            where: {
              teamId: scope.refId,
              employeeId: actor.employee?.id || ""
            }
          });
          if (membership) return true;
        }
        break;
      case AccessScopeType.OFFICE:
        if (input.officeId && input.officeId === actor.employee?.officeId) return true;
        break;
      case AccessScopeType.CLIENT:
        if (scope.refId && input.clientId && scope.refId === input.clientId) return true;
        break;
      case AccessScopeType.PROJECT:
        if (scope.refId && input.clientId && scope.refId === input.clientId) return true;
        break;
      case AccessScopeType.ASSIGNED_CLIENTS:
        if (input.clientId && actor.employee?.id) {
          const client = await prisma.client.findUnique({
            where: { id: input.clientId },
            select: { accountManagerId: true }
          });
          if (client?.accountManagerId === actor.employee.id) return true;
        }
        break;
      case AccessScopeType.ASSIGNED_PROJECTS:
        break;
      case AccessScopeType.ASSIGNED_TO_ME:
        if (input.assignedToEmployeeId && input.assignedToEmployeeId === actor.employee?.id) return true;
        break;
      case AccessScopeType.CREATED_BY_ME:
        if (input.createdByEmployeeId && input.createdByEmployeeId === actor.employee?.id) return true;
        break;
      default:
        break;
    }
  }

  return false;
}

export const scopeResolverService = {
  async canAccess(
    actor: AccessContext,
    permissionCode: string,
    input: ScopeCheckInput
  ) {
    const permission = actor.permissionMap.get(permissionCode);
    if (!permission?.allowed) return false;
    return matchesScope(actor, permission, input);
  }
};
