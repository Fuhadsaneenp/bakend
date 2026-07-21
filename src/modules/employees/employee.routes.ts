import { LetterType, Role } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { employeeService } from "./employee.service.js";
import { audit } from "../audit/audit.service.js";
import { authService } from "../auth/auth.service.js";

export const employeeRouter = Router();
const allowedDocumentMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const passwordSchema = z.string()
  .min(12)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/)
  .regex(/[^A-Za-z0-9]/);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedDocumentMimeTypes.has(file.mimetype)) {
      callback(new ApiError(400, "Only PDF, JPEG, PNG, or WebP files are allowed"));
      return;
    }
    callback(null, true);
  }
});
employeeRouter.use(requireAuth);

const profileFieldsSchema = {
  middleName: z.string().optional().nullable(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankIfsc: z.string().optional(),
  taxId: z.string().optional()
};

const nullableProfileFieldsSchema = {
  middleName: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  emergencyContactName: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankAccountNumber: z.string().optional().nullable(),
  bankIfsc: z.string().optional().nullable(),
  taxId: z.string().optional().nullable()
};

employeeRouter.get("/", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    res.json(await employeeService.listForUser(req.user!));
  } catch (error) {
    next(error);
  }
});

employeeRouter.get("/me", async (req, res, next) => {
  try {
    const employee = await employeeService.getByUserId(req.user!.id);
    if (!employee) {
      res.status(404).json({ message: "Employee profile not found for this user account" });
      return;
    }
    res.json(employee);
  } catch (error) {
    next(error);
  }
});

employeeRouter.get("/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    res.json(await employeeService.getByIdForUser(req.params.id, req.user!));
  } catch (error) {
    next(error);
  }
});

employeeRouter.patch("/me", async (req, res, next) => {
  try {
    const body = z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string().optional().nullable(),
      personalEmail: z.string().email().optional().nullable(),
      ...nullableProfileFieldsSchema
    }).parse(req.body);

    const employee = await employeeService.updateProfile(req.user!.id, body);
    await audit.record({ actorUserId: req.user!.id, action: "PROFILE_UPDATED", entity: "Employee", entityId: employee.id, ipAddress: req.ip });
    res.json(employee);
  } catch (error) {
    next(error);
  }
});

employeeRouter.post("/me/change-password", async (req, res, next) => {
  try {
    const body = z.object({
      currentPassword: z.string().min(1),
      newPassword: passwordSchema
    }).parse(req.body);

    res.json(await authService.changePassword(req.user!.id, body.currentPassword, body.newPassword));
  } catch (error) {
    next(error);
  }
});

employeeRouter.post("/", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    const body = z.object({
      email: z.string().email(),
      password: passwordSchema,
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string().optional(),
      personalEmail: z.string().email().optional(),
      dateOfJoining: z.string(),
      companyId: z.string().optional(),
      departmentId: z.string().optional(),
      designationId: z.string().optional(),
      managerId: z.string().optional(),
      role: z.nativeEnum(Role).optional(),
      biometricId: z.string().optional(),
      employeeCode: z.string().min(2).optional(),
      shiftId: z.string().optional(),
      officeId: z.string().optional(),
      isHrHead: z.boolean().optional(),
      ...profileFieldsSchema,
      salary: z.object({
        basic: z.number().nonnegative(),
        allowances: z.number().nonnegative(),
        deductions: z.number().nonnegative(),
        effectiveFrom: z.string()
      }).optional()
    }).parse(req.body);

    const targetCompanyId = req.user!.role === Role.SUPER_ADMIN ? (body.companyId || req.user!.companyId) : req.user!.companyId;
    if (!targetCompanyId) throw new ApiError(400, "Company context required");

    const employee = await employeeService.onboard(targetCompanyId, body);
    await audit.record({ actorUserId: req.user!.id, action: "EMPLOYEE_ONBOARDED", entity: "Employee", entityId: employee.id, ipAddress: req.ip });
    res.status(201).json(employee);
  } catch (error) {
    next(error);
  }
});

employeeRouter.patch("/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    const body = z.object({
      email: z.string().email().optional(),
      password: passwordSchema.optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      dateOfJoining: z.string().optional(),
      phone: z.string().optional().nullable(),
      personalEmail: z.string().email().optional().nullable(),
      companyId: z.string().optional().nullable(),
      departmentId: z.string().optional().nullable(),
      designationId: z.string().optional().nullable(),
      managerId: z.string().optional().nullable(),
      role: z.nativeEnum(Role).optional(),
      biometricId: z.string().optional().nullable(),
      employeeCode: z.string().min(2).optional(),
      shiftId: z.string().optional().nullable(),
      officeId: z.string().optional().nullable(),
      isHrHead: z.boolean().optional(),
      ...nullableProfileFieldsSchema,
      salary: z.object({
        basic: z.number().nonnegative(),
        allowances: z.number().nonnegative(),
        deductions: z.number().nonnegative(),
        effectiveFrom: z.string()
      }).optional()
    }).parse(req.body);

    const employee = await employeeService.update(req.user!, req.params.id, body);
    await audit.record({ actorUserId: req.user!.id, action: "EMPLOYEE_UPDATED", entity: "Employee", entityId: employee.id, ipAddress: req.ip });
    res.json(employee);
  } catch (error) {
    next(error);
  }
});

employeeRouter.patch("/:id/status", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    const body = z.object({ status: z.enum(["ACTIVE", "INACTIVE", "TERMINATED"]) }).parse(req.body);
    res.json(await employeeService.updateStatus(req.user!, req.params.id, body.status));
  } catch (error) {
    next(error);
  }
});

employeeRouter.delete("/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    const body = z.object({ confirmation: z.literal("CONFIRM") }).parse(req.body);
    const result = await employeeService.deleteEmployee(req.user!, req.params.id, body.confirmation);
    await audit.record({ actorUserId: req.user!.id, action: "EMPLOYEE_DELETED", entity: "Employee", entityId: req.params.id, ipAddress: req.ip });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

employeeRouter.post("/:id/push-to-device", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    const result = await employeeService.queueDeviceSync(req.user!, req.params.id);
    await audit.record({ actorUserId: req.user!.id, action: "EMPLOYEE_PUSHED_TO_DEVICE", entity: "Employee", entityId: req.params.id, ipAddress: req.ip });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

employeeRouter.post("/:id/pull-fingerprint-from-device", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    const result = await employeeService.queueDeviceTemplateDownload(req.user!, req.params.id);
    await audit.record({ actorUserId: req.user!.id, action: "EMPLOYEE_FINGERPRINT_PULL_REQUESTED", entity: "Employee", entityId: req.params.id, ipAddress: req.ip });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

employeeRouter.get("/:id/documents", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.EMPLOYEE), async (req, res, next) => {
  try {
    res.json(await employeeService.listDocumentsForUser(req.user!, req.params.id));
  } catch (error) {
    next(error);
  }
});

employeeRouter.post("/:id/documents", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.EMPLOYEE), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, "Document file is required");
    const body = z.object({ type: z.string().min(2), notes: z.string().optional() }).parse(req.body);
    res.status(201).json(await employeeService.attachDocument(req.user!, req.params.id, req.file, body.type, body.notes));
  } catch (error) {
    next(error);
  }
});

employeeRouter.patch("/documents/:documentId/verify", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({
      status: z.enum(["UPLOADED", "VERIFIED", "REJECTED"]),
      notes: z.string().optional()
    }).parse(req.body);
    res.json(await employeeService.verifyDocument(req.user!, req.params.documentId, body.status, body.notes));
  } catch (error) {
    next(error);
  }
});

employeeRouter.delete("/documents/:documentId", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    res.json(await employeeService.deleteDocument(req.user!, req.params.documentId));
  } catch (error) {
    next(error);
  }
});

employeeRouter.get("/:id/letters", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.EMPLOYEE), async (req, res, next) => {
  try {
    res.json(await employeeService.listLettersForUser(req.user!, req.params.id));
  } catch (error) {
    next(error);
  }
});

employeeRouter.post("/:id/letters", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    const body = z.object({
      type: z.nativeEnum(LetterType),
      title: z.string().optional(),
      body: z.string().optional()
    }).parse(req.body);
    res.status(201).json(await employeeService.generateLetter(req.user!, req.params.id, req.user!.id, body));
  } catch (error) {
    next(error);
  }
});

employeeRouter.post("/:id/exit", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    const body = z.object({
      dateOfExit: z.string(),
      exitReason: z.string(),
      exitRemarks: z.string().optional()
    }).parse(req.body);

    const employee = await prisma.employee.findFirst({
      where: req.user!.role === Role.SUPER_ADMIN ? { id: req.params.id } : { id: req.params.id, companyId: req.user!.companyId || undefined }
    });
    if (!employee) throw new ApiError(404, "Employee not found");

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: {
        status: "TERMINATED",
        dateOfExit: new Date(body.dateOfExit),
        exitReason: body.exitReason,
        exitRemarks: body.exitRemarks || null,
        settlementStatus: "PENDING"
      }
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

employeeRouter.patch("/:id/settlement", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (req.user!.role !== Role.SUPER_ADMIN && !req.user!.companyId) {
      throw new ApiError(400, "Company context required");
    }
    const body = z.object({
      settlementStatus: z.enum(["PENDING", "SETTLED"])
    }).parse(req.body);

    const employee = await prisma.employee.findFirst({
      where: req.user!.role === Role.SUPER_ADMIN ? { id: req.params.id } : { id: req.params.id, companyId: req.user!.companyId || undefined }
    });
    if (!employee) throw new ApiError(404, "Employee not found");

    const updated = await prisma.employee.update({
      where: { id: employee.id },
      data: {
        settlementStatus: body.settlementStatus
      }
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});
