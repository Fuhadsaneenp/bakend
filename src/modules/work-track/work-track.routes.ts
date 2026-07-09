import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { workTrackService } from "./work-track.service.js";

export const workTrackRouter = Router();

workTrackRouter.use(requireAuth);

// Settings
workTrackRouter.get("/settings", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.getSettings(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.put("/settings", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.updateSettings(req.user.companyId, req.body));
  } catch (error) {
    next(error);
  }
});

// Clients
workTrackRouter.get("/clients", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.getClients(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/clients", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      name: z.string().min(1),
      details: z.string().optional(),
      contacts: z.string().optional(),
      accountManagerId: z.string().optional()
    }).parse(req.body);
    res.status(201).json(await workTrackService.createClient(req.user.companyId, body));
  } catch (error) {
    next(error);
  }
});

// Designers capacity mapping
workTrackRouter.get("/designers", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.getDesigners(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

// Work Cards
workTrackRouter.get("/cards", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const query = {
      clientId: req.query.clientId as string,
      assignedToId: req.query.assignedToId as string,
      status: req.query.status as string,
      priority: req.query.priority as string
    };
    res.json(await workTrackService.getWorkCards(req.user.companyId, req.user.id, req.user.role as any, query));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/cards", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      clientId: z.string().min(1),
      title: z.string().min(1),
      brief: z.string().min(1),
      category: z.string().min(1),
      priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]),
      complexity: z.enum(["SIMPLE", "MEDIUM", "HEAVY"]),
      deadline: z.string(),
      assignedToId: z.string().optional()
    }).parse(req.body);

    res.status(201).json(await workTrackService.createWorkCard(req.user.companyId, req.user.id, body));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.get("/cards/:id", async (req, res, next) => {
  try {
    res.json(await workTrackService.getWorkCardDetails(req.params.id));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.patch("/cards/:id/status", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      status: z.string(),
      reworkReason: z.string().optional(),
      reworkComment: z.string().optional(),
      rulingType: z.enum(["designer_fault", "client_delay", "none"]).optional(),
      finalFileUrl: z.string().optional()
    }).parse(req.body);

    res.json(await workTrackService.updateWorkCardStatus(req.user.companyId, req.params.id, req.user.id, body));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/cards/:id/comments", async (req, res, next) => {
  try {
    const body = z.object({
      text: z.string().min(1)
    }).parse(req.body);
    res.status(201).json(await workTrackService.addComment(req.params.id, req.user!.id, body.text));
  } catch (error) {
    next(error);
  }
});

// Analytics Dashboard
workTrackRouter.get("/analytics", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const month = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;
    const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    res.json(await workTrackService.getAnalytics(req.user.companyId, month, year));
  } catch (error) {
    next(error);
  }
});

// CSV / Excel import
workTrackRouter.post("/import", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.array(z.object({
      clientName: z.string().min(1),
      title: z.string().min(1),
      brief: z.string().min(1),
      category: z.string().min(1),
      priority: z.enum(["URGENT", "HIGH", "NORMAL", "LOW"]),
      complexity: z.enum(["SIMPLE", "MEDIUM", "HEAVY"]),
      deadline: z.string()
    })).parse(req.body);

    res.status(201).json(await workTrackService.importFromCsv(req.user.companyId, req.user.id, body));
  } catch (error) {
    next(error);
  }
});
