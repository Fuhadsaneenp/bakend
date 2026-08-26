import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { emailService } from "../../integrations/email/email.service.js";
import { whatsappService } from "../../integrations/whatsapp/whatsapp.service.js";

export const notificationService = {
  async send(input: { userId?: string; email?: string; subject: string; body: string }) {
    if (input.email) {
      await emailService.send({ to: input.email, subject: input.subject, html: `<p>${input.body}</p>` });
    }

    if (input.userId) return notificationService.inApp(input.userId, input.subject, input.body);

    return prisma.notification.create({ data: { channel: NotificationChannel.EMAIL, status: NotificationStatus.SENT, subject: input.subject, body: input.body, sentAt: new Date() } });
  },

  async inApp(userId: string, subject: string, body: string, metadata?: Record<string, unknown>) {
    return prisma.notification.create({
      data: {
        userId,
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.SENT,
        subject,
        body,
        metadata: metadata as any,
        sentAt: new Date()
      }
    });
  },

  async notifyAdmins(options: {
    companyId?: string | null;
    subject: string;
    body: string;
    metadata?: Record<string, unknown>;
    excludeUserId?: string;
  }) {
    try {
      const adminUsers = await prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: [Role.SUPER_ADMIN, Role.HR_ADMIN] },
          ...(options.companyId ? { OR: [{ companyId: options.companyId }, { role: Role.SUPER_ADMIN }] } : {})
        },
        select: { id: true }
      });

      const targetIds = adminUsers
        .map((u) => u.id)
        .filter((id) => id && id !== options.excludeUserId);

      const uniqueIds = Array.from(new Set(targetIds));
      if (uniqueIds.length === 0) return [];

      return await Promise.all(
        uniqueIds.map((userId) =>
          notificationService.inApp(userId, options.subject, options.body, options.metadata)
        )
      );
    } catch (err) {
      console.error("[Notification] notifyAdmins error:", err);
      return [];
    }
  },

  async notifyManagersAndCoordinators(options: {
    companyId?: string | null;
    departmentId?: string | null;
    subject: string;
    body: string;
    metadata?: Record<string, unknown>;
    excludeUserId?: string;
    extraUserIds?: string[];
  }) {
    try {
      // Find all managers, HR admins, Super Admins, and employees with Manager/Coordinator/Lead titles
      const whereCondition: any = {
        isActive: true,
        OR: [
          { role: { in: [Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER] } },
          {
            employee: {
              OR: [
                { designation: { title: { contains: "Manager" } } },
                { designation: { title: { contains: "Coordinator" } } },
                { designation: { title: { contains: "Head" } } },
                { designation: { title: { contains: "Lead" } } },
                { isHrHead: true }
              ]
            }
          }
        ]
      };

      if (options.companyId) {
        whereCondition.AND = [{ OR: [{ companyId: options.companyId }, { role: Role.SUPER_ADMIN }] }];
      }

      const users = await prisma.user.findMany({
        where: whereCondition,
        select: { id: true }
      });

      const allTargetIds = [
        ...users.map((u) => u.id),
        ...(options.extraUserIds || [])
      ].filter((id) => Boolean(id) && id !== options.excludeUserId);

      const uniqueIds = Array.from(new Set(allTargetIds));
      if (uniqueIds.length === 0) return [];

      return await Promise.all(
        uniqueIds.map((userId) =>
          notificationService.inApp(userId, options.subject, options.body, options.metadata)
        )
      );
    } catch (err) {
      console.error("[Notification] notifyManagersAndCoordinators error:", err);
      return [];
    }
  },

  async notifyAttendance(options: {
    companyId?: string | null;
    employeeName: string;
    type: "LOGIN" | "LOGOUT" | "CHECK_IN" | "CHECK_OUT";
    timeStr: string;
    employeeUserId: string;
    metadata?: Record<string, unknown>;
  }) {
    const actionLabels: Record<string, string> = {
      LOGIN: "logged into the system",
      LOGOUT: "logged out",
      CHECK_IN: "checked in (Punch In)",
      CHECK_OUT: "checked out (Punch Out)"
    };

    const actionTitle: Record<string, string> = {
      LOGIN: "Employee Login Alert",
      LOGOUT: "Employee Logout Alert",
      CHECK_IN: "Employee Check-in Alert",
      CHECK_OUT: "Employee Check-out Alert"
    };

    const actionText = actionLabels[options.type] || "updated attendance";
    const title = actionTitle[options.type] || "Attendance Update";
    const subject = `🟢 ${title}: ${options.employeeName}`;
    const body = `${options.employeeName} ${actionText} at ${options.timeStr}.`;

    return notificationService.notifyAdmins({
      companyId: options.companyId,
      subject,
      body,
      excludeUserId: options.employeeUserId,
      metadata: {
        category: "attendance",
        type: options.type,
        employeeName: options.employeeName,
        employeeUserId: options.employeeUserId,
        time: options.timeStr,
        ...options.metadata
      }
    });
  },

  async notifyTaskAssigned(options: {
    assignedUserId: string;
    assignerName: string;
    taskTitle: string;
    taskId: string;
    metadata?: Record<string, unknown>;
  }) {
    const subject = `📋 New Task Assigned: ${options.taskTitle}`;
    const body = `You have been assigned a new task "${options.taskTitle}" by ${options.assignerName}.`;

    return notificationService.inApp(options.assignedUserId, subject, body, {
      category: "task",
      action: "ASSIGNED",
      taskId: options.taskId,
      taskTitle: options.taskTitle,
      assignerName: options.assignerName,
      ...options.metadata
    });
  },

  async notifyTaskUnderReview(options: {
    companyId?: string | null;
    taskTitle: string;
    taskId: string;
    employeeName: string;
    employeeUserId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const subject = `🔍 Task Under Review: ${options.taskTitle}`;
    const body = `${options.employeeName} has submitted "${options.taskTitle}" for review and quality check.`;

    return notificationService.notifyManagersAndCoordinators({
      companyId: options.companyId,
      subject,
      body,
      excludeUserId: options.employeeUserId,
      metadata: {
        category: "task",
        action: "UNDER_REVIEW",
        taskId: options.taskId,
        taskTitle: options.taskTitle,
        employeeName: options.employeeName,
        ...options.metadata
      }
    });
  },

  async notifyTaskCompleted(options: {
    companyId?: string | null;
    taskTitle: string;
    taskId: string;
    employeeName: string;
    employeeUserId?: string;
    creatorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const subject = `✅ Task Completed: ${options.taskTitle}`;
    const body = `"${options.taskTitle}" has been completed and marked finished by ${options.employeeName}.`;

    return notificationService.notifyManagersAndCoordinators({
      companyId: options.companyId,
      subject,
      body,
      excludeUserId: options.employeeUserId,
      extraUserIds: options.creatorUserId ? [options.creatorUserId] : [],
      metadata: {
        category: "task",
        action: "COMPLETED",
        taskId: options.taskId,
        taskTitle: options.taskTitle,
        employeeName: options.employeeName,
        ...options.metadata
      }
    });
  },

  async whatsapp(input: { userId?: string; phone: string; subject: string; body: string; metadata?: Record<string, unknown> }) {
    await whatsappService.sendText({ to: input.phone, body: input.body });
    return prisma.notification.create({
      data: {
        userId: input.userId,
        channel: NotificationChannel.WHATSAPP,
        status: NotificationStatus.SENT,
        subject: input.subject,
        body: input.body,
        metadata: input.metadata as any,
        sentAt: new Date()
      }
    });
  },

  async sendPayslip(input: {
    userId: string;
    email: string;
    phone?: string | null;
    employeeName: string;
    month: number;
    year: number;
    pdf: Buffer;
    pdfUrl: string;
    filename: string;
  }) {
    const subject = `Payslip for ${input.month}/${input.year}`;
    const body = `Hello ${input.employeeName}, your payslip for ${input.month}/${input.year} is ready.`;
    await emailService.send({
      to: input.email,
      subject,
      html: `<p>${body}</p>`,
      attachments: [{ filename: input.filename, content: input.pdf, contentType: "application/pdf" }]
    });

    if (input.phone) {
      await whatsappService.sendDocument({ to: input.phone, body, documentUrl: input.pdfUrl, filename: input.filename });
    }

    return notificationService.inApp(input.userId, subject, body, { filename: input.filename, pdfUrl: input.pdfUrl });
  }
};
