import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { dashboardService } from "./dashboard.service.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await dashboardService.company(req.user.companyId));
  } catch (error) {
    next(error);
  }
});
