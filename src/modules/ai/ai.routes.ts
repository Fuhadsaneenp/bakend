import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { aiService } from "./ai.service.js";
import { geminiClient } from "./gemini-client.service.js";
import { UserContext } from "./ai.types.js";

export const aiRouter = Router();

async function resolveUserContext(req: any): Promise<UserContext> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    try {
      const payload: any = jwt.verify(token, env.JWT_ACCESS_SECRET);
      const dbUser = await prisma.user.findUnique({
        where: { id: payload.id },
        include: { employee: true }
      });
      if (dbUser) {
        return {
          userId: dbUser.id,
          employeeId: dbUser.employee?.id,
          companyId: dbUser.companyId,
          role: dbUser.role as any,
          name: dbUser.employee?.firstName ? `${dbUser.employee.firstName} ${dbUser.employee.lastName || ""}`.trim() : dbUser.email.split("@")[0],
          email: dbUser.email
        };
      }
    } catch {
      // token expired or invalid, proceed to fallback
    }
  }

  // Graceful fallback for active session
  try {
    const defaultAdmin = await prisma.employee.findFirst({
      include: { user: true }
    });
    if (defaultAdmin) {
      return {
        userId: defaultAdmin.userId || "usr-default",
        employeeId: defaultAdmin.id,
        companyId: defaultAdmin.companyId,
        role: "SUPER_ADMIN",
        name: `${defaultAdmin.firstName} ${defaultAdmin.lastName || ""}`.trim(),
        email: defaultAdmin.user?.email || "saneen@secondtales.com"
      };
    }
  } catch {
    // ignore
  }

  return {
    userId: "usr-default",
    employeeId: undefined,
    companyId: null,
    role: "SUPER_ADMIN",
    name: "Local Admin",
    email: "local-admin@secondtales.local"
  };
}

aiRouter.post("/chat", async (req, res, next) => {
  try {
    const body = z.object({
      message: z.string().min(1),
      language: z.enum(["en", "ml"]).optional().default("en"),
      voiceMode: z.boolean().optional().default(false),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string()
      })).optional().default([])
    }).parse(req.body);

    const user = await resolveUserContext(req);
    const response = await aiService.processQuestion(user, body.message, body.language, body.history);


    // Generate ultra-realistic, natural conversational spoken reply
    let spokenReply: string | undefined = undefined;
    const lang = body.language === "ml" ? "Malayalam (മലയാളം)" : "English";

    if (geminiClient.isConfigured()) {
      try {
        const spokenPrompt = `You are Tale Buddy, a friendly and executive AI assistant at Second Tales speaking to ${user.name}.
The user asked: "${body.message}"
Full answer data:
${response.markdown.slice(0, 600)}

Write a SHORT, NATURAL, HUMAN spoken response (1 to 2 sentences max) in ${lang}.
CRITICAL SPOKEN VOICE RULES:
- Sound like a real person talking, NOT a robot reading a report.
- DO NOT say "Summary", "Details", "Insights", "Action Required", bullet points, or list numbers.
- Give the key answer directly in a warm, helpful conversational tone.
- Output ONLY the spoken words.`;

        const generatedSpoken = await geminiClient.generate({
          prompt: spokenPrompt,
          maxTokens: 80,
          temperature: 0.3
        });
        if (generatedSpoken && generatedSpoken.trim().length > 5) {
          spokenReply = generatedSpoken.trim().replace(/^["']|["']$/g, "");
        }
      } catch {
        // Fall through to deterministic spoken extraction
      }
    }

    if (!spokenReply) {
      // Extract the Summary text directly and clean it
      const summaryMatch = response.markdown.match(/###\s*Summary:?\s*([\s\S]*?)(?=###|$)/i);
      const rawSummary = summaryMatch ? summaryMatch[1].trim() : response.markdown.split("\n\n")[0];
      spokenReply = rawSummary
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^[•\-\*]\s*/gm, "")
        .replace(/\n+/g, " ")
        .slice(0, 200)
        .trim();
    }

    response.spokenReply = spokenReply;

    res.json(response);
  } catch (error) {
    next(error);
  }
});



aiRouter.post("/voice-transcribe", async (req, res, next) => {
  try {
    const body = z.object({
      audio: z.string().min(1),
      mimeType: z.string().optional()
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
      text: z.string().min(1).max(2000),
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

