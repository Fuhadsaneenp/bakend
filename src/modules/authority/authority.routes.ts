import { AccessScopeType, PermissionEffect, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission, requireRoles } from "../../middleware/auth.js";
import { authorityService } from "./authority.service.js";
import { prisma } from "../../lib/prisma.js";

export const authorityRouter = Router();

authorityRouter.use(requireAuth);

// ─── BOOTSTRAP: Seed permissions (SUPER_ADMIN only, bypasses permission check) ───
authorityRouter.post("/seed-permissions", requireRoles(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const permissionSeeds: Array<[string, string, string, string, string, boolean]> = [
      ["settings.authority.view", "settings", "authority", "view", "View authority settings, access profiles, and audit logs.", true],
      ["settings.authority.manage", "settings", "authority", "manage", "Create and manage access profiles, user overrides, scopes, and workflows.", true],
      ["dashboard.summary.view", "dashboard", "summary", "view", "View the main HR dashboard with summary metrics.", false],
      ["employee.profile.view", "employee", "profile", "view", "View employee profiles and directory.", false],
      ["employee.profile.edit", "employee", "profile", "edit", "Edit employee profiles.", false],
      ["employee.profile.create", "employee", "profile", "create", "Create new employee records.", false],
      ["employee.profile.delete", "employee", "profile", "delete", "Delete or archive employee records.", true],
      ["employee.document.view", "employee", "document", "view", "View employee documents.", false],
      ["employee.document.upload", "employee", "document", "upload", "Upload documents for employees.", false],
      ["employee.letter.view", "employee", "letter", "view", "View employment letters.", false],
      ["employee.letter.generate", "employee", "letter", "generate", "Generate employment letters.", false],
      ["attendance.record.view", "attendance", "record", "view", "View attendance records.", false],
      ["attendance.punch.manual", "attendance", "punch", "manual", "Manually add or edit punch records.", true],
      ["attendance.regularize.approve", "attendance", "regularize", "approve", "Approve attendance regularization requests.", false],
      ["attendance.biometric.sync", "attendance", "biometric", "sync", "Sync biometric device data.", true],
      ["attendance.settings.manage", "attendance", "settings", "manage", "Manage attendance settings.", true],
      ["leave.request.view", "leave", "request", "view", "View leave requests.", false],
      ["leave.request.create", "leave", "request", "create", "Create leave requests.", false],
      ["leave.request.approve", "leave", "request", "approve", "Approve or reject leave requests.", false],
      ["leave.settings.manage", "leave", "settings", "manage", "Manage leave types and policies.", true],
      ["wfh.request.view", "wfh", "request", "view", "View WFH requests.", false],
      ["wfh.request.create", "wfh", "request", "create", "Create WFH requests.", false],
      ["wfh.request.approve", "wfh", "request", "approve", "Approve or reject WFH requests.", false],
      ["expense.claim.view", "expense", "claim", "view", "View expense claims.", false],
      ["expense.claim.create", "expense", "claim", "create", "Submit expense claims.", false],
      ["expense.claim.review", "expense", "claim", "review", "Review expense claims.", false],
      ["expense.claim.approve", "expense", "claim", "approve", "Approve or reject expense claims.", false],
      ["payroll.run.view", "payroll", "run", "view", "View payroll runs and payslips.", true],
      ["payroll.run.process", "payroll", "run", "process", "Process and finalize payroll runs.", true],
      ["payroll.run.approve", "payroll", "run", "approve", "Approve payroll for payment.", true],
      ["payroll.settings.manage", "payroll", "settings", "manage", "Manage payroll settings and structures.", true],
      ["crm.client.view", "crm", "client", "view", "View CRM clients.", false],
      ["crm.client.create", "crm", "client", "create", "Create CRM clients.", false],
      ["crm.client.edit", "crm", "client", "edit", "Edit CRM clients.", false],
      ["crm.lead.view", "crm", "lead", "view", "View CRM leads.", false],
      ["crm.lead.create", "crm", "lead", "create", "Create CRM leads.", false],
      ["crm.lead.edit", "crm", "lead", "edit", "Edit CRM leads.", false],
      ["crm.lead.convert", "crm", "lead", "convert", "Convert leads to clients.", false],
      ["worktrack.settings.view", "worktrack", "settings", "view", "View Work Track settings.", false],
      ["worktrack.settings.manage", "worktrack", "settings", "manage", "Manage Work Track settings.", true],
      ["worktrack.client.view", "worktrack", "client", "view", "View Work Track clients.", false],
      ["worktrack.client.create", "worktrack", "client", "create", "Create Work Track clients.", false],
      ["worktrack.task.view", "worktrack", "task", "view", "View tasks.", false],
      ["worktrack.task.create", "worktrack", "task", "create", "Create tasks.", false],
      ["worktrack.task.edit", "worktrack", "task", "edit", "Edit tasks.", false],
      ["worktrack.task.assign", "worktrack", "task", "assign", "Assign tasks to employees.", false],
      ["worktrack.task.status.update", "worktrack", "task", "status.update", "Update task status.", false],
      ["worktrack.file.upload", "worktrack", "file", "upload", "Upload files to tasks.", false],
      ["worktrack.comment.create", "worktrack", "comment", "create", "Add comments to tasks.", false],
      ["worktrack.review.review", "worktrack", "review", "review", "Review submitted work.", false],
      ["worktrack.review.return", "worktrack", "review", "return", "Return work for revision.", false],
      ["worktrack.review.approve", "worktrack", "review", "approve", "Approve submitted work.", false],
      ["worktrack.review.reject", "worktrack", "review", "reject", "Reject submitted work.", false],
      ["worktrack.analytics.view", "worktrack", "analytics", "view", "View Work Track analytics.", false],
      ["recruitment.applicant.view", "recruitment", "applicant", "view", "View recruitment applicants.", false],
      ["recruitment.applicant.evaluate", "recruitment", "applicant", "evaluate", "Evaluate recruitment applicants.", false],
      ["performance.goal.manage", "performance", "goal", "manage", "Manage performance goals.", false],
      ["performance.appraisal.review", "performance", "appraisal", "review", "Review performance appraisals.", false],
      ["lifecycle.checklist.manage", "lifecycle", "checklist", "manage", "Manage onboarding/offboarding checklists.", false],
      ["settings.company.view", "settings", "company", "view", "View company settings.", false],
      ["settings.company.manage", "settings", "company", "manage", "Manage company settings.", true],
      ["settings.department.manage", "settings", "department", "manage", "Manage departments.", true],
      ["settings.office.manage", "settings", "office", "manage", "Manage office locations.", true],
      ["settings.shift.manage", "settings", "shift", "manage", "Manage work shifts.", true],
      ["report.hr.view", "report", "hr", "view", "View HR reports.", false],
      ["report.payroll.view", "report", "payroll", "view", "View payroll reports.", true],
    ];

    let created = 0;
    let skipped = 0;
    for (const [code, module, feature, action, description, isSensitive] of permissionSeeds) {
      const existing = await prisma.permission.findUnique({ where: { code } });
      if (existing) { skipped++; continue; }
      await prisma.permission.create({ data: { code, module, feature, action, description, isSensitive } });
      created++;
    }

    res.json({ success: true, created, skipped, total: permissionSeeds.length });
  } catch (error) {
    next(error);
  }
});

// ─── 1. PERMISSIONS CATALOG ───
authorityRouter.get("/permissions", requirePermission("settings.authority.view"), async (req, res, next) => {
  try {
    const query = z.object({
      search: z.string().optional(),
      module: z.string().optional()
    }).parse(req.query);
    res.json(await authorityService.listPermissions(query.search, query.module));
  } catch (error) {
    next(error);
  }
});

// ─── 2. ACCESS PROFILES ───
authorityRouter.get("/profiles", requirePermission("settings.authority.view"), async (req, res, next) => {
  try {
    const isGlobal = req.user?.role === Role.SUPER_ADMIN || req.user?.role === Role.HR_ADMIN;
    res.json(await authorityService.listProfiles(isGlobal ? null : req.user?.companyId || null));
  } catch (error) {
    next(error);
  }
});

authorityRouter.get("/profiles/:id", requirePermission("settings.authority.view"), async (req, res, next) => {
  try {
    res.json(await authorityService.getProfile(req.params.id));
  } catch (error) {
    next(error);
  }
});

authorityRouter.post("/profiles", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    const body = z.object({
      companyId: z.string().optional().nullable(),
      code: z.string().min(2),
      name: z.string().min(2),
      description: z.string().optional(),
      category: z.string().optional(),
      permissionCodes: z.array(z.string()).optional()
    }).parse(req.body);
    res.status(201).json(await authorityService.createProfile(req.user!.id, {
      ...body,
      companyId: body.companyId !== undefined ? body.companyId : req.user?.companyId
    }));
  } catch (error) {
    next(error);
  }
});

authorityRouter.patch("/profiles/:id", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      isActive: z.boolean().optional(),
      permissionCodes: z.array(z.string()).optional()
    }).parse(req.body);
    res.json(await authorityService.updateProfile(req.user!.id, req.params.id, body));
  } catch (error) {
    next(error);
  }
});

authorityRouter.delete("/profiles/:id", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    res.json(await authorityService.deleteProfile(req.user!.id, req.params.id));
  } catch (error) {
    next(error);
  }
});

// ─── 3. USER ACCESS MANAGEMENT ───
authorityRouter.get("/users", requirePermission("settings.authority.view"), async (req, res, next) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const isGlobal = req.user?.role === Role.SUPER_ADMIN || req.user?.role === Role.HR_ADMIN;
    const companyId = isGlobal ? null : req.user?.companyId || null;
    res.json(await authorityService.listUsersWithAccess(companyId, search));
  } catch (error) {
    next(error);
  }
});

authorityRouter.get("/users/:userId/access", requirePermission("settings.authority.view"), async (req, res, next) => {
  try {
    res.json(await authorityService.getUserAccess(req.params.userId));
  } catch (error) {
    next(error);
  }
});

authorityRouter.put("/users/:userId/permissions", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    const body = z.object({
      role: z.nativeEnum(Role).optional(),
      accessProfileIds: z.array(z.string()).optional(),
      permissionOverrides: z.array(z.object({
        permissionCode: z.string(),
        effect: z.nativeEnum(PermissionEffect),
        reason: z.string().optional()
      })).optional()
    }).parse(req.body);
    res.json(await authorityService.updateUserPermissionsBatch(req.user!.id, req.params.userId, body));
  } catch (error) {
    next(error);
  }
});

authorityRouter.post("/users/:userId/profiles", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    const body = z.object({
      accessProfileId: z.string().min(1),
      expiresAt: z.string().optional().nullable()
    }).parse(req.body);
    res.status(201).json(await authorityService.assignProfile(req.user!.id, req.params.userId, body.accessProfileId, body.expiresAt));
  } catch (error) {
    next(error);
  }
});

authorityRouter.delete("/users/:userId/profiles/:profileId", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    res.json(await authorityService.unassignProfile(req.user!.id, req.params.userId, req.params.profileId));
  } catch (error) {
    next(error);
  }
});

// ─── 4. PERMISSION OVERRIDES ───
authorityRouter.get("/users/:userId/overrides", requirePermission("settings.authority.view"), async (req, res, next) => {
  try {
    res.json(await authorityService.listUserOverrides(req.params.userId));
  } catch (error) {
    next(error);
  }
});

authorityRouter.post("/users/:userId/overrides", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    const body = z.object({
      permissionCode: z.string().min(1),
      effect: z.nativeEnum(PermissionEffect),
      reason: z.string().optional(),
      expiresAt: z.string().optional().nullable(),
      scopes: z.array(z.object({
        scopeType: z.nativeEnum(AccessScopeType),
        scopeRefId: z.string().optional().nullable()
      })).optional()
    }).parse(req.body);
    res.status(201).json(await authorityService.addPermissionOverride(req.user!.id, req.params.userId, body));
  } catch (error) {
    next(error);
  }
});

authorityRouter.delete("/overrides/:overrideId", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    res.json(await authorityService.removePermissionOverride(req.user!.id, req.params.overrideId));
  } catch (error) {
    next(error);
  }
});

// ─── 5. SCOPES MANAGEMENT ───
authorityRouter.get("/scopes", requirePermission("settings.authority.view"), async (_req, res, next) => {
  try {
    res.json(await authorityService.listScopes());
  } catch (error) {
    next(error);
  }
});

authorityRouter.get("/scopes/targets", requirePermission("settings.authority.view"), async (req, res, next) => {
  try {
    res.json(await authorityService.getScopeTargets(req.user?.companyId || null));
  } catch (error) {
    next(error);
  }
});

authorityRouter.put("/profile-permissions/:id/scopes", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    const body = z.object({
      scopes: z.array(z.object({
        scopeType: z.nativeEnum(AccessScopeType),
        scopeRefId: z.string().optional().nullable()
      }))
    }).parse(req.body);
    res.json(await authorityService.updateProfilePermissionScopes(req.user!.id, req.params.id, body.scopes));
  } catch (error) {
    next(error);
  }
});

// ─── 6. APPROVAL WORKFLOWS ───
authorityRouter.get("/workflows", requirePermission("settings.authority.view"), async (req, res, next) => {
  try {
    res.json(await authorityService.listWorkflows(req.user?.companyId || null));
  } catch (error) {
    next(error);
  }
});

authorityRouter.post("/workflows", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    const body = z.object({
      companyId: z.string().optional(),
      code: z.string().min(2),
      name: z.string().min(2),
      module: z.string().min(2),
      feature: z.string().min(2),
      description: z.string().optional(),
      stages: z.array(z.object({
        stageOrder: z.number().int().min(1),
        stageName: z.string().min(2),
        permissionCode: z.string().optional(),
        approverScopeType: z.nativeEnum(AccessScopeType),
        isFinal: z.boolean().default(false),
        canReturn: z.boolean().default(false),
        canReject: z.boolean().default(false),
        finalStatus: z.string().optional()
      }))
    }).parse(req.body);

    const companyId = body.companyId || req.user?.companyId;
    if (!companyId) throw new Error("Company ID is required");

    res.status(201).json(await authorityService.createWorkflow(req.user!.id, { ...body, companyId }));
  } catch (error) {
    next(error);
  }
});

authorityRouter.patch("/workflows/:id", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
      stages: z.array(z.object({
        stageOrder: z.number().int().min(1),
        stageName: z.string().min(2),
        permissionCode: z.string().optional(),
        approverScopeType: z.nativeEnum(AccessScopeType),
        isFinal: z.boolean().default(false),
        canReturn: z.boolean().default(false),
        canReject: z.boolean().default(false),
        finalStatus: z.string().optional()
      })).optional()
    }).parse(req.body);
    res.json(await authorityService.updateWorkflow(req.user!.id, req.params.id, body));
  } catch (error) {
    next(error);
  }
});

authorityRouter.delete("/workflows/:id", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    res.json(await authorityService.deleteWorkflow(req.user!.id, req.params.id));
  } catch (error) {
    next(error);
  }
});

// ─── 7. AUDIT LOGS ───
authorityRouter.get("/audit-logs", requirePermission("settings.authority.view"), async (req, res, next) => {
  try {
    res.json(await authorityService.listAuditLogs(req.user?.companyId || null));
  } catch (error) {
    next(error);
  }
});

// ─── 8. USER TRACK & MODULE SETTINGS ───
authorityRouter.get("/user-track-settings", async (req, res, next) => {
  try {
    res.json(await authorityService.getUserTrackSettings(req.user?.companyId || null));
  } catch (error) {
    next(error);
  }
});

authorityRouter.put("/user-track-settings", requirePermission("settings.authority.manage"), async (req, res, next) => {
  try {
    const data = req.body;
    res.json(await authorityService.saveUserTrackSettings(req.user!.id, req.user?.companyId || null, data));
  } catch (error) {
    next(error);
  }
});

// ─── 9. DELETE USER (SUPER_ADMIN only — for removing ghost/dummy accounts) ───
authorityRouter.delete("/users/:userId", requireRoles(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (userId === req.user!.id) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    // Delete permission overrides, profiles, scopes, and then the user
    await prisma.userPermissionOverride.deleteMany({ where: { userId } });
    await prisma.userPermissionScope.deleteMany({ where: { userId } });
    await prisma.userAccessProfile.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    res.json({ success: true, deleted: userId });
  } catch (error) {
    next(error);
  }
});

// Bulk delete multiple users at once
authorityRouter.post("/users/bulk-delete", requireRoles(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { userIds } = z.object({ userIds: z.array(z.string()) }).parse(req.body);
    const selfId = req.user!.id;
    const toDelete = userIds.filter(id => id !== selfId);
    let deleted = 0;
    for (const userId of toDelete) {
      await prisma.userPermissionOverride.deleteMany({ where: { userId } });
      await prisma.userPermissionScope.deleteMany({ where: { userId } });
      await prisma.userAccessProfile.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      deleted++;
    }
    res.json({ success: true, deleted });
  } catch (error) {
    next(error);
  }
});
