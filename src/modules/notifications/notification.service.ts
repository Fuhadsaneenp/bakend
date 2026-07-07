import { NotificationChannel, NotificationStatus } from "@prisma/client";
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
    return prisma.notification.create({ data: { userId, channel: NotificationChannel.IN_APP, status: NotificationStatus.SENT, subject, body, metadata: metadata as any, sentAt: new Date() } });
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
