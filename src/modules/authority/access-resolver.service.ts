import { AccessScopeType, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

const legacyRolePermissionFallback: Record<Role, string[]> = {
  SUPER_ADMIN: ["*"],
  HR_ADMIN: [
    "dashboard.summary.view",
    "employee.profile.view",
    "employee.profile.create",
    "employee.profile.edit",
    "employee.profile.delete",
    "employee.document.view",
    "employee.document.upload",
    "employee.letter.view",
    "employee.letter.generate",
    "attendance.record.view",
    "attendance.punch.manual",
    "attendance.regularize.approve",
    "attendance.biometric.sync",
    "attendance.settings.manage",
    "leave.request.view",
    "leave.request.create",
    "leave.request.approve",
    "leave.settings.manage",
    "wfh.request.view",
    "wfh.request.create",
    "wfh.request.approve",
    "expense.claim.view",
    "expense.claim.create",
    "expense.claim.review",
    "expense.claim.approve",
    "payroll.run.view",
    "payroll.run.process",
    "payroll.run.approve",
    "payroll.settings.manage",
    "crm.client.view",
    "crm.client.create",
    "crm.client.edit",
    "crm.lead.view",
    "crm.lead.create",
    "crm.lead.edit",
    "crm.lead.convert",
    "worktrack.settings.view",
    "worktrack.settings.manage",
    "worktrack.client.view",
    "worktrack.client.create",
    "worktrack.task.view",
    "worktrack.task.create",
    "worktrack.task.edit",
    "worktrack.task.assign",
    "worktrack.task.status.update",
    "worktrack.file.upload",
    "worktrack.comment.create",
    "worktrack.review.review",
    "worktrack.review.return",
    "worktrack.review.approve",
    "worktrack.review.reject",
    "worktrack.analytics.view",
    "recruitment.applicant.view",
    "recruitment.applicant.evaluate",
    "performance.goal.manage",
    "performance.appraisal.review",
    "lifecycle.checklist.manage",
    "settings.department.manage",
    "settings.office.manage",
    "settings.shift.manage",
    "report.hr.view",
    "report.payroll.view",
    "settings.company.view",
    "settings.authority.view",
    "settings.authority.manage"
  ],
  MANAGER: [
    "dashboard.summary.view",
    "employee.profile.view",
    "attendance.record.view",
    "leave.request.view",
    "leave.request.approve",
    "crm.client.view",
    "crm.client.create",
    "crm.client.edit",
    "crm.lead.view",
    "crm.lead.create",
    "crm.lead.edit",
    "worktrack.client.view",
    "worktrack.client.create",
    "worktrack.client.edit",
    "worktrack.task.view",
    "worktrack.task.create",
    "worktrack.task.assign",
    "worktrack.task.edit",
    "worktrack.task.status.update",
    "worktrack.file.upload",
    "worktrack.comment.create",
    "worktrack.review.review",
    "worktrack.review.return",
    "worktrack.review.approve",
    "worktrack.review.reject",
    "worktrack.analytics.view",
    "settings.authority.view"
  ],
  EMPLOYEE: [
    "dashboard.summary.view",
    "employee.profile.view",
    "leave.request.view",
    "expense.claim.view",
    "worktrack.task.view",
    "worktrack.task.status.update",
    "worktrack.file.upload",
    "worktrack.comment.create"
  ]
};

const legacyRoleScopes: Record<Role, AccessScopeType[]> = {
  SUPER_ADMIN: [AccessScopeType.GLOBAL],
  HR_ADMIN: [AccessScopeType.GLOBAL, AccessScopeType.COMPANY],
  MANAGER: [AccessScopeType.DEPARTMENT, AccessScopeType.ASSIGNED_CLIENTS, AccessScopeType.COMPANY],
  EMPLOYEE: [AccessScopeType.SELF, AccessScopeType.ASSIGNED_TO_ME, AccessScopeType.CREATED_BY_ME]
};

export type EffectivePermission = {
  code: string;
  allowed: boolean;
  sensitive: boolean;
  sources: string[];
  scopes: Array<{ type: AccessScopeType; refId?: string | null }>;
};

export type AccessContext = {
  user: {
    id: string;
    companyId: string | null;
    role: Role;
    email: string;
  };
  employee: null | {
    id: string;
    departmentId: string | null;
    managerId: string | null;
    officeId: string | null;
  };
  profiles: Array<{
    id: string;
    code: string;
    name: string;
    category: string | null;
    expiresAt: Date | null;
    isActive: boolean;
  }>;
  permissions: EffectivePermission[];
  permissionMap: Map<string, EffectivePermission>;
  approvalAuthorities: string[];
};

function ensurePermissionEntry(
  permissionMap: Map<string, EffectivePermission>,
  code: string,
  sensitive = false
) {
  let entry = permissionMap.get(code);
  if (!entry) {
    entry = { code, allowed: false, sensitive, sources: [], scopes: [] };
    permissionMap.set(code, entry);
  }
  return entry;
}

function pushScope(entry: EffectivePermission, type: AccessScopeType, refId?: string | null) {
  const exists = entry.scopes.some((scope) => scope.type === type && (scope.refId || null) === (refId || null));
  if (!exists) {
    entry.scopes.push({ type, refId: refId || null });
  }
}

export const accessResolverService = {
  async getUserAccessContext(userId: string): Promise<AccessContext> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: {
          select: {
            id: true,
            departmentId: true,
            managerId: true,
            officeId: true
          }
        },
        assignedAccessProfiles: {
          where: { isActive: true },
          include: {
            accessProfile: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                    scopes: true
                  }
                }
              }
            }
          }
        },
        permissionOverrides: {
          where: { isActive: true },
          include: { permission: true }
        },
        userPermissionScopes: {
          include: { permission: true }
        }
      }
    });

    if (!user) {
      throw new Error("User access resolution failed: user not found.");
    }

    const permissionMap = new Map<string, EffectivePermission>();

    // ── Step 1: Profile-based permissions ──
    for (const assignment of user.assignedAccessProfiles) {
      if (assignment.expiresAt && assignment.expiresAt < new Date()) continue;
      for (const profilePermission of assignment.accessProfile.permissions) {
        const entry = ensurePermissionEntry(
          permissionMap,
          profilePermission.permission.code,
          profilePermission.permission.isSensitive
        );
        if (profilePermission.effect === "ALLOW") {
          entry.allowed = true;
        }
        entry.sources.push(`profile:${assignment.accessProfile.code}`);
        for (const scope of profilePermission.scopes) {
          pushScope(entry, scope.scopeType, scope.scopeRefId);
        }
      }
    }

    // ── Step 2: Explicit overrides (processed BEFORE legacy fallback so DENY always wins) ──
    const explicitlyOverriddenCodes = new Set<string>();
    for (const override of user.permissionOverrides) {
      if (override.expiresAt && override.expiresAt < new Date()) continue;
      const entry = ensurePermissionEntry(
        permissionMap,
        override.permission.code,
        override.permission.isSensitive
      );
      entry.allowed = override.effect === "ALLOW";
      entry.sources.push(`override:${override.effect.toLowerCase()}`);
      explicitlyOverriddenCodes.add(override.permission.code);
    }

    // ── Step 3: Legacy role fallback — only applies to codes NOT explicitly overridden ──
    // If a user has ANY explicit overrides (i.e. they were configured via Authority UI),
    // skip the legacy fallback entirely so the UI is the sole source of truth.
    const hasExplicitOverrides = explicitlyOverriddenCodes.size > 0;
    if (!hasExplicitOverrides) {
      const legacyPermissions = legacyRolePermissionFallback[user.role] || [];
      if (legacyPermissions.includes("*")) {
        const allPermissions = await prisma.permission.findMany();
        for (const permission of allPermissions) {
          const entry = ensurePermissionEntry(permissionMap, permission.code, permission.isSensitive);
          entry.allowed = true;
          entry.sources.push(`legacy-role:${user.role}`);
          for (const scope of legacyRoleScopes[user.role] || [AccessScopeType.GLOBAL]) {
            pushScope(entry, scope);
          }
        }
      } else {
        for (const code of legacyPermissions) {
          const entry = ensurePermissionEntry(permissionMap, code, code.startsWith("settings.authority") || code.startsWith("payroll."));
          entry.allowed = true;
          entry.sources.push(`legacy-role:${user.role}`);
          for (const scope of legacyRoleScopes[user.role] || [AccessScopeType.SELF]) {
            pushScope(entry, scope);
          }
        }
      }
    }

    // ── Step 4: User-level scope hints ──
    for (const scope of user.userPermissionScopes) {
      const entry = ensurePermissionEntry(permissionMap, scope.permission.code, scope.permission.isSensitive);
      entry.sources.push("user-scope");
      pushScope(entry, scope.scopeType, scope.scopeRefId);
    }

    // Super Admin is a platform owner role. It must always resolve to every
    // permission even if older Authority UI overrides accidentally contain DENY.
    if (user.role === "SUPER_ADMIN") {
      const allPermissions = await prisma.permission.findMany();
      for (const permission of allPermissions) {
        const entry = ensurePermissionEntry(permissionMap, permission.code, permission.isSensitive);
        entry.allowed = true;
        entry.sources.push("role:super-admin-full-access");
        pushScope(entry, AccessScopeType.GLOBAL);
      }
    }

    const permissions = Array.from(permissionMap.values()).sort((a, b) => a.code.localeCompare(b.code));
    const approvalAuthorities = permissions
      .filter((permission) => permission.allowed && (permission.code.includes(".approve") || permission.code.includes(".review") || permission.code.includes(".reject") || permission.code.includes(".return")))
      .map((permission) => permission.code);

    return {
      user: {
        id: user.id,
        companyId: user.companyId,
        role: user.role,
        email: user.email
      },
      employee: user.employee
        ? {
            id: user.employee.id,
            departmentId: user.employee.departmentId,
            managerId: user.employee.managerId,
            officeId: user.employee.officeId
          }
        : null,
      profiles: user.assignedAccessProfiles
        .filter((assignment) => !assignment.expiresAt || assignment.expiresAt >= new Date())
        .map((assignment) => ({
          id: assignment.accessProfile.id,
          code: assignment.accessProfile.code,
          name: assignment.accessProfile.name,
          category: assignment.accessProfile.category,
          expiresAt: assignment.expiresAt,
          isActive: assignment.isActive
        })),
      permissions,
      permissionMap,
      approvalAuthorities
    };
  }
};
