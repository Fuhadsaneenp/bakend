import { ApprovalStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { wfhService } from "./wfh.service.js";

export const wfhRouter = Router();
wfhRouter.use(requireAuth);

wfhRouter.post("/request", async (req, res, next) => {
  try {
    const body = z.object({ startDate: z.string(), endDate: z.string(), reason: z.string().min(5) }).parse(req.body);
    res.status(201).json(await wfhService.request(req.user!.id, body));
  } catch (error) {
    next(error);
  }
});

wfhRouter.get("/", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await wfhService.list(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

wfhRouter.patch("/:id/review", requireRoles(Role.HR_ADMIN, Role.MANAGER, Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED]) }).parse(req.body);
    res.json(await wfhService.review(req.params.id, req.user!.id, body.status));
  } catch (error) {
    next(error);
  }
});
