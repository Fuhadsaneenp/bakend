import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

type EmailAttachment = { filename: string; content: Buffer; contentType: string };
type EmailInput = { to: string; subject: string; html: string; attachments?: EmailAttachment[] };

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
    })
  : null;

async function sendViaResend(input: EmailInput) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content.toString("base64"),
        content_type: attachment.contentType
      }))
    })
  });

  const result = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!response.ok) {
    throw new Error(result.message || result.name || `Resend email failed with status ${response.status}`);
  }

  return { providerMessageId: result.id || "resend", delivered: true, provider: "resend" };
}

export const emailService = {
  async send(input: EmailInput) {
    if (env.RESEND_API_KEY) {
      return sendViaResend(input);
    }

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
    return { providerMessageId: info.messageId, delivered: true, provider: "smtp" };
  }
};
