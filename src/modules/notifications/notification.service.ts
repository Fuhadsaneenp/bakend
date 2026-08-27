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
          role: { in: [Role.SUPER_ADMIN, Role.HR_ADMIN] }
        },
        select: { id: true, email: true }
      });

      const targetUsers = adminUsers.filter((u) => u.id && u.id !== options.excludeUserId);
      if (targetUsers.length === 0) return [];

      const html = emailService.buildNotificationEmailHtml({
        title: options.subject,
        body: options.body,
        actionUrl: "https://stems.secondtales.com/attendance",
        actionText: "Open Attendance Dashboard",
        category: "attendance"
      });

      const emailResults = await Promise.all(
        targetUsers
          .filter((u) => Boolean(u.email))
          .map((u) =>
            emailService.send({ to: u.email, subject: options.subject, html }).catch((error) => {
              console.error(`[Notification] Admin email failed for ${u.email}:`, error);
              return { providerMessageId: "failed", delivered: false, provider: "unknown" };
            })
          )
      );

      await Promise.all(
        targetUsers.map((u) =>
          notificationService.inApp(u.id, options.subject, options.body, options.metadata)
        )
      );

      const failedEmailCount = emailResults.filter((result) => !result.delivered).length;
      if (failedEmailCount > 0) {
        console.warn(`[Notification] ${failedEmailCount} admin attendance email(s) were not delivered.`);
      }

      return targetUsers;
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
        select: { id: true, email: true }
      });

      let extraUsers: { id: string; email: string }[] = [];
      if (options.extraUserIds && options.extraUserIds.length > 0) {
        extraUsers = await prisma.user.findMany({
          where: { id: { in: options.extraUserIds } },
          select: { id: true, email: true }
        });
      }

      const allUsers = [...users, ...extraUsers].filter(
        (u, idx, arr) => u.id && u.id !== options.excludeUserId && arr.findIndex((x) => x.id === u.id) === idx
      );

      if (allUsers.length === 0) return [];

      const html = emailService.buildNotificationEmailHtml({
        title: options.subject,
        body: options.body,
        actionUrl: "https://stems.secondtales.com/work-track",
        actionText: "View in Work Track",
        category: "task"
      });

      await Promise.all([
        ...allUsers.map((u) =>
          notificationService.inApp(u.id, options.subject, options.body, options.metadata)
        ),
        ...allUsers.map((u) =>
          u.email ? emailService.send({ to: u.email, subject: options.subject, html }).catch((error) => {
            console.error(`[Notification] Task email failed for ${u.email}:`, error);
            return null;
          }) : Promise.resolve()
        )
      ]);

      return allUsers;
    } catch (err) {
      console.error("[Notification] notifyManagersAndCoordinators error:", err);
      return [];
    }
  },

  async getSettings(companyId?: string | null) {
    const defaultSettings = {
      emailPunchAlerts: true,
      emailLoginAlerts: true,
      emailTaskAlerts: true,
      emailPayslipAlerts: true,
      waLeaveAlerts: true,
      waPunchAlerts: true,
      waDailySummary: false,
      waDeviceAlerts: true
    };

    try {
      let setting = null;
      if (companyId) {
        setting = await prisma.companySetting.findUnique({
          where: { companyId_key: { companyId, key: "NOTIFICATION_PREFERENCES" } }
        });
      }
      if (!setting) {
        setting = await prisma.companySetting.findFirst({
          where: { key: "NOTIFICATION_PREFERENCES" }
        });
      }
      if (setting && setting.value && typeof setting.value === "object") {
        return { ...defaultSettings, ...(setting.value as any) };
      }
    } catch (e) {
      console.error("[Notification] getSettings error:", e);
    }
    return defaultSettings;
  },

  async updateSettings(companyId: string | null | undefined, newValues: Record<string, any>) {
    const current = await this.getSettings(companyId);
    const merged = { ...current, ...newValues };

    try {
      let targetCompanyId = companyId;
      if (!targetCompanyId) {
        const firstComp = await prisma.company.findFirst({ select: { id: true } });
        targetCompanyId = firstComp?.id || null;
      }

      if (targetCompanyId) {
        await prisma.companySetting.upsert({
          where: { companyId_key: { companyId: targetCompanyId, key: "NOTIFICATION_PREFERENCES" } },
          create: { companyId: targetCompanyId, key: "NOTIFICATION_PREFERENCES", value: merged },
          update: { value: merged }
        });
      }
    } catch (e) {
      console.error("[Notification] updateSettings error:", e);
    }
    return merged;
  },

  async notifyAttendance(options: {
    companyId?: string | null;
    employeeName: string;
    type: "LOGIN" | "LOGOUT" | "CHECK_IN" | "CHECK_OUT" | "PUNCH_IN" | "PUNCH_OUT";
    timeStr: string;
    employeeUserId: string;
    metadata?: Record<string, unknown>;
  }) {
    const settings = await this.getSettings(options.companyId);

    // Check if notifications for this type are disabled in settings
    const isLoginLogout = options.type === "LOGIN" || options.type === "LOGOUT";
    const isPunch = options.type === "PUNCH_IN" || options.type === "PUNCH_OUT" || options.type === "CHECK_IN" || options.type === "CHECK_OUT";

    if (isLoginLogout && settings.emailLoginAlerts === false) {
      console.log(`[Notification] Login/Logout alerts disabled in settings, skipping email for ${options.employeeName}`);
      return [];
    }

    if (isPunch && settings.emailPunchAlerts === false) {
      console.log(`[Notification] Punch alerts disabled in settings, skipping email for ${options.employeeName}`);
      return [];
    }

    const actionLabels: Record<string, string> = {
      LOGIN: "logged into the web portal",
      LOGOUT: "logged out of the web portal",
      CHECK_IN: "checked in (Web Attendance)",
      CHECK_OUT: "checked out (Web Attendance)",
      PUNCH_IN: "punched in on Biometric Device",
      PUNCH_OUT: "punched out on Biometric Device"
    };

    const actionTitle: Record<string, string> = {
      LOGIN: "Employee Login Alert",
      LOGOUT: "Employee Logout Alert",
      CHECK_IN: "Web Attendance Check-In Alert",
      CHECK_OUT: "Web Attendance Check-Out Alert",
      PUNCH_IN: "Biometric Punch-In Alert",
      PUNCH_OUT: "Biometric Punch-Out Alert"
    };

    const actionIcons: Record<string, string> = {
      LOGIN: "🟢",
      LOGOUT: "🔴",
      CHECK_IN: "🟢",
      CHECK_OUT: "🔴",
      PUNCH_IN: "⏰",
      PUNCH_OUT: "⏰"
    };

    const actionText = actionLabels[options.type] || "updated attendance";
    const title = actionTitle[options.type] || "Attendance Update";
    const icon = actionIcons[options.type] || "🔔";
    const subject = `${icon} ${title}: ${options.employeeName}`;
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

    // Send in-app notification
    const inAppResult = await notificationService.inApp(options.assignedUserId, subject, body, {
      category: "task",
      action: "ASSIGNED",
      taskId: options.taskId,
      taskTitle: options.taskTitle,
      assignerName: options.assignerName,
      ...options.metadata
    });

    // Send email notification to the assigned user
    try {
      const assignedUser = await prisma.user.findUnique({
        where: { id: options.assignedUserId },
        select: { email: true, employee: { select: { firstName: true } } }
      });
      if (assignedUser?.email) {
        const html = emailService.buildNotificationEmailHtml({
          title: subject,
          body,
          recipientName: assignedUser.employee?.firstName,
          actionUrl: "https://stems.secondtales.com/work-track",
          actionText: "Open Task in Work Track",
          category: "task"
        });
        emailService.send({ to: assignedUser.email, subject, html }).catch(() => {});
      }
    } catch {}

    return inAppResult;
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
