import { ApprovalStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../lib/errors.js";
import { notificationService } from "../notifications/notification.service.js";

export const wfhService = {
  async request(userId: string, data: { startDate: string; endDate: string; reason: string }) {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw notFound("Employee");
    return prisma.wFHRequest.create({
      data: { employeeId: employee.id, startDate: new Date(data.startDate), endDate: new Date(data.endDate), reason: data.reason }
    });
  },

  async review(requestId: string, reviewerUserId: string, status: ApprovalStatus) {
    const request = await prisma.wFHRequest.update({
      where: { id: requestId },
      data: { status, reviewedBy: reviewerUserId, reviewedAt: new Date() },
      include: { employee: { include: { user: true } } }
    });
    await notificationService.inApp(request.employee.userId, `WFH ${status.toLowerCase()}`, `Your WFH request was ${status.toLowerCase()}.`);
    return request;
  },

  list(companyId: string) {
    return prisma.wFHRequest.findMany({
      where: { employee: { companyId } },
      include: { employee: true },
      orderBy: { createdAt: "desc" }
    });
  }
};
