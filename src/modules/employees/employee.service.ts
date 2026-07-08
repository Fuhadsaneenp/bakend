import bcrypt from "bcryptjs";
import { LetterType, Prisma, Role } from "@prisma/client";
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

const employeeProfileFields = {
  user: true,
  department: true,
  designation: true,
  salary: true,
  documents: { orderBy: { uploadedAt: "desc" as const } },
  letters: { orderBy: { issuedAt: "desc" as const } }
};

const employeeOperationalFields = {
  user: true,
  department: true,
  designation: true
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
    if (!user.companyId) return [];

    if (isHrRole(user.role)) {
      return this.list(user.companyId);
    }

    const currentEmployee = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!currentEmployee) return [];

    if (user.role === Role.MANAGER) {
      return prisma.employee.findMany({
        where: { companyId: user.companyId, managerId: currentEmployee.id },
        include: employeeOperationalFields,
        orderBy: { createdAt: "desc" }
      });
    }

    return prisma.employee.findMany({
      where: { companyId: user.companyId, userId: user.id },
      include: { ...employeeOperationalFields, documents: { orderBy: { uploadedAt: "desc" } }, letters: { orderBy: { issuedAt: "desc" } } },
      orderBy: { createdAt: "desc" }
    });
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
    biometricId?: string;
    employeeCode?: string;
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
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          companyId,
          email: data.email,
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
          managerId: data.managerId
        }
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
  },

  async updateStatus(companyId: string, employeeId: string, status: "ACTIVE" | "INACTIVE" | "TERMINATED") {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw notFound("Employee");
    return prisma.employee.update({ where: { id: employeeId }, data: { status } });
  },

  async update(companyId: string, id: string, data: {
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    personalEmail?: string | null;
    departmentId?: string | null;
    designationId?: string | null;
    managerId?: string | null;
    role?: Role;
    biometricId?: string | null;
    employeeCode?: string;
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
      where: { id, companyId }
    });
    if (!employee) throw notFound("Employee not found");

    return prisma.$transaction(async (tx) => {
      if (data.role) {
        await tx.user.update({
          where: { id: employee.userId },
          data: { role: data.role }
        });
      }

      const updatedEmp = await tx.employee.update({
        where: { id },
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          personalEmail: data.personalEmail,
          departmentId: data.departmentId,
          designationId: data.designationId,
          managerId: data.managerId,
          biometricId: data.biometricId,
          employeeCode: data.employeeCode,
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
  },

  async assertSelfOrHr(user: AuthUser, employeeId: string) {
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
    const key = `companies/${employee.companyId}/employees/${employeeId}/documents/${Date.now()}-${file.originalname}`;
    await storageService.putObject(key, file.buffer, file.mimetype);
    const document = await prisma.employeeDocument.create({
      data: {
        employeeId,
        type,
        fileKey: key,
        fileName: file.originalname,
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
    if (!isHrRole(user.role) || !user.companyId) throw new ApiError(403, "Insufficient permissions");
    const document = await prisma.employeeDocument.findFirst({
      where: { id: documentId, employee: { companyId: user.companyId } }
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
    if (!isHrRole(user.role) || !user.companyId) throw new ApiError(403, "Insufficient permissions");
    const document = await prisma.employeeDocument.findFirst({
      where: { id: documentId, employee: { companyId: user.companyId } }
    });
    if (!document) throw notFound("Document");

    await prisma.employeeDocument.delete({ where: { id: documentId } });
    await this.updateOnboardingStatus(document.employeeId);
    return { ok: true };
  },

  async deleteEmployee(companyId: string, employeeId: string, confirmation: string) {
    if (confirmation !== "CONFIRM") throw new ApiError(400, "Type CONFIRM to delete this employee");
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw notFound("Employee");

    return prisma.$transaction(async (tx) => {
      await tx.employee.updateMany({ where: { managerId: employeeId }, data: { managerId: null } });
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
      await tx.user.delete({ where: { id: employee.userId } });
      return { ok: true };
    });
  },

  async listLettersForUser(user: AuthUser, employeeId: string) {
    await this.assertSelfOrHr(user, employeeId);
    const letters = await prisma.employeeLetter.findMany({
      where: { employeeId },
      orderBy: { issuedAt: "desc" }
    });
    return letters.map((letter) => ({ ...letter, fileUrl: letter.fileKey ? storageService.publicUrl(letter.fileKey) : null }));
  },

  async generateLetter(companyId: string, employeeId: string, userId: string, data: { type: LetterType; title?: string; body?: string }) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId },
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
      companyName: employee.company.name,
      employeeName,
      employeeCode: employee.employeeCode,
      title,
      body,
      issuedAt: letter.issuedAt
    });

    const key = `companies/${companyId}/employees/${employeeId}/letters/${letter.id}.pdf`;
    await storageService.putObject(key, pdf, "application/pdf");
    const updated = await prisma.employeeLetter.update({ where: { id: letter.id }, data: { fileKey: key } });

    return { ...updated, fileUrl: storageService.publicUrl(key) };
  }
};
