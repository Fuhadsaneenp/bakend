import bcrypt from "bcryptjs";
import { LetterType, Prisma, Role } from "@prisma/client";
import { queueEmployeeDeviceSync, queueEmployeeTemplateDownload, queueEmployeeTemplateSync } from "../../lib/biometricDeviceSync.js";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";
import { storageService } from "../../storage/storage.service.js";
import type { AuthUser } from "../../middleware/auth.js";
import { renderEmployeeLetterPdf } from "./employee-letter.pdf.js";

const nextEmployeeCode = async (companyId: string) => {
  const count = await prisma.employee.count({ where: { companyId } });
  return `EMP-${String(count + 1).padStart(5, "0")}`;
};

const isHrRole = (role: Role) => role === Role.SUPER_ADMIN || role === Role.HR_ADMIN;
const sanitizeFileName = (fileName: string) => {
  const baseName = fileName.split(/[\\/]/).pop() || "document";
  return baseName
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120) || "document";
};

const employeeProfileFields = {
  user: true,
  company: true,
  department: true,
  designation: true,
  manager: { include: { documents: true } },
  salary: true,
  shift: true,
  documents: { orderBy: { uploadedAt: "desc" as const } },
  letters: { orderBy: { issuedAt: "desc" as const } }
};

const employeeOperationalFields = {
  user: true,
  company: true,
  department: true,
  designation: true,
  manager: { include: { documents: true } }
};

const defaultLetterTitle = (type: LetterType) => {
  const titleMap: Record<LetterType, string> = {
    OFFER: "Offer Letter",
    EXPERIENCE: "Experience Letter",
    RELIEVING: "Relieving Letter",
    CONFIRMATION: "Confirmation Letter",
    CUSTOM: "Employee Letter"
  };
  return titleMap[type];
};

const defaultLetterBody = (type: LetterType, employeeName: string) => {
  switch (type) {
    case LetterType.OFFER:
      return `Dear ${employeeName},\n\nWe are pleased to offer you employment with our organization. This letter confirms our intent to welcome you as part of the team, subject to completion of the onboarding formalities.\n\nWe look forward to working with you.`;
    case LetterType.EXPERIENCE:
      return `This is to certify that ${employeeName} was employed with our organization and has carried out assigned responsibilities during the tenure of employment.\n\nWe wish ${employeeName} success in future endeavors.`;
    case LetterType.RELIEVING:
      return `This is to confirm that ${employeeName} has been relieved from duties with our organization after completion of applicable exit formalities.\n\nWe wish ${employeeName} all the best.`;
    case LetterType.CONFIRMATION:
      return `Dear ${employeeName},\n\nWe are pleased to confirm your employment following successful completion of the applicable review period.\n\nWe appreciate your contribution and look forward to your continued success.`;
    default:
      return `Dear ${employeeName},\n\nThis letter has been generated from the HR management system.`;
  }
};

export const employeeService = {
  list(companyId: string) {
    return prisma.employee.findMany({
      where: { companyId },
      include: employeeProfileFields,
      orderBy: { createdAt: "desc" }
    });
  },

  async listForUser(user: AuthUser) {
    if (user.role === Role.SUPER_ADMIN) {
      return prisma.employee.findMany({
        include: employeeProfileFields,
        orderBy: { createdAt: "desc" }
      });
    }

    if (!user.companyId) return [];

    if (isHrRole(user.role)) {
      return this.list(user.companyId);
    }

    const currentEmployee = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!currentEmployee) return [];

    if (user.role === Role.MANAGER || user.role === Role.EMPLOYEE) {
      return prisma.employee.findMany({
        where: { companyId: user.companyId },
        include: employeeOperationalFields,
        orderBy: { createdAt: "desc" }
      });
    }
    return [];
  },

  async onboard(companyId: string, data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    personalEmail?: string;
    dateOfJoining: string;
    departmentId?: string;
    designationId?: string;
    managerId?: string;
    role?: Role;
    isHrHead?: boolean;
    biometricId?: string;
    employeeCode?: string;
    shiftId?: string;
    officeId?: string;
    dateOfBirth?: string;
    gender?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    bankName?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
    taxId?: string;
    salary?: { basic: number; allowances: number; deductions: number; effectiveFrom: string };
  }) {
    const createdEmployee = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          companyId,
          email: data.email.toLowerCase(),
          passwordHash: await bcrypt.hash(data.password, 12),
          role: data.role ?? Role.EMPLOYEE
        }
      });

      const employee = await tx.employee.create({
        data: {
          companyId,
          userId: user.id,
          employeeCode: data.employeeCode || await nextEmployeeCode(companyId),
          biometricId: data.biometricId || null,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          personalEmail: data.personalEmail,
          dateOfJoining: new Date(data.dateOfJoining),
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
          gender: data.gender,
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2,
          city: data.city,
          state: data.state,
          country: data.country,
          postalCode: data.postalCode,
          emergencyContactName: data.emergencyContactName,
          emergencyContactPhone: data.emergencyContactPhone,
          bankName: data.bankName,
          bankAccountNumber: data.bankAccountNumber,
          bankIfsc: data.bankIfsc,
          taxId: data.taxId,
          departmentId: data.departmentId,
          designationId: data.designationId,
          managerId: data.managerId,
          isHrHead: Boolean(data.isHrHead),
          shiftId: data.shiftId || null,
          officeId: data.officeId || null
        } as any
      });

      if (data.salary) {
        await tx.salary.create({
          data: {
            employeeId: employee.id,
            basic: new Prisma.Decimal(data.salary.basic),
            allowances: new Prisma.Decimal(data.salary.allowances),
            deductions: new Prisma.Decimal(data.salary.deductions),
            effectiveFrom: new Date(data.salary.effectiveFrom)
          }
        });
      }

      return tx.employee.findUniqueOrThrow({ where: { id: employee.id }, include: employeeProfileFields });
    });

    await queueEmployeeDeviceSync(createdEmployee, "UPSERT_USER");
    await queueEmployeeTemplateSync(createdEmployee);
    return createdEmployee;
  },

  async updateStatus(user: AuthUser, employeeId: string, status: "ACTIVE" | "INACTIVE" | "TERMINATED") {
    const employee = await prisma.employee.findFirst({
      where: user.role === Role.SUPER_ADMIN ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined }
    });
    if (!employee) throw notFound("Employee");
    const updatedEmployee = await prisma.employee.update({ where: { id: employeeId }, data: { status } });
    await queueEmployeeDeviceSync(updatedEmployee, "UPSERT_USER");
    return updatedEmployee;
  },

   async update(user: AuthUser, id: string, data: {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    personalEmail?: string | null;
    companyId?: string | null;
    departmentId?: string | null;
    designationId?: string | null;
    managerId?: string | null;
    role?: Role;
    isHrHead?: boolean;
    dateOfJoining?: string;
    biometricId?: string | null;
    employeeCode?: string;
    shiftId?: string | null;
    officeId?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postalCode?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    taxId?: string | null;
    salary?: { basic: number; allowances: number; deductions: number; effectiveFrom: string };
  }) {
    const employee = await prisma.employee.findFirst({
      where: user.role === Role.SUPER_ADMIN ? { id } : { id, companyId: user.companyId || undefined }
    });
    if (!employee) throw notFound("Employee not found");

    const updatedEmployee = await prisma.$transaction(async (tx) => {
      const userUpdateData: any = {};
      if (data.role) userUpdateData.role = data.role;
      if (data.email) userUpdateData.email = data.email.toLowerCase();
      if (data.password) userUpdateData.passwordHash = await bcrypt.hash(data.password, 12);
      if (data.companyId) {
        userUpdateData.companyId = data.companyId;
      }

      if (Object.keys(userUpdateData).length > 0) {
        await tx.user.update({
          where: { id: employee.userId },
          data: userUpdateData
        });
      }

      const updatedEmp = await tx.employee.update({
        where: { id },
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          personalEmail: data.personalEmail,
          companyId: data.companyId ? data.companyId : undefined,
          departmentId: data.departmentId,
          designationId: data.designationId,
          managerId: data.managerId,
          isHrHead: typeof data.isHrHead === "boolean" ? data.isHrHead : undefined,
          dateOfJoining: data.dateOfJoining ? new Date(data.dateOfJoining) : undefined,
          biometricId: data.biometricId,
          employeeCode: data.employeeCode,
          shiftId: data.shiftId,
          officeId: data.officeId,
          dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : data.dateOfBirth,
          gender: data.gender,
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2,
          city: data.city,
          state: data.state,
          country: data.country,
          postalCode: data.postalCode,
          emergencyContactName: data.emergencyContactName,
          emergencyContactPhone: data.emergencyContactPhone,
          bankName: data.bankName,
          bankAccountNumber: data.bankAccountNumber,
          bankIfsc: data.bankIfsc,
          taxId: data.taxId
        } as any,
        include: employeeProfileFields
      });

      if (data.salary) {
        await tx.salary.upsert({
          where: { employeeId: id },
          create: {
            employeeId: id,
            basic: new Prisma.Decimal(data.salary.basic),
            allowances: new Prisma.Decimal(data.salary.allowances),
            deductions: new Prisma.Decimal(data.salary.deductions),
            effectiveFrom: new Date(data.salary.effectiveFrom)
          },
          update: {
            basic: new Prisma.Decimal(data.salary.basic),
            allowances: new Prisma.Decimal(data.salary.allowances),
            deductions: new Prisma.Decimal(data.salary.deductions),
            effectiveFrom: new Date(data.salary.effectiveFrom)
          }
        });
      }

      return updatedEmp;
    });

    await queueEmployeeDeviceSync(updatedEmployee, "UPSERT_USER");
    await queueEmployeeTemplateSync(updatedEmployee);
    return updatedEmployee;
  },

  async assertSelfOrHr(user: AuthUser, employeeId: string) {
    if (user.role === Role.SUPER_ADMIN) {
      const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
      if (!employee) throw notFound("Employee");
      return employee;
    }
    if (!user.companyId) throw new ApiError(400, "Company context required");
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId: user.companyId } });
    if (!employee) throw notFound("Employee");
    if (isHrRole(user.role) || employee.userId === user.id) return employee;
    throw new ApiError(403, "Insufficient permissions");
  },

  async updateOnboardingStatus(employeeId: string) {
    const documents = await prisma.employeeDocument.findMany({ where: { employeeId } });
    const verifiedCount = documents.filter((document) => document.status === "VERIFIED").length;
    const onboardingStatus = verifiedCount >= 3
      ? "COMPLETED"
      : documents.length > 0
        ? "IN_PROGRESS"
        : "NOT_STARTED";

    await prisma.employee.update({ where: { id: employeeId }, data: { onboardingStatus } });
  },

  async attachDocument(user: AuthUser, employeeId: string, file: Express.Multer.File, type: string, notes?: string) {
    const employee = await this.assertSelfOrHr(user, employeeId);
    if (type === "PHOTO" && file.size > 150 * 1024) {
      throw new ApiError(400, "Employee photo must be below 150 KB");
    }
    const safeFileName = sanitizeFileName(file.originalname);
    const key = `companies/${employee.companyId}/employees/${employeeId}/documents/${Date.now()}-${safeFileName}`;
    await storageService.putObject(key, file.buffer, file.mimetype);
    const document = await prisma.employeeDocument.create({
      data: {
        employeeId,
        type,
        fileKey: key,
        fileName: safeFileName,
        mimeType: file.mimetype,
        uploadedBy: user.id,
        notes
      }
    });
    await this.updateOnboardingStatus(employeeId);
    return { ...document, fileUrl: storageService.publicUrl(document.fileKey) };
  },

  async listDocumentsForUser(user: AuthUser, employeeId: string) {
    await this.assertSelfOrHr(user, employeeId);
    const documents = await prisma.employeeDocument.findMany({
      where: { employeeId },
      orderBy: { uploadedAt: "desc" }
    });
    return documents.map((document) => ({ ...document, fileUrl: storageService.publicUrl(document.fileKey) }));
  },

  async verifyDocument(user: AuthUser, documentId: string, status: "UPLOADED" | "VERIFIED" | "REJECTED", notes?: string) {
    if (!isHrRole(user.role)) throw new ApiError(403, "Insufficient permissions");
    if (user.role !== Role.SUPER_ADMIN && !user.companyId) throw new ApiError(403, "Insufficient permissions");
    const document = await prisma.employeeDocument.findFirst({
      where: user.role === Role.SUPER_ADMIN ? { id: documentId } : { id: documentId, employee: { companyId: user.companyId || undefined } }
    });
    if (!document) throw notFound("Document");

    const updated = await prisma.employeeDocument.update({
      where: { id: documentId },
      data: {
        status,
        notes,
        verifiedBy: status === "VERIFIED" ? user.id : null,
        verifiedAt: status === "VERIFIED" ? new Date() : null
      }
    });
    await this.updateOnboardingStatus(updated.employeeId);
    return { ...updated, fileUrl: storageService.publicUrl(updated.fileKey) };
  },

  async deleteDocument(user: AuthUser, documentId: string) {
    if (!isHrRole(user.role)) throw new ApiError(403, "Insufficient permissions");
    if (user.role !== Role.SUPER_ADMIN && !user.companyId) throw new ApiError(403, "Insufficient permissions");
    const document = await prisma.employeeDocument.findFirst({
      where: user.role === Role.SUPER_ADMIN ? { id: documentId } : { id: documentId, employee: { companyId: user.companyId || undefined } }
    });
    if (!document) throw notFound("Document");

    await prisma.employeeDocument.delete({ where: { id: documentId } });
    await this.updateOnboardingStatus(document.employeeId);
    return { ok: true };
  },

  async deleteEmployee(user: AuthUser, employeeId: string, confirmation: string) {
    if (confirmation !== "CONFIRM") throw new ApiError(400, "Type CONFIRM to delete this employee");
    const employee = await prisma.employee.findFirst({
      where: user.role === Role.SUPER_ADMIN ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined }
    });
    if (!employee) throw notFound("Employee");

    const result = await prisma.$transaction(async (tx) => {
      await tx.employee.updateMany({ where: { managerId: employeeId }, data: { managerId: null } });
      await tx.client.updateMany({ where: { accountManagerId: employeeId }, data: { accountManagerId: null } });
      await tx.workCard.updateMany({ where: { assignedToId: employeeId }, data: { assignedToId: null } });
      await tx.workCard.updateMany({ where: { assignedById: employeeId }, data: { assignedById: null } });
      await tx.reworkLog.updateMany({ where: { chargedToId: employeeId }, data: { chargedToId: null } });
      await tx.rating.updateMany({ where: { ratedById: employeeId }, data: { ratedById: null } });
      await tx.pointsLedger.deleteMany({ where: { employeeId } });
      await tx.employeeDocument.deleteMany({ where: { employeeId } });
      await tx.employeeLetter.deleteMany({ where: { employeeId } });
      await tx.salary.deleteMany({ where: { employeeId } });
      await tx.attendance.deleteMany({ where: { employeeId } });
      await tx.wFHRequest.deleteMany({ where: { employeeId } });
      await tx.expenseClaim.deleteMany({ where: { employeeId } });
      await tx.payslip.deleteMany({ where: { employeeId } });
      await tx.employee.delete({ where: { id: employeeId } });
      await tx.auditLog.updateMany({ where: { actorUserId: employee.userId }, data: { actorUserId: null } });
      await tx.notification.updateMany({ where: { userId: employee.userId }, data: { userId: null } });
      await tx.statusHistory.deleteMany({ where: { userId: employee.userId } });
      await tx.comment.deleteMany({ where: { userId: employee.userId } });
      await tx.user.delete({ where: { id: employee.userId } });
      return { ok: true };
    });

    await queueEmployeeDeviceSync({
      id: employee.id,
      employeeCode: employee.employeeCode,
      biometricId: employee.biometricId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      status: employee.status
    }, "DELETE_USER");
    return result;
  },

  async queueDeviceSync(user: AuthUser, employeeId: string) {
    const employee = await prisma.employee.findFirst({
      where: user.role === Role.SUPER_ADMIN ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined }
    });
    if (!employee) throw notFound("Employee");

    await queueEmployeeDeviceSync({
      id: employee.id,
      employeeCode: employee.employeeCode,
      biometricId: employee.biometricId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      status: employee.status
    }, "UPSERT_USER");
    await queueEmployeeTemplateSync({
      id: employee.id,
      employeeCode: employee.employeeCode,
      biometricId: employee.biometricId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      status: employee.status
    });

    return { ok: true, message: "Employee queued for machine sync" };
  },

  async queueDeviceTemplateDownload(user: AuthUser, employeeId: string) {
    const employee = await prisma.employee.findFirst({
      where: user.role === Role.SUPER_ADMIN ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined }
    });
    if (!employee) throw notFound("Employee");

    await queueEmployeeTemplateDownload({
      id: employee.id,
      employeeCode: employee.employeeCode,
      biometricId: employee.biometricId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      status: employee.status
    });

    return { ok: true, message: "Fingerprint download request queued for machine sync" };
  },

  async listLettersForUser(user: AuthUser, employeeId: string) {
    await this.assertSelfOrHr(user, employeeId);
    const letters = await prisma.employeeLetter.findMany({
      where: { employeeId },
      orderBy: { issuedAt: "desc" }
    });
    return letters.map((letter) => ({ ...letter, fileUrl: letter.fileKey ? storageService.publicUrl(letter.fileKey) : null }));
  },

  async generateLetter(user: AuthUser, employeeId: string, userId: string, data: { type: LetterType; title?: string; body?: string }) {
    const employee = await prisma.employee.findFirst({
      where: user.role === Role.SUPER_ADMIN ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined },
      include: { company: true }
    });
    if (!employee) throw notFound("Employee");

    const employeeName = `${employee.firstName} ${employee.lastName}`;
    const title = data.title || defaultLetterTitle(data.type);
    const body = data.body || defaultLetterBody(data.type, employeeName);

    const letter = await prisma.employeeLetter.create({
      data: {
        employeeId,
        type: data.type,
        title,
        body,
        generatedBy: userId
      }
    });

    const pdf = await renderEmployeeLetterPdf({
      companyName: (employee as any).company.name,
      employeeName,
      employeeCode: employee.employeeCode,
      title,
      body,
      issuedAt: letter.issuedAt
    });

    const targetCompanyId = employee.companyId;
    const key = `companies/${targetCompanyId}/employees/${employeeId}/letters/${letter.id}.pdf`;
    await storageService.putObject(key, pdf, "application/pdf");
    const updated = await prisma.employeeLetter.update({ where: { id: letter.id }, data: { fileKey: key } });

    return { ...updated, fileUrl: storageService.publicUrl(key) };
  },

  async getByUserId(userId: string) {
    return prisma.employee.findUnique({
      where: { userId },
      include: employeeProfileFields
    });
  },

  async updateProfile(userId: string, data: {
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    personalEmail?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    postalCode?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    taxId?: string | null;
  }) {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw notFound("Employee not found");

    return prisma.employee.update({
      where: { id: employee.id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        personalEmail: data.personalEmail,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : data.dateOfBirth,
        gender: data.gender,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        state: data.state,
        country: data.country,
        postalCode: data.postalCode,
        emergencyContactName: data.emergencyContactName,
        emergencyContactPhone: data.emergencyContactPhone,
        bankName: data.bankName,
        bankAccountNumber: data.bankAccountNumber,
        bankIfsc: data.bankIfsc,
        taxId: data.taxId
      },
      include: employeeProfileFields
    });
  }
};
