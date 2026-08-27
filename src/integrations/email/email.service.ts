import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

type EmailAttachment = { filename: string; content: Buffer; contentType: string };
type EmailInput = { to: string; subject: string; html: string; attachments?: EmailAttachment[] };

const cleanAddress = (value: string) => value.trim().replace(/^["']|["']$/g, "");
const rejectHeaderValue = (value: string, field: string) => {
  if (/[\r\n]/.test(value)) throw new Error(`Invalid ${field}`);
  return value;
};
const sanitizeAttachmentName = (value: string) => value
  .split(/[\\/]/)
  .pop()
  ?.replace(/[^\w.\- ]+/g, "")
  .replace(/\s+/g, "-")
  .slice(0, 120) || "attachment";

const hasSmtpConfig = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
const smtpPort = Number(env.SMTP_PORT || 587);

const transporter = hasSmtpConfig
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: smtpPort,
      secure: smtpPort === 465 || env.SMTP_SECURE === true,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      tls: {
        rejectUnauthorized: false
      },
      disableFileAccess: true,
      disableUrlAccess: true
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
      from: rejectHeaderValue(cleanAddress(env.RESEND_FROM || env.SMTP_FROM), "from address"),
      to: [rejectHeaderValue(cleanAddress(input.to), "recipient address")],
      subject: rejectHeaderValue(input.subject, "subject"),
      html: input.html,
      attachments: input.attachments?.map((attachment) => ({
        filename: sanitizeAttachmentName(attachment.filename),
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
    if (transporter) {
      try {
        const fromAddress = env.SMTP_FROM || `Second Tales EMS <${env.SMTP_USER}>`;
        const info = await transporter.sendMail({
          from: rejectHeaderValue(cleanAddress(fromAddress), "from address"),
          to: rejectHeaderValue(cleanAddress(input.to), "recipient address"),
          subject: rejectHeaderValue(input.subject, "subject"),
          html: input.html,
          attachments: input.attachments?.map((attachment) => ({
            ...attachment,
            filename: sanitizeAttachmentName(attachment.filename)
          })),
          disableFileAccess: true,
          disableUrlAccess: true
        });
        console.log(`[EmailService] Successfully sent email to ${input.to} (MessageId: ${info.messageId})`);
        return { providerMessageId: info.messageId, delivered: true, provider: "smtp" };
      } catch (smtpErr) {
        console.error("[EmailService] Hostinger SMTP failed, falling back if possible:", smtpErr);
        if (env.RESEND_API_KEY) {
          return sendViaResend(input);
        }
        return { providerMessageId: "failed-smtp", delivered: false };
      }
    }

    if (env.RESEND_API_KEY) {
      return sendViaResend(input);
    }

    console.warn("[email:dry-run] No SMTP or Resend provider configured.", input.to, input.subject);
    return { providerMessageId: "dry-run", delivered: false };
  },

  buildNotificationEmailHtml(options: {
    title: string;
    body: string;
    recipientName?: string;
    actionUrl?: string;
    actionText?: string;
    category?: string;
  }) {
    const actionButton = options.actionUrl
      ? `
        <div style="margin: 28px 0 10px; text-align: center;">
          <a href="${options.actionUrl}" style="background-color: #047857; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 700; display: inline-block; box-shadow: 0 4px 12px rgba(4, 120, 87, 0.2);">
            ${options.actionText || "View in Second Tales EMS"} &rarr;
          </a>
        </div>
      `
      : "";

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${options.title}</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 10px;">
            <tr>
              <td align="center">
                <table width="100%" max-width="560px" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);">
                  <!-- Header -->
                  <tr>
                    <td style="background-color: #047857; padding: 24px 32px; text-align: left;">
                      <span style="color: #a7f3d0; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;">Second Tales EMS</span>
                      <h2 style="color: #ffffff; margin: 6px 0 0; font-size: 20px; font-weight: 700;">${options.title}</h2>
                    </td>
                  </tr>
                  <!-- Body Content -->
                  <tr>
                    <td style="padding: 32px;">
                      ${options.recipientName ? `<p style="font-size: 15px; font-weight: 600; color: #0f172a; margin: 0 0 16px;">Hello ${options.recipientName},</p>` : ""}
                      <div style="font-size: 14.5px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
                        ${options.body}
                      </div>
                      ${actionButton}
                    </td>
                  </tr>
                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #f1f5f9; text-align: center;">
                      <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                        &copy; 2026 Second Tales EMS. All rights reserved.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
  }
};
