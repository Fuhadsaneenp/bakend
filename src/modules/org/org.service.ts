import { prisma } from "../../lib/prisma.js";

export const orgService = {
  departments(companyId: string) {
    return prisma.department.findMany({ where: { companyId }, include: { designations: true }, orderBy: { name: "asc" } });
  },

  createDepartment(companyId: string, data: { name: string; code: string }) {
    return prisma.department.create({ data: { companyId, name: data.name, code: data.code } });
  },

  createDesignation(departmentId: string, title: string) {
    return prisma.designation.create({ data: { departmentId, title } });
  }
};
