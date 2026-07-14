import { ApprovalStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";
import { notificationService } from "../notifications/notification.service.js";
import type { AuthUser } from "../../middleware/auth.js";

export const wfhService = {
  async request(userId: string, data: { startDate: string; endDate: string; reason: string }) {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw notFound("Employee");
    return prisma.wFHRequest.create({
      data: { employeeId: employee.id, startDate: new Date(data.startDate), endDate: new Date(data.endDate), reason: data.reason }
    });
  },

  async review(requestId: string, reviewer: AuthUser, status: ApprovalStatus) {
    const existing = await prisma.wFHRequest.findUnique({
      where: { id: requestId },
      include: { employee: { include: { user: true } } }
    });
    if (!existing) throw notFound("WFH request");

    if (reviewer.role === Role.MANAGER) {
      const manager = await prisma.employee.findUnique({ where: { userId: reviewer.id } });
      if (!manager || existing.employee.managerId !== manager.id) {
        throw new ApiError(403, "Managers can only review direct-report requests");
      }
    }

    const request = await prisma.wFHRequest.update({
      where: { id: requestId },
      data: { status, reviewedBy: reviewer.id, reviewedAt: new Date() },
      include: { employee: { include: { user: true } } }
    });
    await notificationService.inApp(request.employee.userId, `WFH ${status.toLowerCase()}`, `Your WFH request was ${status.toLowerCase()}.`);
    return request;
  },

  async listForUser(user: AuthUser) {
    if (!user.companyId) return [];

    if (user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN) {
      return prisma.wFHRequest.findMany({
        where: { employee: { companyId: user.companyId } },
        include: { employee: { include: { documents: true } } },
        orderBy: { createdAt: "desc" }
      });
    }

    const employee = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!employee) return [];

    if (user.role === Role.MANAGER) {
      return prisma.wFHRequest.findMany({
        where: { employee: { managerId: employee.id } },
        include: { employee: { include: { documents: true } } },
        orderBy: { createdAt: "desc" }
      });
    }

    return prisma.wFHRequest.findMany({
      where: { employeeId: employee.id },
      include: { employee: { include: { documents: true } } },
      orderBy: { createdAt: "desc" }
    });
  }
};
