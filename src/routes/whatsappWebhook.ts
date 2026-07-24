import { Router } from "express";
import { env } from "../config/env.js";

export const whatsappWebhookRouter = Router();

whatsappWebhookRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(challenge || ""));
  }

  return res.status(403).json({ error: "Invalid WhatsApp webhook verification token" });
});

whatsappWebhookRouter.post("/", (req, res) => {
  console.info("[whatsapp:webhook]", JSON.stringify(req.body || {}));
  return res.status(200).json({ received: true });
});
