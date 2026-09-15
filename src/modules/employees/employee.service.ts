import bcrypt from "bcryptjs";
import { LetterType, Prisma, Role } from "@prisma/client";
import { queueEmployeeDeviceSync, queueEmployeeTemplateDownload, queueEmployeeTemplateSync } from "../../lib/biometricDeviceSync.js";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";
import { storageService } from "../../storage/storage.service.js";
import type { AuthUser } from "../../middleware/auth.js";
import { renderEmployeeLetterPdf } from "./employee-letter.pdf.js";
import { getKolkataStartOfDay } from "../attendance/attendance.service.js";
import { isCoreTeamEmployee, isRequesterCoreTeam, isHrEmployee, isRequesterHr } from "../../lib/coreTeam.js";

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

const employeeDocumentFields = {
  id: true,
  employeeId: true,
  type: true,
  status: true,
  fileKey: true,
  fileName: true,
  mimeType: true,
  storedInDatabase: true,
  uploadedBy: true,
  verifiedAt: true,
  verifiedBy: true,
  notes: true,
  uploadedAt: true
};

const employeeLetterFields = {
  id: true,
  employeeId: true,
  type: true,
  title: true,
  body: true,
  fileKey: true,
  storedInDatabase: true,
  generatedBy: true,
  issuedAt: true,
  createdAt: true
};

const employeeProfileFields = {
  user: true,
  company: true,
  department: true,
  designation: true,
  manager: { include: { documents: { select: employeeDocumentFields } } },
  salary: true,
  salaryHistory: { orderBy: { effectiveFrom: "desc" as const } },
  shift: true,
  documents: { select: employeeDocumentFields, orderBy: { uploadedAt: "desc" as const } },
  letters: { select: employeeLetterFields, orderBy: { issuedAt: "desc" as const } }
};

const employeeOperationalFields = {
  user: true,
  company: true,
  department: true,
  designation: true,
  manager: { include: { documents: { select: employeeDocumentFields } } }
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
  list(companyId?: string) {
    const todayKolkataStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const todayUtc = new Date(todayKolkataStr);
    const todayStart = getKolkataStartOfDay(new Date());

    return prisma.employee.findMany({
      where: companyId ? { companyId } : undefined,
      include: {
        ...employeeProfileFields,
        attendance: {
          where: { workDate: todayStart },
          take: 1
        },
        wfhRequests: {
          where: {
            status: "APPROVED",
            startDate: { lte: todayUtc },
            endDate: { gte: todayUtc }
          },
          take: 1
        }
      },
      orderBy: [{ employeeCode: "asc" }, { createdAt: "asc" }]
    });
  },

  async listForUser(user: AuthUser, requestedCompanyId?: string) {
    const currentEmployee = await prisma.employee.findUnique({
      where: { userId: user.id },
      include: { department: true, designation: true, user: true }
    });
    const isHr = await isRequesterHr(user);
    const isAdminScope = isHr;

    const targetCompanyId = isHr
      ? (requestedCompanyId || undefined)
      : (requestedCompanyId || user.companyId || undefined);

    if (isAdminScope) {
      const where = targetCompanyId ? { companyId: targetCompanyId } : undefined;
      const todayKolkataStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      const todayUtc = new Date(todayKolkataStr);
      const todayStart = getKolkataStartOfDay(new Date());

      const list = await prisma.employee.findMany({
        where,
        include: {
          ...employeeProfileFields,
          attendance: {
            where: { workDate: todayStart },
            take: 1
          },
          wfhRequests: {
            where: {
              status: "APPROVED",
              startDate: { lte: todayUtc },
              endDate: { gte: todayUtc }
            },
            take: 1
          }
        },
        orderBy: [{ employeeCode: "asc" }, { createdAt: "asc" }]
      });

      const userIsCoreTeam = isCoreTeamEmployee(currentEmployee) || user.role === Role.SUPER_ADMIN;

      if (!userIsCoreTeam) {
        return list.map((emp) => {
          if (isCoreTeamEmployee(emp) && emp.userId !== user.id) {
            return {
              ...emp,
              salary: null,
              salaryHistory: []
            };
          }
          return emp;
        });
      }

      return list;
    }

    if (!targetCompanyId) return [];
    if (!currentEmployee) return [];

    if (user.role === Role.MANAGER || user.role === Role.EMPLOYEE) {
      const todayKolkataStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      const todayUtc = new Date(todayKolkataStr);
      const todayStart = getKolkataStartOfDay(new Date());

      const list = await prisma.employee.findMany({
        where: { companyId: targetCompanyId },
        include: {
          ...employeeOperationalFields,
          salary: true,
          attendance: {
            where: { workDate: todayStart },
            take: 1
          },
          wfhRequests: {
            where: {
              status: "APPROVED",
              startDate: { lte: todayUtc },
              endDate: { gte: todayUtc }
            },
            take: 1
          }
        },
        orderBy: [{ employeeCode: "asc" }, { createdAt: "asc" }]
      });

      return list.map((emp) => {
        if (emp.userId === user.id) {
          return emp;
        }
        return {
          ...emp,
          salary: null,
          dateOfBirth: null,
          taxId: null
        };
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
      const resolvedEmployeeCode = data.employeeCode?.trim() || await nextEmployeeCode(companyId);
      const superAdminCount = await tx.user.count({
        where: { role: Role.SUPER_ADMIN }
      });

      let finalRole = data.role ?? Role.EMPLOYEE;
      if (superAdminCount === 0 && (finalRole === Role.HR_ADMIN || finalRole === Role.SUPER_ADMIN)) {
        finalRole = Role.SUPER_ADMIN;
      }

      const user = await tx.user.create({
        data: {
          companyId,
          email: data.email.toLowerCase(),
          passwordHash: await bcrypt.hash(data.password, 12),
          role: finalRole
        }
      });

      const employee = await tx.employee.create({
        data: {
          companyId,
          userId: user.id,
          firstName: data.firstName,
          middleName: (data as any).middleName || null,
          lastName: data.lastName,
          displayName: (data as any).displayName || null,
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
          employeeCode: resolvedEmployeeCode,
          biometricId: data.biometricId || null,
          isHrHead: Boolean(data.isHrHead),
          customAttendanceHoursEnabled: Boolean((data as any).customAttendanceHoursEnabled),
          customFullDayHours: (data as any).customFullDayHours != null ? new Prisma.Decimal((data as any).customFullDayHours) : null,
          customHalfDayHours: (data as any).customHalfDayHours != null ? new Prisma.Decimal((data as any).customHalfDayHours) : null,
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
        await tx.salaryHistory.create({
          data: {
            employeeId: employee.id,
            basic: new Prisma.Decimal(data.salary.basic),
            allowances: new Prisma.Decimal(data.salary.allowances),
            deductions: new Prisma.Decimal(data.salary.deductions),
            effectiveFrom: new Date(data.salary.effectiveFrom),
            notes: "Initial salary on onboarding"
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
    const isFullAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN;
    const employee = await prisma.employee.findFirst({
      where: isFullAdmin ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined }
    });
    if (!employee) throw notFound("Employee");
    const updatedEmployee = await prisma.employee.update({ where: { id: employeeId }, data: { status } });
    if (employee.userId) {
      await prisma.user.update({
        where: { id: employee.userId },
        data: {
          isActive: status === "ACTIVE",
          refreshHash: status === "ACTIVE" ? undefined : null
        }
      }).catch((e) => console.warn(`[Employee Status] Failed to sync user status:`, e));
    }
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
    customAttendanceHoursEnabled?: boolean | null;
    customFullDayHours?: number | null;
    customHalfDayHours?: number | null;
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
    const requesterIsHr = await isRequesterHr(user);
    const employee = await prisma.employee.findFirst({
      where: requesterIsHr ? { id } : { id, companyId: user.companyId || undefined },
      include: { department: true, designation: true, user: true }
    });
    if (!employee) throw notFound("Employee not found");

    if (data.salary) {
      if (!requesterIsHr) {
        throw new ApiError(403, "Insufficient permissions to modify salary");
      }
      const userIsCoreTeam = await isRequesterCoreTeam(user);
      const targetIsCoreTeam = isCoreTeamEmployee(employee);
      if (targetIsCoreTeam && !userIsCoreTeam && employee.userId !== user.id) {
        throw new ApiError(403, "Only Core Team members can modify Core Team salary");
      }
    }

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
          middleName: (data as any).middleName !== undefined ? (data as any).middleName : undefined,
          lastName: data.lastName,
          displayName: (data as any).displayName !== undefined ? (data as any).displayName : undefined,
          phone: data.phone,
          personalEmail: data.personalEmail,
          companyId: data.companyId ? data.companyId : undefined,
          departmentId: data.departmentId,
          designationId: data.designationId,
          managerId: data.managerId,
          isHrHead: typeof data.isHrHead === "boolean" ? data.isHrHead : undefined,
          customAttendanceHoursEnabled: typeof (data as any).customAttendanceHoursEnabled === "boolean" ? (data as any).customAttendanceHoursEnabled : undefined,
          customFullDayHours: (data as any).customFullDayHours !== undefined ? ((data as any).customFullDayHours != null ? new Prisma.Decimal((data as any).customFullDayHours) : null) : undefined,
          customHalfDayHours: (data as any).customHalfDayHours !== undefined ? ((data as any).customHalfDayHours != null ? new Prisma.Decimal((data as any).customHalfDayHours) : null) : undefined,
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
        const effectiveDate = new Date(data.salary.effectiveFrom);
        const existingSalary = await tx.salary.findUnique({ where: { employeeId: id } });
        const existingHistoryCount = await tx.salaryHistory.count({ where: { employeeId: id } });

        // If no history exists yet but there was an existing salary, preserve initial record
        if (existingHistoryCount === 0 && existingSalary) {
          await tx.salaryHistory.create({
            data: {
              employeeId: id,
              basic: existingSalary.basic,
              allowances: existingSalary.allowances,
              deductions: existingSalary.deductions,
              effectiveFrom: existingSalary.effectiveFrom,
              notes: "Initial recorded salary"
            }
          });
        }

        const existingForSameDate = await tx.salaryHistory.findFirst({
          where: { employeeId: id, effectiveFrom: effectiveDate }
        });

        if (existingForSameDate) {
          await tx.salaryHistory.update({
            where: { id: existingForSameDate.id },
            data: {
              basic: new Prisma.Decimal(data.salary.basic),
              allowances: new Prisma.Decimal(data.salary.allowances),
              deductions: new Prisma.Decimal(data.salary.deductions)
            }
          });
        } else {
          await tx.salaryHistory.create({
            data: {
              employeeId: id,
              basic: new Prisma.Decimal(data.salary.basic),
              allowances: new Prisma.Decimal(data.salary.allowances),
              deductions: new Prisma.Decimal(data.salary.deductions),
              effectiveFrom: effectiveDate,
              notes: (data.salary as any).notes || "Salary revision"
            }
          });
        }

        // Keep current salary table synchronized to the latest effective salary
        const latestHistory = await tx.salaryHistory.findFirst({
          where: { employeeId: id },
          orderBy: { effectiveFrom: "desc" }
        });

        const activeBasic = latestHistory ? latestHistory.basic : new Prisma.Decimal(data.salary.basic);
        const activeAllowances = latestHistory ? latestHistory.allowances : new Prisma.Decimal(data.salary.allowances);
        const activeDeductions = latestHistory ? latestHistory.deductions : new Prisma.Decimal(data.salary.deductions);
        const activeEffectiveFrom = latestHistory ? latestHistory.effectiveFrom : effectiveDate;

        await tx.salary.upsert({
          where: { employeeId: id },
          create: {
            employeeId: id,
            basic: activeBasic,
            allowances: activeAllowances,
            deductions: activeDeductions,
            effectiveFrom: activeEffectiveFrom
          },
          update: {
            basic: activeBasic,
            allowances: activeAllowances,
            deductions: activeDeductions,
            effectiveFrom: activeEffectiveFrom
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
    const requesterIsHr = await isRequesterHr(user);
    if (requesterIsHr) {
      const isSuperAdmin = user.role === Role.SUPER_ADMIN;
      const employee = await prisma.employee.findFirst({
        where: isSuperAdmin ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined }
      });
      if (!employee) throw notFound("Employee");
      return employee;
    }
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, userId: user.id } });
    if (!employee) throw new ApiError(403, "Insufficient permissions");
    return employee;
  },

  async updateOnboardingStatus(employeeId: string) {
    const documents = await prisma.employeeDocument.findMany({ where: { employeeId }, select: { status: true } });
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
    const document = await prisma.employeeDocument.create({
      data: {
        employeeId,
        type,
        fileKey: key,
        fileName: safeFileName,
        mimeType: file.mimetype,
        fileData: Uint8Array.from(file.buffer),
        storedInDatabase: true,
        uploadedBy: user.id,
        notes
      },
      select: employeeDocumentFields
    });
    await this.updateOnboardingStatus(employeeId);
    return { ...document, fileUrl: storageService.publicUrl(document.fileKey) };
  },

  async listDocumentsForUser(user: AuthUser, employeeId: string) {
    await this.assertSelfOrHr(user, employeeId);
    const documents = await prisma.employeeDocument.findMany({
      where: { employeeId },
      select: employeeDocumentFields,
      orderBy: { uploadedAt: "desc" }
    });
    return documents.map((document) => ({ ...document, fileUrl: storageService.publicUrl(document.fileKey) }));
  },

  async verifyDocument(user: AuthUser, documentId: string, status: "UPLOADED" | "VERIFIED" | "REJECTED", notes?: string) {
    const requesterIsHr = await isRequesterHr(user);
    if (!requesterIsHr) throw new ApiError(403, "Insufficient permissions");
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    const document = await prisma.employeeDocument.findFirst({
      where: isSuperAdmin ? { id: documentId } : { id: documentId, employee: { companyId: user.companyId || undefined } }
    });
    if (!document) throw notFound("Document");

    const updated = await prisma.employeeDocument.update({
      where: { id: documentId },
      data: {
        status,
        notes,
        verifiedBy: status === "VERIFIED" ? user.id : null,
        verifiedAt: status === "VERIFIED" ? new Date() : null
      },
      select: employeeDocumentFields
    });
    await this.updateOnboardingStatus(updated.employeeId);
    return { ...updated, fileUrl: storageService.publicUrl(updated.fileKey) };
  },

  async deleteDocument(user: AuthUser, documentId: string) {
    const requesterIsHr = await isRequesterHr(user);
    if (!requesterIsHr) throw new ApiError(403, "Insufficient permissions");
    const isSuperAdmin = user.role === Role.SUPER_ADMIN;
    const document = await prisma.employeeDocument.findFirst({
      where: isSuperAdmin ? { id: documentId } : { id: documentId, employee: { companyId: user.companyId || undefined } }
    });
    if (!document) throw notFound("Document");

    await prisma.employeeDocument.delete({ where: { id: documentId } });
    await this.updateOnboardingStatus(document.employeeId);
  },

  async deleteEmployee(user: AuthUser, employeeId: string, confirmation: string) {
    if (confirmation !== "CONFIRM") throw new ApiError(400, "Type CONFIRM to delete this employee");
    const isFullAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN;
    const employee = await prisma.employee.findFirst({
      where: isFullAdmin ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined }
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
    const isFullAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN;
    const employee = await prisma.employee.findFirst({
      where: isFullAdmin ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined }
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
    const isFullAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN;
    const employee = await prisma.employee.findFirst({
      where: isFullAdmin ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined }
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
      select: employeeLetterFields,
      orderBy: { issuedAt: "desc" }
    });
    return letters.map((letter) => ({ ...letter, fileUrl: letter.fileKey ? storageService.publicUrl(letter.fileKey) : null }));
  },

  async generateLetter(user: AuthUser, employeeId: string, userId: string, data: { type: LetterType; title?: string; body?: string }) {
    const isFullAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN;
    const employee = await prisma.employee.findFirst({
      where: isFullAdmin ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined },
      include: { company: true }
    });
    if (!employee) throw notFound("Employee");

    const { formatFullName } = await import("../../lib/formatName.js");
    const employeeName = formatFullName(employee);
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
    const updated = await prisma.employeeLetter.update({
      where: { id: letter.id },
      data: { fileKey: key, fileData: Uint8Array.from(pdf), storedInDatabase: true },
      select: employeeLetterFields
    });

    return { ...updated, fileUrl: storageService.publicUrl(key) };
  },

  async getByUserId(userId: string) {
    return prisma.employee.findUnique({
      where: { userId },
      include: employeeProfileFields
    });
  },

  async getByIdForUser(employeeId: string, user: AuthUser) {
    const requesterIsHr = await isRequesterHr(user);
    const employee = await prisma.employee.findFirst({
      where: requesterIsHr ? { id: employeeId } : { id: employeeId, companyId: user.companyId || undefined },
      include: employeeProfileFields
    });
    if (!employee) throw notFound("Employee");

    const userIsCoreTeam = await isRequesterCoreTeam(user);
    const targetIsCoreTeam = isCoreTeamEmployee(employee);

    if (targetIsCoreTeam && !userIsCoreTeam && employee.userId !== user.id) {
      return {
        ...employee,
        salary: null,
        salaryHistory: [],
        dateOfBirth: null,
        taxId: null
      };
    }

    if (!requesterIsHr && employee.userId !== user.id) {
      return {
        ...employee,
        salary: null,
        salaryHistory: [],
        dateOfBirth: null,
        taxId: null
      };
    }

    return employee;
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
        displayName: (data as any).displayName !== undefined ? (data as any).displayName : undefined,
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
  },

  async getSalaryHistory(employeeId: string) {
    return prisma.salaryHistory.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: "desc" }
    });
  },

  async addSalaryRevision(employeeId: string, data: { basic: number; allowances: number; deductions: number; effectiveFrom: string; notes?: string }) {
    const effectiveDate = new Date(data.effectiveFrom);
    return prisma.$transaction(async (tx) => {
      const existingSalary = await tx.salary.findUnique({ where: { employeeId } });
      const existingHistoryCount = await tx.salaryHistory.count({ where: { employeeId } });
      if (existingHistoryCount === 0 && existingSalary) {
        await tx.salaryHistory.create({
          data: {
            employeeId,
            basic: existingSalary.basic,
            allowances: existingSalary.allowances,
            deductions: existingSalary.deductions,
            effectiveFrom: existingSalary.effectiveFrom,
            notes: "Initial recorded salary"
          }
        });
      }

      const existingForSameDate = await tx.salaryHistory.findFirst({
        where: { employeeId, effectiveFrom: effectiveDate }
      });

      let revision;
      if (existingForSameDate) {
        revision = await tx.salaryHistory.update({
          where: { id: existingForSameDate.id },
          data: {
            basic: new Prisma.Decimal(data.basic),
            allowances: new Prisma.Decimal(data.allowances),
            deductions: new Prisma.Decimal(data.deductions),
            notes: data.notes || existingForSameDate.notes
          }
        });
      } else {
        revision = await tx.salaryHistory.create({
          data: {
            employeeId,
            basic: new Prisma.Decimal(data.basic),
            allowances: new Prisma.Decimal(data.allowances),
            deductions: new Prisma.Decimal(data.deductions),
            effectiveFrom: effectiveDate,
            notes: data.notes || "Salary revision"
          }
        });
      }

      const latest = await tx.salaryHistory.findFirst({
        where: { employeeId },
        orderBy: { effectiveFrom: "desc" }
      });
      if (latest) {
        await tx.salary.upsert({
          where: { employeeId },
          create: {
            employeeId,
            basic: latest.basic,
            allowances: latest.allowances,
            deductions: latest.deductions,
            effectiveFrom: latest.effectiveFrom
          },
          update: {
            basic: latest.basic,
            allowances: latest.allowances,
            deductions: latest.deductions,
            effectiveFrom: latest.effectiveFrom
          }
        });
      }
      return revision;
    });
  },

  async deleteSalaryRevision(employeeId: string, historyId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.salaryHistory.deleteMany({
        where: { id: historyId, employeeId }
      });
      const latest = await tx.salaryHistory.findFirst({
        where: { employeeId },
        orderBy: { effectiveFrom: "desc" }
      });
      if (latest) {
        await tx.salary.update({
          where: { employeeId },
          data: {
            basic: latest.basic,
            allowances: latest.allowances,
            deductions: latest.deductions,
            effectiveFrom: latest.effectiveFrom
          }
        });
      }
      return { success: true };
    });
  }
};
