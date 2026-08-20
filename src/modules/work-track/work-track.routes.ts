import { Router } from "express";
import { z } from "zod";
import { requireAnyPermission, requireAuth, requirePermission } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { workTrackService } from "./work-track.service.js";

export const workTrackRouter = Router();

workTrackRouter.use(requireAuth);

const dataEntrySheetRowSchema = z.object({
  count: z.number().default(0),
  category: z.string().default(""),
  sourceUrl: z.string().default(""),
  status: z.string().default("Not Uploaded")
}).passthrough();

const dataEntrySheetsSchema = z.object({
  sheets: z.record(z.string(), z.array(dataEntrySheetRowSchema))
});

// Settings
workTrackRouter.get("/settings", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.getSettings(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.put("/settings", requirePermission("worktrack.settings.manage"), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.updateSettings(req.user.companyId, req.body));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.get("/data-entry-sheets", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.getDataEntrySheets(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.put("/data-entry-sheets", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = dataEntrySheetsSchema.parse(req.body);
    res.json(await workTrackService.upsertDataEntrySheets(req.user.companyId, body.sheets));
  } catch (error) {
    next(error);
  }
});

// Clients
workTrackRouter.get("/clients", requirePermission("worktrack.client.view"), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.getClients(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/clients", requirePermission("worktrack.client.create"), async (req, res, next) => {
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

workTrackRouter.put("/clients/:id", requirePermission("worktrack.client.create"), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      name: z.string().optional(),
      details: z.string().optional(),
      contacts: z.string().optional(),
      packageName: z.string().optional(),
      postersCommitted: z.number().optional(),
      videoSeo: z.string().optional(),
      digitalMarketingActivities: z.string().optional(),
      accountManagerId: z.string().nullable().optional()
    }).parse(req.body);
    res.json(await workTrackService.updateClient(req.user.companyId, req.params.id, body));
  } catch (error) {
    next(error);
  }
});

// Designers capacity mapping
workTrackRouter.get("/designers", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const track = typeof req.query.track === "string" ? req.query.track : undefined;
    res.json(await workTrackService.getDesigners(req.user.companyId, track));
  } catch (error) {
    next(error);
  }
});

// Points management
workTrackRouter.get("/points", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const track = typeof req.query.track === "string" ? req.query.track : undefined;
    res.json(await workTrackService.getPointsSummary(req.user.companyId, track));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/points", requireAnyPermission(["worktrack.task.status.update", "worktrack.task.edit", "worktrack.review.approve", "worktrack.settings.manage"]), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      employeeId: z.string().min(1),
      points: z.number(),
      description: z.string().min(1),
      workCardId: z.string().optional()
    }).parse(req.body);
    res.status(201).json(await workTrackService.awardEmployeePoints(req.user.companyId, req.user.id, body));
  } catch (error) {
    next(error);
  }
});

// Work Cards
workTrackRouter.get("/cards", requirePermission("worktrack.task.view"), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const query = {
      clientId: req.query.clientId as string,
      assignedToId: req.query.assignedToId as string,
      status: req.query.status as string,
      priority: req.query.priority as string
    };
    res.json(await workTrackService.getWorkCards(req.user.companyId, req.user.id, query));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/cards", requirePermission("worktrack.task.create"), async (req, res, next) => {
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
      assignedToId: z.string().optional(),
      createdAt: z.string().optional()
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

workTrackRouter.patch("/cards/:id", requireAnyPermission(["worktrack.task.edit", "worktrack.task.assign", "worktrack.file.upload", "worktrack.task.status.update"]), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      priority: z.string().optional(),
      assignedToId: z.string().nullable().optional(),
      status: z.string().optional(),
      title: z.string().optional(),
      brief: z.string().optional(),
      deadline: z.string().optional(),
      createdAt: z.string().optional(),
      files: z.string().optional()
    }).parse(req.body);

    res.json(await workTrackService.updateWorkCardFields(req.user.companyId, req.params.id, { ...body, userId: req.user.id }));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.patch("/cards/:id/status", requireAnyPermission(["worktrack.task.status.update", "worktrack.review.review", "worktrack.review.approve", "worktrack.review.reject"]), async (req, res, next) => {
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

workTrackRouter.delete("/cards/:id", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.deleteWorkCard(req.user.companyId, req.user.id, req.params.id));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/cards/:id/comments", requirePermission("worktrack.comment.create"), async (req, res, next) => {
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
workTrackRouter.get("/analytics", requirePermission("worktrack.analytics.view"), async (req, res, next) => {
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
workTrackRouter.post("/import", requirePermission("worktrack.task.create"), async (req, res, next) => {
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

// Meta Ads Performance Management Routes
workTrackRouter.get("/meta/clients", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.getMetaClients(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.get("/meta/accounts/:clientId", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.getMetaAccountDetails(req.user.companyId, req.params.clientId));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/meta/accounts/:clientId", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.updateMetaAccount(req.user.companyId, req.params.clientId, req.body));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/meta/sync/:clientId", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.syncMetaAccount(req.user.companyId, req.params.clientId, {
      since: typeof req.query.since === "string" ? req.query.since : undefined,
      until: typeof req.query.until === "string" ? req.query.until : undefined,
      datePreset: typeof req.query.datePreset === "string" ? req.query.datePreset : undefined
    }));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/meta/campaigns", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.status(201).json(await workTrackService.createMetaCampaign(req.user.companyId, req.body));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.patch("/meta/campaigns/:id", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.updateMetaCampaign(req.user.companyId, req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.get("/meta/reports/:clientId", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.getMetaClientReport(req.user.companyId, req.params.clientId));
  } catch (error) {
    next(error);
  }
});

// Meta Leads Management Routes
workTrackRouter.get("/meta/leads", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const filters = {
      clientId: typeof req.query.clientId === "string" ? req.query.clientId : undefined,
      campaignId: typeof req.query.campaignId === "string" ? req.query.campaignId : undefined,
      leadStatus: typeof req.query.leadStatus === "string" ? req.query.leadStatus : undefined,
      qualificationStatus: typeof req.query.qualificationStatus === "string" ? req.query.qualificationStatus : undefined,
      leadSource: typeof req.query.leadSource === "string" ? req.query.leadSource : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      startDate: typeof req.query.startDate === "string" ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === "string" ? req.query.endDate : undefined
    };
    res.json(await workTrackService.getMetaLeads(req.user.companyId, filters));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/meta/leads", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.status(201).json(await workTrackService.createMetaLead(req.user.companyId, req.body));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.patch("/meta/leads/:id", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await workTrackService.updateMetaLead(req.user.companyId, req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.post("/meta/leads/:id/notes", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const author = req.user.email?.split("@")[0] || "Team Member";
    res.status(201).json(await workTrackService.addMetaLeadNote(req.user.companyId, req.params.id, req.body.authorName || author, req.body.content));
  } catch (error) {
    next(error);
  }
});

workTrackRouter.get("/meta/leads/analytics", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const filters = {
      clientId: typeof req.query.clientId === "string" ? req.query.clientId : undefined,
      campaignId: typeof req.query.campaignId === "string" ? req.query.campaignId : undefined
    };
    res.json(await workTrackService.getMetaLeadAnalytics(req.user.companyId, filters));
  } catch (error) {
    next(error);
  }
});
