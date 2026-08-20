import { ApiError } from "../../lib/errors.js";
import { accessResolverService } from "./access-resolver.service.js";
import { scopeResolverService } from "./scope-resolver.service.js";

type ScopePayload = {
  companyId?: string | null;
  employeeId?: string | null;
  departmentId?: string | null;
  officeId?: string | null;
  clientId?: string | null;
  assignedToEmployeeId?: string | null;
  createdByEmployeeId?: string | null;
};

export const permissionService = {
  async getUserPermissions(userId: string) {
    const context = await accessResolverService.getUserAccessContext(userId);
    return context.permissions;
  },

  async getUserScopes(userId: string) {
    const context = await accessResolverService.getUserAccessContext(userId);
    return context.permissions.flatMap((permission) =>
      permission.scopes.map((scope) => ({
        permissionCode: permission.code,
        type: scope.type,
        refId: scope.refId || null
      }))
    );
  },

  async hasPermission(userId: string, permissionCode: string, scope?: ScopePayload) {
    const context = await accessResolverService.getUserAccessContext(userId);
    if (permissionCode === "*") return true;
    const permission = context.permissionMap.get(permissionCode);
    if (!permission?.allowed) return false;
    if (!scope) return true;
    return scopeResolverService.canAccess(context, permissionCode, scope);
  },

  async requirePermission(userId: string, permissionCode: string, scope?: ScopePayload) {
    const allowed = await this.hasPermission(userId, permissionCode, scope);
    if (!allowed) {
      throw new ApiError(403, `Missing permission: ${permissionCode}`);
    }
  },

  async requireAnyPermission(userId: string, permissionCodes: string[], scope?: ScopePayload) {
    for (const permissionCode of permissionCodes) {
      if (await this.hasPermission(userId, permissionCode, scope)) {
        return permissionCode;
      }
    }
    throw new ApiError(403, `Missing any of permissions: ${permissionCodes.join(", ")}`);
  },

  async requireApprovalPermission(userId: string, permissionCode: string, scope?: ScopePayload) {
    const allowed = await this.hasPermission(userId, permissionCode, scope);
    if (!allowed) {
      throw new ApiError(403, `Missing approval permission: ${permissionCode}`);
    }
  },

  async getAccessPayload(userId: string) {
    const context = await accessResolverService.getUserAccessContext(userId);
    return {
      user: context.user,
      employee: context.employee,
      profiles: context.profiles,
      permissions: context.permissions.map((permission) => ({
        code: permission.code,
        allowed: permission.allowed,
        sensitive: permission.sensitive,
        sources: permission.sources,
        scopes: permission.scopes
      })),
      scopes: context.permissions.flatMap((permission) =>
        permission.scopes.map((scope) => ({
          permissionCode: permission.code,
          type: scope.type,
          refId: scope.refId || null
        }))
      ),
      approvalAuthority: context.approvalAuthorities
    };
  }
};
