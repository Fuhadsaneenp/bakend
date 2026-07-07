import { Role } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { employeeService } from "./employee.service.js";
import { audit } from "../audit/audit.service.js";

export const employeeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
employeeRouter.use(requireAuth);

employeeRouter.get("/", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await employeeService.list(req.user.companyId));
  } catch (error) {
    next(error);
  }
});

employeeRouter.post("/", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string().optional(),
      personalEmail: z.string().email().optional(),
      dateOfJoining: z.string(),
      departmentId: z.string().optional(),
      designationId: z.string().optional(),
      managerId: z.string().optional(),
      role: z.nativeEnum(Role).optional(),
      biometricId: z.string().optional(),
      salary: z.object({
        basic: z.number().nonnegative(),
        allowances: z.number().nonnegative(),
        deductions: z.number().nonnegative(),
        effectiveFrom: z.string()
      }).optional()
    }).parse(req.body);
    const employee = await employeeService.onboard(req.user.companyId, body);
    await audit.record({ actorUserId: req.user.id, action: "EMPLOYEE_ONBOARDED", entity: "Employee", entityId: employee.id, ipAddress: req.ip });
    res.status(201).json(employee);
  } catch (error) {
    next(error);
  }
});

employeeRouter.patch("/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string().optional().nullable(),
      personalEmail: z.string().email().optional().nullable(),
      departmentId: z.string().optional().nullable(),
      designationId: z.string().optional().nullable(),
      managerId: z.string().optional().nullable(),
      role: z.nativeEnum(Role).optional(),
      biometricId: z.string().optional().nullable(),
      salary: z.object({
        basic: z.number().nonnegative(),
        allowances: z.number().nonnegative(),
        deductions: z.number().nonnegative(),
        effectiveFrom: z.string()
      }).optional()
    }).parse(req.body);

    const employee = await employeeService.update(req.user.companyId, req.params.id, body);
    await audit.record({ actorUserId: req.user.id, action: "EMPLOYEE_UPDATED", entity: "Employee", entityId: employee.id, ipAddress: req.ip });
    res.json(employee);
  } catch (error) {
    next(error);
  }
});

employeeRouter.patch("/:id/status", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({ status: z.enum(["ACTIVE", "INACTIVE", "TERMINATED"]) }).parse(req.body);
    res.json(await employeeService.updateStatus(req.user.companyId, req.params.id, body.status));
  } catch (error) {
    next(error);
  }
});

employeeRouter.post("/:id/documents", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    if (!req.file) throw new ApiError(400, "Document file is required");
    const body = z.object({ type: z.string().min(2) }).parse(req.body);
    res.status(201).json(await employeeService.attachDocument(req.user.companyId, req.params.id, req.file, body.type));
  } catch (error) {
    next(error);
  }
});
