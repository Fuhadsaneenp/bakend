import { AccessScopeType, PermissionEffect, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../../middleware/auth.js";
import { authorityService } from "./authority.service.js";

export const authorityRouter = Router();

authorityRouter.use(requireAuth);

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
    res.json(await authorityService.listProfiles(req.user?.companyId || null));
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
    res.json(await authorityService.listUsersWithAccess(req.user?.companyId || null, search));
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
