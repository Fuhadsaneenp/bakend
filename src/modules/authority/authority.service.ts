import { AccessScopeType, PermissionEffect, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { permissionService } from "./permission.service.js";

async function createAuthorityAuditLog(input: {
  actorUserId?: string | null;
  targetUserId?: string | null;
  companyId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}) {
  await prisma.authorityAuditLog.create({
    data: {
      actorUserId: input.actorUserId || null,
      targetUserId: input.targetUserId || null,
      companyId: input.companyId || null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId || null,
      oldValue: input.oldValue as any,
      newValue: input.newValue as any,
      reason: input.reason || null
    }
  });
}

export const authorityService = {
  // ─── 1. PERMISSION CATALOG ───
  async listPermissions(search?: string, module?: string) {
    return prisma.permission.findMany({
      where: {
        code: search ? { contains: search } : undefined,
        module: module || undefined
      },
      orderBy: [{ module: "asc" }, { code: "asc" }]
    });
  },

  // ─── 2. ACCESS PROFILES ───
  async listProfiles(companyId?: string | null) {
    return prisma.accessProfile.findMany({
      where: {
        OR: [
          { companyId: null },
          ...(companyId ? [{ companyId }] : [])
        ]
      },
      include: {
        permissions: {
          include: {
            permission: true,
            scopes: true
          }
        },
        _count: {
          select: { userAssignments: true }
        }
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }]
    });
  },

  async getProfile(profileId: string) {
    const profile = await prisma.accessProfile.findUnique({
      where: { id: profileId },
      include: {
        permissions: {
          include: {
            permission: true,
            scopes: true
          }
        },
        userAssignments: {
          include: {
            user: {
              include: {
                employee: {
                  select: { id: true, firstName: true, lastName: true, employeeCode: true }
                }
              }
            }
          }
        }
      }
    });
    if (!profile) throw new ApiError(404, "Access profile not found");
    return profile;
  },

  async createProfile(actorUserId: string, data: {
    companyId?: string | null;
    code: string;
    name: string;
    description?: string;
    category?: string;
    permissionCodes?: string[];
  }) {
    const existing = await prisma.accessProfile.findFirst({
      where: { code: data.code, companyId: data.companyId || null }
    });
    if (existing) throw new ApiError(400, "A profile with this code already exists");

    const profile = await prisma.accessProfile.create({
      data: {
        companyId: data.companyId || null,
        code: data.code,
        name: data.name,
        description: data.description,
        category: data.category || "Operations",
        isSystem: false,
        isActive: true
      }
    });

    if (data.permissionCodes?.length) {
      const permissions = await prisma.permission.findMany({
        where: { code: { in: data.permissionCodes } }
      });
      for (const permission of permissions) {
        await prisma.accessProfilePermission.create({
          data: {
            accessProfileId: profile.id,
            permissionId: permission.id,
            effect: PermissionEffect.ALLOW
          }
        });
      }
    }

    await createAuthorityAuditLog({
      actorUserId,
      companyId: data.companyId || null,
      action: "profile.create",
      entityType: "AccessProfile",
      entityId: profile.id,
      newValue: data
    });

    return profile;
  },

  async updateProfile(actorUserId: string, profileId: string, data: {
    name?: string;
    description?: string;
    category?: string;
    isActive?: boolean;
    permissionCodes?: string[];
  }) {
    const existing = await prisma.accessProfile.findUnique({
      where: { id: profileId },
      include: { permissions: true }
    });
    if (!existing) throw new ApiError(404, "Access profile not found");

    const updated = await prisma.accessProfile.update({
      where: { id: profileId },
      data: {
        name: data.name,
        description: data.description,
        category: data.category,
        isActive: data.isActive
      }
    });

    if (data.permissionCodes !== undefined) {
      await prisma.accessProfilePermission.deleteMany({ where: { accessProfileId: profileId } });
      if (data.permissionCodes.length > 0) {
        const permissions = await prisma.permission.findMany({
          where: { code: { in: data.permissionCodes } }
        });
        for (const permission of permissions) {
          await prisma.accessProfilePermission.create({
            data: {
              accessProfileId: profileId,
              permissionId: permission.id,
              effect: PermissionEffect.ALLOW
            }
          });
        }
      }
    }

    await createAuthorityAuditLog({
      actorUserId,
      companyId: existing.companyId || null,
      action: "profile.update",
      entityType: "AccessProfile",
      entityId: updated.id,
      oldValue: existing,
      newValue: data
    });

    return updated;
  },

  async deleteProfile(actorUserId: string, profileId: string) {
    const existing = await prisma.accessProfile.findUnique({ where: { id: profileId } });
    if (!existing) throw new ApiError(404, "Access profile not found");
    if (existing.isSystem) throw new ApiError(403, "System profiles cannot be deleted");

    await prisma.accessProfilePermission.deleteMany({ where: { accessProfileId: profileId } });
    await prisma.userAccessProfile.deleteMany({ where: { accessProfileId: profileId } });
    await prisma.accessProfile.delete({ where: { id: profileId } });

    await createAuthorityAuditLog({
      actorUserId,
      companyId: existing.companyId || null,
      action: "profile.delete",
      entityType: "AccessProfile",
      entityId: profileId,
      oldValue: existing
    });

    return { success: true };
  },

  // ─── 3. USER ACCESS MANAGEMENT ───
  async listUsersWithAccess(companyId?: string | null, search?: string) {
    const users = await prisma.user.findMany({
      where: {
        companyId: companyId || undefined,
        OR: search
          ? [
              { email: { contains: search } },
              { employee: { firstName: { contains: search } } },
              { employee: { lastName: { contains: search } } },
              { employee: { employeeCode: { contains: search } } }
            ]
          : undefined
      },
      include: {
        employee: {
          include: {
            department: true,
            designation: true
          }
        },
        assignedAccessProfiles: {
          where: { isActive: true },
          include: {
            accessProfile: true
          }
        },
        permissionOverrides: {
          where: { isActive: true },
          include: {
            permission: true
          }
        }
      },
      orderBy: { email: "asc" }
    });

    const visibleUsers = users.filter((u) => {
      const email = String(u.email || "").trim().toLowerCase();
      const localPart = email.split("@")[0] || "";
      const isBiometricPlaceholder =
        !u.employee &&
        email.endsWith("@stems.secondtales.com") &&
        /^hf\d{3,}$/.test(localPart);

      return !isBiometricPlaceholder;
    });

    return visibleUsers.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      companyId: u.companyId,
      employee: u.employee
        ? {
            id: u.employee.id,
            code: u.employee.employeeCode,
            name: [u.employee.firstName, u.employee.middleName, u.employee.lastName].filter(Boolean).join(" "),
            department: u.employee.department?.name || null,
            designation: u.employee.designation?.title || null,
            office: null,
            status: u.employee.status
          }
        : null,
      profiles: u.assignedAccessProfiles.map((ap) => ({
        id: ap.id,
        profileId: ap.accessProfileId,
        code: ap.accessProfile.code,
        name: ap.accessProfile.name,
        category: ap.accessProfile.category,
        assignedAt: ap.assignedAt,
        expiresAt: ap.expiresAt
      })),
      overridesCount: u.permissionOverrides.length
    }));
  },

  async getUserAccess(userId: string) {
    let targetUserId = userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      const emp = await prisma.employee.findUnique({
        where: { id: userId },
        include: { user: true }
      });
      if (emp?.user) {
        targetUserId = emp.user.id;
      }
    }
    return permissionService.getAccessPayload(targetUserId);
  },

  async updateUserPermissionsBatch(actorUserId: string, userId: string, data: {
    role?: Role;
    accessProfileIds?: string[];
    permissionOverrides?: Array<{ permissionCode: string; effect: PermissionEffect; reason?: string }>;
  }) {
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      const emp = await prisma.employee.findUnique({
        where: { id: userId },
        include: { user: true }
      });
      if (emp?.user) {
        user = emp.user;
        userId = emp.user.id;
      } else if (emp) {
        const email = emp.personalEmail || `${(emp.employeeCode || "emp").toLowerCase()}@stems.secondtales.com`;
        user = await prisma.user.findUnique({ where: { email } });
        if (user) {
          await prisma.employee.update({ where: { id: emp.id }, data: { userId: user.id } });
          userId = user.id;
        } else {
          user = await prisma.user.create({
            data: {
              email,
              passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
              role: (data.role as any) || Role.EMPLOYEE,
              companyId: emp.companyId,
              isActive: true
            }
          });
          await prisma.employee.update({ where: { id: emp.id }, data: { userId: user.id } });
          userId = user.id;
        }
      }
    }
    if (!user) throw new ApiError(404, "User not found");

    if (data.role) {
      await prisma.user.update({
        where: { id: userId },
        data: { role: data.role }
      });
      if (data.role === Role.HR_ADMIN || data.role === Role.SUPER_ADMIN) {
        await prisma.employee.updateMany({
          where: { userId },
          data: { isHrHead: true }
        });
      } else if (data.role === Role.EMPLOYEE) {
        await prisma.employee.updateMany({
          where: { userId },
          data: { isHrHead: false }
        });
      }
    }

    if (data.accessProfileIds !== undefined) {
      await prisma.userAccessProfile.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false }
      });

      for (const profileId of data.accessProfileIds) {
        await prisma.userAccessProfile.create({
          data: {
            userId,
            accessProfileId: profileId,
            assignedById: actorUserId,
            isActive: true
          }
        });
      }
    }

    if (data.permissionOverrides !== undefined) {
      await prisma.userPermissionOverride.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false }
      });

      for (const ov of data.permissionOverrides) {
        const perm = await prisma.permission.findUnique({ where: { code: ov.permissionCode } });
        if (perm) {
          await prisma.userPermissionOverride.create({
            data: {
              userId,
              permissionId: perm.id,
              effect: ov.effect,
              reason: ov.reason || "Direct employee permission update",
              assignedById: actorUserId,
              isActive: true
            }
          });
        }
      }
    }

    await createAuthorityAuditLog({
      actorUserId,
      targetUserId: userId,
      companyId: user.companyId,
      action: "user.permissions.direct_update",
      entityType: "User",
      entityId: userId,
      newValue: data
    });

    return permissionService.getAccessPayload(userId);
  },

  async assignProfile(actorUserId: string, userId: string, accessProfileId: string, expiresAt?: string | null) {
    const existing = await prisma.userAccessProfile.findFirst({
      where: {
        userId,
        accessProfileId,
        isActive: true
      }
    });

    if (existing) {
      if (expiresAt !== undefined) {
        return prisma.userAccessProfile.update({
          where: { id: existing.id },
          data: { expiresAt: expiresAt ? new Date(expiresAt) : null }
        });
      }
      return existing;
    }

    const assignment = await prisma.userAccessProfile.create({
      data: {
        userId,
        accessProfileId,
        assignedById: actorUserId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        isActive: true
      },
      include: { accessProfile: true }
    });

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    await createAuthorityAuditLog({
      actorUserId,
      targetUserId: userId,
      companyId: targetUser?.companyId || null,
      action: "user.profile.assign",
      entityType: "UserAccessProfile",
      entityId: assignment.id,
      newValue: assignment
    });

    return assignment;
  },

  async unassignProfile(actorUserId: string, userId: string, accessProfileId: string) {
    const existing = await prisma.userAccessProfile.findFirst({
      where: { userId, accessProfileId, isActive: true }
    });
    if (!existing) throw new ApiError(404, "Profile assignment not found");

    await prisma.userAccessProfile.update({
      where: { id: existing.id },
      data: { isActive: false }
    });

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    await createAuthorityAuditLog({
      actorUserId,
      targetUserId: userId,
      companyId: targetUser?.companyId || null,
      action: "user.profile.unassign",
      entityType: "UserAccessProfile",
      entityId: existing.id,
      oldValue: existing
    });

    return { success: true };
  },

  // ─── 4. PERMISSION OVERRIDES ───
  async listUserOverrides(userId: string) {
    return prisma.userPermissionOverride.findMany({
      where: { userId, isActive: true },
      include: {
        permission: true,
        assignedBy: { select: { id: true, email: true } }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async addPermissionOverride(actorUserId: string, userId: string, data: {
    permissionCode: string;
    effect: PermissionEffect;
    reason?: string;
    expiresAt?: string | null;
    scopes?: Array<{ scopeType: AccessScopeType; scopeRefId?: string | null }>;
  }) {
    const permission = await prisma.permission.findUnique({ where: { code: data.permissionCode } });
    if (!permission) throw new ApiError(404, "Permission not found");

    // Deactivate previous override for the same permission if any
    await prisma.userPermissionOverride.updateMany({
      where: { userId, permissionId: permission.id, isActive: true },
      data: { isActive: false }
    });

    const override = await prisma.userPermissionOverride.create({
      data: {
        userId,
        permissionId: permission.id,
        effect: data.effect,
        reason: data.reason,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        assignedById: actorUserId,
        isActive: true
      }
    });

    if (data.scopes?.length) {
      for (const s of data.scopes) {
        await prisma.userPermissionScope.create({
          data: {
            userId,
            permissionId: permission.id,
            scopeType: s.scopeType,
            scopeRefId: s.scopeRefId || null
          }
        });
      }
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    await createAuthorityAuditLog({
      actorUserId,
      targetUserId: userId,
      companyId: targetUser?.companyId || null,
      action: "user.permission.override",
      entityType: "UserPermissionOverride",
      entityId: override.id,
      newValue: data,
      reason: data.reason || null
    });

    return override;
  },

  async removePermissionOverride(actorUserId: string, overrideId: string) {
    const existing = await prisma.userPermissionOverride.findUnique({ where: { id: overrideId } });
    if (!existing) throw new ApiError(404, "Permission override not found");

    await prisma.userPermissionOverride.update({
      where: { id: overrideId },
      data: { isActive: false }
    });

    const targetUser = await prisma.user.findUnique({ where: { id: existing.userId } });
    await createAuthorityAuditLog({
      actorUserId,
      targetUserId: existing.userId,
      companyId: targetUser?.companyId || null,
      action: "user.permission.override.remove",
      entityType: "UserPermissionOverride",
      entityId: overrideId,
      oldValue: existing
    });

    return { success: true };
  },

  // ─── 5. SCOPE TARGETS & SCOPES ───
  async listScopes() {
    return prisma.accessScope.findMany({
      orderBy: { code: "asc" }
    });
  },

  async getScopeTargets(companyId?: string | null) {
    const [departments, teams, offices, clients] = await Promise.all([
      prisma.department.findMany({
        where: companyId ? { companyId } : undefined,
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" }
      }),
      prisma.team.findMany({
        where: companyId ? { companyId } : undefined,
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" }
      }),
      prisma.office.findMany({
        where: companyId ? { companyId } : undefined,
        select: { id: true, name: true, placeName: true },
        orderBy: { name: "asc" }
      }),
      prisma.client.findMany({
        where: companyId ? { companyId } : undefined,
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      })
    ]);

    return {
      departments,
      teams,
      offices,
      clients
    };
  },

  async updateProfilePermissionScopes(actorUserId: string, profilePermissionId: string, scopes: Array<{ scopeType: AccessScopeType; scopeRefId?: string | null }>) {
    const link = await prisma.accessProfilePermission.findUnique({
      where: { id: profilePermissionId },
      include: { accessProfile: true }
    });
    if (!link) throw new ApiError(404, "Profile permission not found");

    await prisma.profilePermissionScope.deleteMany({ where: { accessProfilePermissionId: profilePermissionId } });

    for (const s of scopes) {
      await prisma.profilePermissionScope.create({
        data: {
          accessProfilePermissionId: profilePermissionId,
          permissionId: link.permissionId,
          scopeType: s.scopeType,
          scopeRefId: s.scopeRefId || null
        }
      });
    }

    await createAuthorityAuditLog({
      actorUserId,
      companyId: link.accessProfile.companyId,
      action: "profile.permission.scopes.update",
      entityType: "ProfilePermissionScope",
      entityId: profilePermissionId,
      newValue: scopes
    });

    return { success: true };
  },

  // ─── 6. APPROVAL WORKFLOWS ───
  async listWorkflows(companyId?: string | null) {
    return prisma.approvalWorkflow.findMany({
      where: companyId ? { companyId } : undefined,
      include: {
        stages: {
          include: {
            requiredPermission: true
          },
          orderBy: { stageOrder: "asc" }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async createWorkflow(actorUserId: string, data: {
    companyId: string;
    code: string;
    name: string;
    module: string;
    feature: string;
    description?: string;
    stages: Array<{
      stageOrder: number;
      stageName: string;
      permissionCode?: string;
      approverScopeType: AccessScopeType;
      isFinal: boolean;
      canReturn: boolean;
      canReject: boolean;
      finalStatus?: string;
    }>;
  }) {
    const existing = await prisma.approvalWorkflow.findFirst({
      where: { companyId: data.companyId, code: data.code }
    });
    if (existing) throw new ApiError(400, "A workflow with this code already exists");

    const workflow = await prisma.approvalWorkflow.create({
      data: {
        companyId: data.companyId,
        code: data.code,
        name: data.name,
        module: data.module,
        feature: data.feature,
        description: data.description,
        isActive: true
      }
    });

    for (const stage of data.stages) {
      let permissionId: string | null = null;
      if (stage.permissionCode) {
        const perm = await prisma.permission.findUnique({ where: { code: stage.permissionCode } });
        if (perm) permissionId = perm.id;
      }

      await prisma.approvalWorkflowStage.create({
        data: {
          workflowId: workflow.id,
          stageOrder: stage.stageOrder,
          stageName: stage.stageName,
          requiredPermissionId: permissionId,
          approverScopeType: stage.approverScopeType,
          isFinal: stage.isFinal,
          canReturn: stage.canReturn,
          canReject: stage.canReject,
          finalStatus: stage.finalStatus || null
        }
      });
    }

    await createAuthorityAuditLog({
      actorUserId,
      companyId: data.companyId,
      action: "workflow.create",
      entityType: "ApprovalWorkflow",
      entityId: workflow.id,
      newValue: data
    });

    return workflow;
  },

  async updateWorkflow(actorUserId: string, workflowId: string, data: {
    name?: string;
    description?: string;
    isActive?: boolean;
    stages?: Array<{
      stageOrder: number;
      stageName: string;
      permissionCode?: string;
      approverScopeType: AccessScopeType;
      isFinal: boolean;
      canReturn: boolean;
      canReject: boolean;
      finalStatus?: string;
    }>;
  }) {
    const existing = await prisma.approvalWorkflow.findUnique({ where: { id: workflowId } });
    if (!existing) throw new ApiError(404, "Workflow not found");

    const updated = await prisma.approvalWorkflow.update({
      where: { id: workflowId },
      data: {
        name: data.name,
        description: data.description,
        isActive: data.isActive
      }
    });

    if (data.stages) {
      await prisma.approvalWorkflowStage.deleteMany({ where: { workflowId } });
      for (const stage of data.stages) {
        let permissionId: string | null = null;
        if (stage.permissionCode) {
          const perm = await prisma.permission.findUnique({ where: { code: stage.permissionCode } });
          if (perm) permissionId = perm.id;
        }

        await prisma.approvalWorkflowStage.create({
          data: {
            workflowId,
            stageOrder: stage.stageOrder,
            stageName: stage.stageName,
            requiredPermissionId: permissionId,
            approverScopeType: stage.approverScopeType,
            isFinal: stage.isFinal,
            canReturn: stage.canReturn,
            canReject: stage.canReject,
            finalStatus: stage.finalStatus || null
          }
        });
      }
    }

    await createAuthorityAuditLog({
      actorUserId,
      companyId: existing.companyId,
      action: "workflow.update",
      entityType: "ApprovalWorkflow",
      entityId: workflowId,
      oldValue: existing,
      newValue: data
    });

    return updated;
  },

  async deleteWorkflow(actorUserId: string, workflowId: string) {
    const existing = await prisma.approvalWorkflow.findUnique({ where: { id: workflowId } });
    if (!existing) throw new ApiError(404, "Workflow not found");

    await prisma.approvalWorkflowStage.deleteMany({ where: { workflowId } });
    await prisma.approvalWorkflow.delete({ where: { id: workflowId } });

    await createAuthorityAuditLog({
      actorUserId,
      companyId: existing.companyId,
      action: "workflow.delete",
      entityType: "ApprovalWorkflow",
      entityId: workflowId,
      oldValue: existing
    });

    return { success: true };
  },

  // ─── 7. AUDIT LOGS ───
  async listAuditLogs(companyId?: string | null) {
    return prisma.authorityAuditLog.findMany({
      where: companyId ? { companyId } : undefined,
      include: {
        actorUser: { select: { id: true, email: true } },
        targetUser: { select: { id: true, email: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 150
    });
  },

  // ─── 8. USER TRACK & MODULE SETTINGS ───
  async getUserTrackSettings(companyId?: string | null) {
    let setting = null;
    if (companyId) {
      setting = await prisma.companySetting.findUnique({
        where: {
          companyId_key: {
            companyId,
            key: "authority_user_track_settings"
          }
        }
      });
    }

    if (!setting) {
      setting = await prisma.companySetting.findFirst({
        where: {
          key: "authority_user_track_settings"
        }
      });
    }

    if (!setting?.value) return { trackLevels: {}, moduleGrants: {}, actionGrants: {}, positionOverrides: {}, emsLevels: {} };
    try {
      if (typeof setting.value === "string") {
        return JSON.parse(setting.value);
      }
      return setting.value as any;
    } catch {
      return { trackLevels: {}, moduleGrants: {}, actionGrants: {}, positionOverrides: {}, emsLevels: {} };
    }
  },

  async saveUserTrackSettings(actorUserId: string, companyId: string | null | undefined, data: any) {
    let resolvedCompanyId = companyId;
    if (!resolvedCompanyId) {
      const firstCompany = await prisma.company.findFirst();
      resolvedCompanyId = firstCompany?.id || null;
    }
    if (!resolvedCompanyId) throw new ApiError(400, "Company ID required");

    const existing = await this.getUserTrackSettings(resolvedCompanyId);
    const merged = {
      trackLevels: data.trackLevels !== undefined ? data.trackLevels : (existing.trackLevels || {}),
      moduleGrants: data.moduleGrants !== undefined ? data.moduleGrants : (existing.moduleGrants || {}),
      actionGrants: data.actionGrants !== undefined ? data.actionGrants : (existing.actionGrants || {}),
      positionOverrides: data.positionOverrides !== undefined ? data.positionOverrides : (existing.positionOverrides || {}),
      emsLevels: data.emsLevels !== undefined ? data.emsLevels : (existing.emsLevels || {})
    };

    const allCompanies = await prisma.company.findMany({ select: { id: true } });
    const targetCompanyIds = Array.from(new Set([resolvedCompanyId, ...allCompanies.map(c => c.id)].filter(Boolean))) as string[];

    for (const cId of targetCompanyIds) {
      await prisma.companySetting.upsert({
        where: {
          companyId_key: {
            companyId: cId,
            key: "authority_user_track_settings"
          }
        },
        create: {
          companyId: cId,
          key: "authority_user_track_settings",
          value: JSON.stringify(merged)
        },
        update: {
          value: JSON.stringify(merged)
        }
      });
    }

    return merged;
  }
};
