import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { orgService } from "./org.service.js";

export const orgRouter = Router();
orgRouter.use(requireAuth);

orgRouter.get("/departments", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await orgService.departments(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

orgRouter.post("/departments", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({ name: z.string(), code: z.string() }).parse(req.body);
    res.status(201).json(await orgService.createDepartment(req.user.companyId, body));
  } catch (error) {
    next(error);
  }
});

orgRouter.post("/departments/:id/designations", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({ title: z.string() }).parse(req.body);
    res.status(201).json(await orgService.createDesignation(req.params.id, body.title));
  } catch (error) {
    next(error);
  }
});
