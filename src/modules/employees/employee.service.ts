import bcrypt from "bcryptjs";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../lib/errors.js";
import { storageService } from "../../storage/storage.service.js";
import type { AuthUser } from "../../middleware/auth.js";

const nextEmployeeCode = async (companyId: string) => {
  const count = await prisma.employee.count({ where: { companyId } });
  return `EMP-${String(count + 1).padStart(5, "0")}`;
};

export const employeeService = {
  list(companyId: string) {
    return prisma.employee.findMany({
      where: { companyId },
      include: { user: true, department: true, designation: true, salary: true },
      orderBy: { createdAt: "desc" }
    });
  },

  async listForUser(user: AuthUser) {
    if (!user.companyId) return [];

    if (user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN) {
      return this.list(user.companyId);
    }

    const currentEmployee = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!currentEmployee) return [];

    if (user.role === Role.MANAGER) {
      return prisma.employee.findMany({
        where: { companyId: user.companyId, managerId: currentEmployee.id },
        include: { user: true, department: true, designation: true },
        orderBy: { createdAt: "desc" }
      });
    }

    return prisma.employee.findMany({
      where: { companyId: user.companyId, userId: user.id },
      include: { user: true, department: true, designation: true },
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
          employeeCode: await nextEmployeeCode(companyId),
          biometricId: data.biometricId || null,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          personalEmail: data.personalEmail,
          dateOfJoining: new Date(data.dateOfJoining),
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

      return tx.employee.findUniqueOrThrow({ where: { id: employee.id }, include: { user: true, salary: true } });
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
          biometricId: data.biometricId
        },
        include: { user: true, department: true, designation: true, salary: true }
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

  async attachDocument(companyId: string, employeeId: string, file: Express.Multer.File, type: string) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw notFound("Employee");
    const key = `companies/${companyId}/employees/${employeeId}/documents/${Date.now()}-${file.originalname}`;
    await storageService.putObject(key, file.buffer, file.mimetype);
    return prisma.employeeDocument.create({
      data: { employeeId, type, fileKey: key, fileName: file.originalname, mimeType: file.mimetype }
    });
  }
};
