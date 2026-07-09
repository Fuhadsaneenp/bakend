import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { orgService } from "./org.service.js";
import { prisma } from "../../lib/prisma.js";

export const orgRouter = Router();
orgRouter.use(requireAuth);

// Companies CRUD
orgRouter.get("/companies", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    res.json(await orgService.companies());
  } catch (error) {
    next(error);
  }
});

orgRouter.post("/companies", requireRoles(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string(),
      legalName: z.string().optional(),
      logoUrl: z.string().optional()
    }).parse(req.body);
    res.status(201).json(await orgService.createCompany(body));
  } catch (error) {
    next(error);
  }
});

orgRouter.patch("/companies/:id", requireRoles(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().optional(),
      legalName: z.string().optional().nullable(),
      logoUrl: z.string().optional().nullable()
    }).parse(req.body);
    res.json(await orgService.updateCompany(req.params.id, body));
  } catch (error) {
    next(error);
  }
});

orgRouter.delete("/companies/:id", requireRoles(Role.SUPER_ADMIN), async (req, res, next) => {
  try {
    res.json(await orgService.deleteCompany(req.params.id));
  } catch (error) {
    next(error);
  }
});

// Company-Scoped Departments
orgRouter.get("/companies/:companyId/departments", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    const { companyId } = req.params;
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.companyId !== companyId) {
      throw new ApiError(403, "Insufficient permissions for this company context");
    }
    res.json(await orgService.departments(companyId));
  } catch (error) {
    next(error);
  }
});

orgRouter.post("/companies/:companyId/departments", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const { companyId } = req.params;
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.companyId !== companyId) {
      throw new ApiError(403, "Insufficient permissions for this company context");
    }
    const body = z.object({ name: z.string(), code: z.string() }).parse(req.body);
    res.status(201).json(await orgService.createDepartment(companyId, body));
  } catch (error) {
    next(error);
  }
});

// Original legacy routes for compatibility
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

// Department update & delete
orgRouter.patch("/departments/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const dept = await prisma.department.findUnique({ where: { id: req.params.id } });
    if (!dept) throw new ApiError(404, "Department not found");
    if (req.user!.role !== Role.SUPER_ADMIN && dept.companyId !== req.user!.companyId) {
      throw new ApiError(403, "Insufficient permissions");
    }
    const body = z.object({ name: z.string().optional(), code: z.string().optional() }).parse(req.body);
    res.json(await orgService.updateDepartment(req.params.id, body));
  } catch (error) {
    next(error);
  }
});

orgRouter.delete("/departments/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const dept = await prisma.department.findUnique({ where: { id: req.params.id } });
    if (!dept) throw new ApiError(404, "Department not found");
    if (req.user!.role !== Role.SUPER_ADMIN && dept.companyId !== req.user!.companyId) {
      throw new ApiError(403, "Insufficient permissions");
    }
    res.json(await orgService.deleteDepartment(req.params.id));
  } catch (error) {
    next(error);
  }
});

// Designations CRUD under Department
orgRouter.post("/departments/:id/designations", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const dept = await prisma.department.findUnique({ where: { id: req.params.id } });
    if (!dept) throw new ApiError(404, "Department not found");
    if (req.user!.role !== Role.SUPER_ADMIN && dept.companyId !== req.user!.companyId) {
      throw new ApiError(403, "Insufficient permissions");
    }
    const body = z.object({ title: z.string() }).parse(req.body);
    res.status(201).json(await orgService.createDesignation(req.params.id, body.title));
  } catch (error) {
    next(error);
  }
});

orgRouter.patch("/designations/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const desg = await prisma.designation.findUnique({ where: { id: req.params.id }, include: { department: true } });
    if (!desg) throw new ApiError(404, "Designation not found");
    if (req.user!.role !== Role.SUPER_ADMIN && desg.department.companyId !== req.user!.companyId) {
      throw new ApiError(403, "Insufficient permissions");
    }
    const body = z.object({ title: z.string() }).parse(req.body);
    res.json(await orgService.updateDesignation(req.params.id, body.title));
  } catch (error) {
    next(error);
  }
});

orgRouter.delete("/designations/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const desg = await prisma.designation.findUnique({ where: { id: req.params.id }, include: { department: true } });
    if (!desg) throw new ApiError(404, "Designation not found");
    if (req.user!.role !== Role.SUPER_ADMIN && desg.department.companyId !== req.user!.companyId) {
      throw new ApiError(403, "Insufficient permissions");
    }
    res.json(await orgService.deleteDesignation(req.params.id));
  } catch (error) {
    next(error);
  }
});
