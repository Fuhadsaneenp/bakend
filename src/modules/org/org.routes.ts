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

orgRouter.get("/companies/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    const company = await orgService.company(req.params.id);
    if (!company) {
      throw new ApiError(404, "Company not found");
    }
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.companyId !== company.id) {
      throw new ApiError(403, "Insufficient permissions");
    }
    res.json(company);
  } catch (error) {
    next(error);
  }
});

orgRouter.post("/companies", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string(),
      legalName: z.string().optional(),
      logoUrl: z.string().optional(),
      phoneCode: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      overview: z.string().optional(),
      worksSevenDays: z.boolean().optional()
    }).parse(req.body);
    res.status(201).json(await orgService.createCompany(body));
  } catch (error) {
    next(error);
  }
});

orgRouter.patch("/companies/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().optional(),
      legalName: z.string().optional().nullable(),
      logoUrl: z.string().optional().nullable(),
      phoneCode: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
      overview: z.string().optional().nullable(),
      worksSevenDays: z.boolean().optional()
    }).parse(req.body);
    res.json(await orgService.updateCompany(req.params.id, body));
  } catch (error) {
    next(error);
  }
});

orgRouter.delete("/companies/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    res.json(await orgService.deleteCompany(req.params.id));
  } catch (error) {
    next(error);
  }
});

const officeBody = z.object({
  companyId: z.string().optional(),
  name: z.string().trim().min(1),
  placeName: z.string().trim().optional().nullable(),
  country: z.string().trim().min(1),
  isHQ: z.boolean().optional(),
  active: z.boolean().optional(),
  timezone: z.string().trim().min(1),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal(""))
});

orgRouter.get("/offices", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    const requestedCompanyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    const companyId = req.user!.role === Role.SUPER_ADMIN ? requestedCompanyId : req.user!.companyId || undefined;
    res.json(await orgService.offices(companyId));
  } catch (error) {
    next(error);
  }
});

orgRouter.post("/offices", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const body = officeBody.parse(req.body);
    const companyId = req.user!.role === Role.SUPER_ADMIN ? body.companyId || req.user!.companyId : req.user!.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const { companyId: _companyId, ...data } = body;
    res.status(201).json(await orgService.createOffice(companyId, data));
  } catch (error) {
    next(error);
  }
});

orgRouter.patch("/offices/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const office = await prisma.office.findUnique({ where: { id: req.params.id } });
    if (!office) throw new ApiError(404, "Office not found");
    if (req.user!.role !== Role.SUPER_ADMIN && office.companyId !== req.user!.companyId) {
      throw new ApiError(403, "Insufficient permissions");
    }
    const data = officeBody.omit({ companyId: true }).partial().parse(req.body);
    res.json(await orgService.updateOffice(office.id, office.companyId, data));
  } catch (error) {
    next(error);
  }
});

orgRouter.delete("/offices/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const office = await prisma.office.findUnique({ where: { id: req.params.id } });
    if (!office) throw new ApiError(404, "Office not found");
    if (req.user!.role !== Role.SUPER_ADMIN && office.companyId !== req.user!.companyId) {
      throw new ApiError(403, "Insufficient permissions");
    }
    res.json(await orgService.deleteOffice(office.id));
  } catch (error) {
    next(error);
  }
});

const allowedCompanySettingKeys = new Set(["timeoff_holidays", "timeoff_types", "timeoff_policies"]);

orgRouter.get("/company-settings/:key", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    if (!allowedCompanySettingKeys.has(req.params.key)) throw new ApiError(404, "Setting not found");
    if (!req.user!.companyId) throw new ApiError(400, "Company context required");
    const setting = await prisma.companySetting.findUnique({
      where: { companyId_key: { companyId: req.user!.companyId, key: req.params.key } }
    });
    res.json({ key: req.params.key, value: setting?.value ?? null });
  } catch (error) {
    next(error);
  }
});

orgRouter.put("/company-settings/:key", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!allowedCompanySettingKeys.has(req.params.key)) throw new ApiError(404, "Setting not found");
    if (!req.user!.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({ value: z.unknown() }).parse(req.body);
    const setting = await prisma.companySetting.upsert({
      where: { companyId_key: { companyId: req.user!.companyId, key: req.params.key } },
      create: { companyId: req.user!.companyId, key: req.params.key, value: body.value as any },
      update: { value: body.value as any }
    });
    res.json({ key: setting.key, value: setting.value });
  } catch (error) {
    next(error);
  }
});

// Company-Scoped Departments
orgRouter.get("/companies/:companyId/departments", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    const { companyId } = req.params;
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.role !== Role.HR_ADMIN && req.user!.companyId !== companyId) {
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
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.role !== Role.HR_ADMIN && req.user!.companyId !== companyId) {
      throw new ApiError(403, "Insufficient permissions for this company context");
    }
    const body = z.object({ name: z.string(), code: z.string() }).parse(req.body);
    res.status(201).json(await orgService.createDepartment(companyId, body));
  } catch (error) {
    next(error);
  }
});

// Original legacy routes for compatibility
orgRouter.get("/departments", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    if (req.user?.role === Role.SUPER_ADMIN || req.user?.role === Role.HR_ADMIN) {
      res.json(await orgService.listAllDepartments());
    } else {
      if (!req.user?.companyId) throw new ApiError(400, "Company context required");
      res.json(await orgService.departments(req.user.companyId));
    }
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
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.role !== Role.HR_ADMIN && dept.companyId !== req.user!.companyId) {
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
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.role !== Role.HR_ADMIN && dept.companyId !== req.user!.companyId) {
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
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.role !== Role.HR_ADMIN && dept.companyId !== req.user!.companyId) {
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
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.role !== Role.HR_ADMIN && desg.department.companyId !== req.user!.companyId) {
      throw new ApiError(403, "Insufficient permissions");
    }
    const body = z.object({
      title: z.string().optional(),
      departmentId: z.string().optional()
    }).parse(req.body);
    res.json(await orgService.updateDesignation(req.params.id, body.title, body.departmentId));
  } catch (error) {
    next(error);
  }
});

orgRouter.delete("/designations/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const desg = await prisma.designation.findUnique({ where: { id: req.params.id }, include: { department: true } });
    if (!desg) throw new ApiError(404, "Designation not found");
    if (req.user!.role !== Role.SUPER_ADMIN && req.user!.role !== Role.HR_ADMIN && desg.department.companyId !== req.user!.companyId) {
      throw new ApiError(403, "Insufficient permissions");
    }
    res.json(await orgService.deleteDesignation(req.params.id));
  } catch (error) {
    next(error);
  }
});
