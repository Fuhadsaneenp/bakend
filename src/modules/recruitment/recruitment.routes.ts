import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { recruitmentService } from "./recruitment.service.js";

const jobOpeningSchema = z.object({
  departmentId: z.string().optional().nullable(),
  hiringManagerId: z.string().optional().nullable(),
  title: z.string().trim().min(1),
  employmentType: z.string().trim().optional(),
  location: z.string().trim().optional().nullable(),
  openings: z.number().int().min(1).max(500).optional(),
  status: z.enum(["DRAFT", "OPEN", "ON_HOLD", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  description: z.string().optional().nullable(),
  targetDate: z.coerce.date().optional().nullable()
});

const applicantSchema = z.object({
  jobOpeningId: z.string().min(1),
  fullName: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().optional().nullable(),
  stage: z.enum(["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "ON_HOLD"]).optional(),
  source: z.string().trim().optional().nullable(),
  currentCompany: z.string().trim().optional().nullable(),
  experienceYears: z.number().min(0).max(50).optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  noticePeriodDays: z.number().int().min(0).max(365).optional().nullable(),
  expectedCompensation: z.number().min(0).optional().nullable(),
  summary: z.string().optional().nullable()
});

export const recruitmentRouter = Router();
recruitmentRouter.use(requireAuth);

recruitmentRouter.get("/summary", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await recruitmentService.getSummary(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

recruitmentRouter.get("/openings", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await recruitmentService.getOpenings(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

recruitmentRouter.post("/openings", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = jobOpeningSchema.parse(req.body);
    res.status(201).json(await recruitmentService.createOpening(req.user.companyId, body));
  } catch (error) {
    next(error);
  }
});

recruitmentRouter.patch("/openings/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = jobOpeningSchema.partial().parse(req.body);
    res.json(await recruitmentService.updateOpening(req.user.companyId, req.params.id, body));
  } catch (error) {
    next(error);
  }
});

recruitmentRouter.get("/applicants", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const jobOpeningId = typeof req.query.jobOpeningId === "string" ? req.query.jobOpeningId : undefined;
    res.json(await recruitmentService.getApplicants(req.user.companyId, jobOpeningId));
  } catch (error) {
    next(error);
  }
});

recruitmentRouter.post("/applicants", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = applicantSchema.parse(req.body);
    res.status(201).json(await recruitmentService.createApplicant(req.user.companyId, body));
  } catch (error) {
    next(error);
  }
});

recruitmentRouter.patch("/applicants/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = applicantSchema.partial().parse(req.body);
    res.json(await recruitmentService.updateApplicant(req.user.companyId, req.params.id, body));
  } catch (error) {
    next(error);
  }
});
