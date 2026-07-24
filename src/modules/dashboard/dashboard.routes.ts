import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { dashboardService } from "./dashboard.service.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res, next) => {
  try {
    if (!req.user) throw new ApiError(401, "Unauthenticated");
    if (!req.user.companyId && req.user.role !== "SUPER_ADMIN" && req.user.role !== "HR_ADMIN") {
      throw new ApiError(400, "Company context required");
    }
    res.json(await dashboardService.forUser(req.user));
  } catch (error) {
    next(error);
  }
});
