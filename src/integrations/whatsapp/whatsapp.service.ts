import { env } from "../../config/env.js";

export const whatsappService = {
  async sendDocument(input: { to: string; body: string; documentUrl: string; filename: string }) {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      console.info("[whatsapp:dry-run]", input.to, input.filename);
      return { providerMessageId: "dry-run" };
    }

    const response = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to,
        type: "document",
        document: {
          link: input.documentUrl,
          filename: input.filename,
          caption: input.body
        }
      })
    });

    if (!response.ok) throw new Error(`WhatsApp delivery failed: ${await response.text()}`);
    return response.json();
  }
};
