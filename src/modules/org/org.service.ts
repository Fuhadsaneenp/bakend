import { prisma } from "../../lib/prisma.js";

export const orgService = {
  companies() {
    return prisma.company.findMany({ orderBy: { name: "asc" } });
  },

  company(id: string) {
    return prisma.company.findUnique({ where: { id } });
  },

  createCompany(data: { name: string; legalName?: string; logoUrl?: string; phoneCode?: string; phone?: string; email?: string; overview?: string; worksSevenDays?: boolean }) {
    return prisma.company.create({
      data: {
        name: data.name,
        legalName: data.legalName || null,
        logoUrl: data.logoUrl || null,
        phoneCode: data.phoneCode || null,
        phone: data.phone || null,
        email: data.email || null,
        overview: data.overview || null,
        worksSevenDays: data.worksSevenDays ?? false
      }
    });
  },

  updateCompany(id: string, data: { name?: string; legalName?: string | null; logoUrl?: string | null; phoneCode?: string | null; phone?: string | null; email?: string | null; overview?: string | null; worksSevenDays?: boolean }) {
    return prisma.company.update({
      where: { id },
      data
    });
  },

  async deleteCompany(id: string) {
    // Delete company and all its related entities in a transaction
    return prisma.$transaction(async (tx) => {
      // Find all employees in this company to delete their dependencies
      const employees = await tx.employee.findMany({ where: { companyId: id } });
      const employeeIds = employees.map(e => e.id);
      const userIds = employees.map(e => e.userId);

      if (employeeIds.length > 0) {
        await tx.employeeDocument.deleteMany({ where: { employeeId: { in: employeeIds } } });
        await tx.employeeLetter.deleteMany({ where: { employeeId: { in: employeeIds } } });
        await tx.salary.deleteMany({ where: { employeeId: { in: employeeIds } } });
        await tx.attendance.deleteMany({ where: { employeeId: { in: employeeIds } } });
        await tx.wFHRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
        await tx.expenseClaim.deleteMany({ where: { employeeId: { in: employeeIds } } });
        await tx.payslip.deleteMany({ where: { employeeId: { in: employeeIds } } });
        await tx.pointsLedger.deleteMany({ where: { employeeId: { in: employeeIds } } });
        await tx.rating.deleteMany({ where: { ratedById: { in: employeeIds } } });
        await tx.client.deleteMany({ where: { companyId: id } });
        await tx.workCard.deleteMany({ where: { companyId: id } });
        await tx.employee.deleteMany({ where: { companyId: id } });
      }

      if (userIds.length > 0) {
        await tx.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
        await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
        await tx.statusHistory.deleteMany({ where: { userId: { in: userIds } } });
        await tx.comment.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      }

      await tx.designation.deleteMany({ where: { department: { companyId: id } } });
      await tx.department.deleteMany({ where: { companyId: id } });
      await tx.payrollRun.deleteMany({ where: { companyId: id } });
      await tx.workTrackSetting.deleteMany({ where: { companyId: id } });
      await tx.shift.deleteMany({ where: { companyId: id } });

      return tx.company.delete({ where: { id } });
    });
  },

  async departments(companyId: string) {
    let list = await prisma.department.findMany({ where: { companyId }, include: { designations: true }, orderBy: { name: "asc" } });
    const hasRoot = list.some(d => d.code === "root");
    if (!hasRoot) {
      try {
        const rootNode = await prisma.department.create({
          data: {
            companyId,
            name: "Core Team",
            code: "root"
          },
          include: { designations: true }
        });
        list = [rootNode, ...list];
      } catch (err) {
        console.error("Error auto-creating Core Team department:", err);
      }
    }
    return list;
  },

  async listAllDepartments() {
    return prisma.department.findMany({
      include: {
        company: true,
        designations: true
      },
      orderBy: { name: "asc" }
    });
  },

  createDepartment(companyId: string, data: { name: string; code: string }) {
    return prisma.department.create({ data: { companyId, name: data.name, code: data.code } });
  },

  updateDepartment(id: string, data: { name?: string; code?: string }) {
    return prisma.department.update({ where: { id }, data });
  },

  async deleteDepartment(id: string) {
    return prisma.$transaction(async (tx) => {
      // Nullify department references or delete designations under this department
      await tx.designation.deleteMany({ where: { departmentId: id } });
      await tx.employee.updateMany({ where: { departmentId: id }, data: { departmentId: null, designationId: null } });
      return tx.department.delete({ where: { id } });
    });
  },

  createDesignation(departmentId: string, title: string) {
    return prisma.designation.create({ data: { departmentId, title } });
  },

  updateDesignation(id: string, title?: string, departmentId?: string) {
    return prisma.designation.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(departmentId !== undefined ? { departmentId } : {})
      }
    });
  },

  async deleteDesignation(id: string) {
    await prisma.employee.updateMany({ where: { designationId: id }, data: { designationId: null } });
    return prisma.designation.delete({ where: { id } });
  }
};
