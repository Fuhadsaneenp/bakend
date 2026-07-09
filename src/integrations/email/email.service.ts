import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
    })
  : null;

export const emailService = {
  async send(input: { to: string; subject: string; html: string; attachments?: { filename: string; content: Buffer; contentType: string }[] }) {
    if (!transporter) {
      console.info("[email:dry-run]", input.to, input.subject);
      return { providerMessageId: "dry-run", delivered: false };
    }

    const info = await transporter.sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      attachments: input.attachments
    });
    return { providerMessageId: info.messageId, delivered: true };
  }
};
