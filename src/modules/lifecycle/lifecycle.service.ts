import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

export const lifecycleService = {
  // Templates
  async createTemplate(
    companyId: string,
    title: string,
    type: "ONBOARDING" | "EXIT",
    tasks: Array<{ title: string; description?: string; assignedRole: string }>
  ) {
    return prisma.lifecycleTemplate.create({
      data: {
        companyId,
        title,
        type,
        tasks: {
          create: tasks.map(t => ({
            title: t.title,
            description: t.description,
            assignedRole: t.assignedRole
          }))
        }
      },
      include: { tasks: true }
    });
  },

  async getTemplates(companyId: string, type?: "ONBOARDING" | "EXIT") {
    return prisma.lifecycleTemplate.findMany({
      where: {
        companyId,
        ...(type ? { type } : {})
      },
      include: { tasks: true },
      orderBy: { createdAt: "desc" }
    });
  },

  async deleteTemplate(companyId: string, templateId: string) {
    const template = await prisma.lifecycleTemplate.findFirst({
      where: { id: templateId, companyId }
    });
    if (!template) throw new ApiError(404, "Template not found");

    return prisma.lifecycleTemplate.delete({
      where: { id: templateId }
    });
  },

  // Checklist instantiation
  async instantiateChecklist(companyId: string, employeeId: string, templateId: string) {
    const template = await prisma.lifecycleTemplate.findFirst({
      where: { id: templateId, companyId },
      include: { tasks: true }
    });
    if (!template) throw new ApiError(404, "Template not found");

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId }
    });
    if (!employee) throw new ApiError(404, "Employee not found");

    // Start Checklist
    const checklist = await prisma.employeeChecklist.create({
      data: {
        employeeId,
        templateId,
        type: template.type,
        status: "PENDING",
        items: {
          create: template.tasks.map(t => ({
            title: t.title,
            description: t.description,
            assignedRole: t.assignedRole,
            status: "PENDING"
          }))
        }
      },
      include: { items: true }
    });

    // Update Employee Status
    if (template.type === "ONBOARDING") {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { onboardingStatus: "IN_PROGRESS" }
      });
    } else {
      await prisma.employee.update({
        where: { id: employeeId },
        data: { settlementStatus: "IN_PROGRESS" }
      });
    }

    return checklist;
  },

  // Update Checklist Item Task Status
  async updateChecklistItemStatus(companyId: string, itemId: string, status: "PENDING" | "COMPLETED", completedById: string) {
    const item = await prisma.employeeChecklistItem.findFirst({
      where: { id: itemId },
      include: { checklist: true }
    });
    if (!item) throw new ApiError(404, "Checklist task item not found");

    const updatedItem = await prisma.employeeChecklistItem.update({
      where: { id: itemId },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : null,
        completedById: status === "COMPLETED" ? completedById : null
      }
    });

    // Recalculate Checklist completion
    const checklistItems = await prisma.employeeChecklistItem.findMany({
      where: { checklistId: item.checklistId }
    });

    const allCompleted = checklistItems.every(i => i.status === "COMPLETED");

    if (allCompleted) {
      await prisma.employeeChecklist.update({
        where: { id: item.checklistId },
        data: { status: "COMPLETED" }
      });

      // Update Employee Status
      if (item.checklist.type === "ONBOARDING") {
        await prisma.employee.update({
          where: { id: item.checklist.employeeId },
          data: { onboardingStatus: "COMPLETED" }
        });
      } else {
        await prisma.employee.update({
          where: { id: item.checklist.employeeId },
          data: { settlementStatus: "COMPLETED" }
        });
      }
    } else {
      await prisma.employeeChecklist.update({
        where: { id: item.checklistId },
        data: { status: "PENDING" }
      });

      // Revert Employee Status back to progress if checked off
      if (item.checklist.type === "ONBOARDING") {
        await prisma.employee.update({
          where: { id: item.checklist.employeeId },
          data: { onboardingStatus: "IN_PROGRESS" }
        });
      } else {
        await prisma.employee.update({
          where: { id: item.checklist.employeeId },
          data: { settlementStatus: "IN_PROGRESS" }
        });
      }
    }

    return updatedItem;
  },

  // Queries
  async getEmployeeChecklists(employeeId: string) {
    return prisma.employeeChecklist.findMany({
      where: { employeeId },
      include: {
        template: true,
        items: {
          include: { completedBy: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getActiveChecklists(companyId: string) {
    return prisma.employeeChecklist.findMany({
      where: {
        employee: { companyId }
      },
      include: {
        employee: true,
        template: true,
        items: {
          include: { completedBy: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getAssignedTasks(companyId: string, role: string) {
    return prisma.employeeChecklistItem.findMany({
      where: {
        assignedRole: role,
        checklist: {
          employee: { companyId }
        }
      },
      include: {
        checklist: {
          include: { employee: true, template: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }
};
