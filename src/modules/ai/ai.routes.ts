import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { aiService } from "./ai.service.js";
import { geminiClient } from "./gemini-client.service.js";
import { UserContext } from "./ai.types.js";

export const aiRouter = Router();

aiRouter.use(requireAuth);

async function resolveUserContext(req: any): Promise<UserContext> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const dbUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, role: true, companyId: true, email: true, employee: { select: { id: true, firstName: true, lastName: true } } } });
  if (!dbUser) throw new ApiError(401, "Account not found");
  return { userId: dbUser.id, employeeId: dbUser.employee?.id, companyId: dbUser.companyId, role: dbUser.role, name: dbUser.employee ? `${dbUser.employee.firstName} ${dbUser.employee.lastName}`.trim() : "STEMS user", email: dbUser.email };
}

aiRouter.post("/chat", async (req, res, next) => {
  try {
    const body = z.object({
      message: z.string().min(1).max(4000),
      language: z.enum(["en", "ml"]).optional().default("en"),
      voiceMode: z.boolean().optional().default(false),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(8000)
      })).max(30).optional().default([])
    }).parse(req.body);

    const user = await resolveUserContext(req);
    const response = await aiService.processQuestion(user, body.message, body.language, body.history);


    const plain = (response.spokenReply || response.markdown)
      .replace(/[#*`]/g, "").replace(/^[•\-]\s*/gm, "").replace(/\s+/g, " ").trim();
    response.spokenReply = plain.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 500);

    res.json(response);
  } catch (error) {
    next(error);
  }
});



aiRouter.post("/voice-transcribe", async (req, res, next) => {
  try {
    const body = z.object({
      audio: z.string().min(1).max(8_000_000),
      mimeType: z.enum(["audio/webm", "audio/webm;codecs=opus", "audio/mp4", "audio/wav", "audio/mpeg", "audio/ogg"]).optional()
    }).parse(req.body);

    const { geminiClient } = await import("./gemini-client.service.js");
    const text = await geminiClient.transcribeAudio(body.audio, body.mimeType || "audio/webm");

    res.json({ text: text || "" });
  } catch (error) {
    next(error);
  }
});

aiRouter.get("/suggested-prompts", async (req, res, next) => {
  try {
    const role = req.user?.role || "EMPLOYEE";
    const prompts = aiService.getSuggestedPrompts(role);
    res.json({ prompts });
  } catch (error) {
    next(error);
  }
});

// TTS: Gemini first (best quality), Google Translate as fallback (free, great Malayalam)
aiRouter.post("/voice-speak", async (req, res, next) => {
  try {
    const body = z.object({
      text: z.string().max(8000).min(1).max(2000),
      language: z.enum(["en", "ml"]).optional().default("en")
    }).parse(req.body);

    const isMalayalam = body.language === "ml";
    const textToSpeak = body.text.slice(0, 200); // keep it short for TTS

    // ── Tier 1: Gemini 2.5 Flash TTS (best voice, works when quota available) ──
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
      try {
        const voiceName = isMalayalam ? "Kore" : "Charon";
        const languageCode = isMalayalam ? "ml-IN" : "en-IN";
        const ttsBody = {
          contents: [{ parts: [{ text: textToSpeak }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              languageCode
            }
          }
        };

        const ttsRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ttsBody),
            signal: AbortSignal.timeout(8000)
          }
        );

        if (ttsRes.ok) {
          const ttsData = (await ttsRes.json()) as any;
          const part = ttsData?.candidates?.[0]?.content?.parts?.[0];
          if (part?.inlineData?.data) {
            return res.json({
              audio: part.inlineData.data,
              mimeType: part.inlineData.mimeType || "audio/wav"
            });
          }
        }
      } catch {
        // fall through to Google Translate TTS
      }
    }

    // ── Tier 2: Google Translate TTS (free, no key, real Google voices for ml & en) ──
    try {
      const langCode = isMalayalam ? "ml" : "en";
      const encodedText = encodeURIComponent(textToSpeak);
      const gttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=${langCode}&client=gtx&ttsspeed=0.9`;

      const gttsRes = await fetch(gttsUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TTS/1.0)",
          "Referer": "https://translate.google.com/"
        },
        signal: AbortSignal.timeout(6000)
      });

      if (gttsRes.ok) {
        const audioBuffer = await gttsRes.arrayBuffer();
        const audioB64 = Buffer.from(audioBuffer).toString("base64");
        return res.json({ audio: audioB64, mimeType: "audio/mpeg" });
      }
    } catch {
      // fall through
    }

    // All TTS failed — tell frontend to use browser fallback
    return res.status(502).json({ error: "TTS unavailable, use browser" });
  } catch (error) {
    next(error);
  }
});

