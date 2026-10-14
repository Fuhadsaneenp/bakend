import { conversationalAnswer } from "./conversational-answer.js";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { aiService } from "./ai.service.js";
import { geminiClient } from "./gemini-client.service.js";
import { generateNaturalSpeech } from "./voice.service.js";
import { UserContext } from "./ai.types.js";
import { stemsMcpService } from "../mcp/stems-mcp.service.js";

export const aiRouter = Router();

aiRouter.use(requireAuth);

aiRouter.get("/mcp", (_req, res) => { res.setHeader("Allow", "POST"); res.sendStatus(405); });
aiRouter.post("/mcp", async (req, res, next) => {
  try {
    if (!req.accepts("application/json") || !req.get("Accept")?.includes("text/event-stream")) return res.status(406).json({ error: "Accept application/json and text/event-stream" });
    const user = await resolveUserContext(req);
    const result = await stemsMcpService.handle(user, req.body);
    if (result === undefined) return res.status(202).end();
    res.json(result);
  } catch (error) { next(error); }
});

async function resolveUserContext(req: any): Promise<UserContext> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const dbUser = await prisma.user.findUnique({
    where: { id: req.user.id }, include: { employee: true }
  });
  if (!dbUser) throw new ApiError(401, "Account not found");
  return {
    userId: dbUser.id,
    employeeId: dbUser.employee?.id,
    companyId: dbUser.companyId,
    role: dbUser.role,
    name: dbUser.employee?.firstName
      ? `${dbUser.employee.firstName} ${dbUser.employee.lastName || ""}`.trim()
      : dbUser.email.split("@")[0],
    email: dbUser.email
  };
}

aiRouter.post("/chat", async (req, res, next) => {
  try {
    const body = z.object({
      message: z.string().trim().min(1).max(6000),
      language: z.enum(["en", "ml"]).optional().default("ml"),
      voiceMode: z.boolean().optional().default(false),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(6000)
      })).max(20).optional().default([])
    }).parse(req.body);

    const user = await resolveUserContext(req);
    const replyLanguage = /[\u0D00-\u0D7F]/.test(body.message) ? "ml" : body.language;
    const response = conversationalAnswer(await aiService.processQuestion(user, body.message, replyLanguage, body.history, body.voiceMode), replyLanguage);


    // Generate ultra-realistic, natural conversational spoken reply
    let spokenReply: string | undefined = response.spokenReply;
    const lang = replyLanguage === "ml" ? "Malayalam (മലയാളം)" : "English";

    const plainReply = response.markdown.replace(/[#*`]/g, "").trim();
    if (body.voiceMode && !spokenReply && plainReply.length < 1200 && !response.markdown.includes("|")) {
      spokenReply = plainReply;
    }
    if (body.voiceMode && !spokenReply && ["gemini", "vertex"].includes(env.AI_PROVIDER) && geminiClient.isConfigured()) {
      try {
        const spokenPrompt = `You are Tale Buddy, a friendly and executive AI assistant at Second Tales speaking to ${user.name}.
The user asked: "${body.message}"
Full answer data:
${response.markdown.slice(0, 4000)}

Write a natural spoken explanation in ${lang}. For a work report use 4 to 6 short conversational sentences, preserving the main numbers, actual task names, deadlines and attendance from the answer. For a simple question use 1 or 2 sentences. Do not add facts. Keep it under 120 words.
CRITICAL SPOKEN VOICE RULES:
- Sound like a real person talking, NOT a robot reading a report.
- DO NOT say "Summary", "Details", "Insights", "Action Required", bullet points, or list numbers.
- Give the key answer directly in a warm, helpful conversational tone.
- Output ONLY the spoken words.`;

        const generatedSpoken = await geminiClient.generate({
          prompt: spokenPrompt,
          maxTokens: 700,
          timeoutMs: 8000,
          temperature: 0.3
        });
        if (generatedSpoken && generatedSpoken.trim().length > 5) {
          spokenReply = generatedSpoken.trim().replace(/^["']|["']$/g, "");
        }
      } catch {
        // Fall through to deterministic spoken extraction
      }
    }

    if (body.voiceMode && !spokenReply) {
      // Extract the Summary text directly and clean it
      const summaryMatch = response.markdown.match(/###\s*Summary:?\s*([\s\S]*?)(?=###|$)/i);
      const rawSummary = summaryMatch ? summaryMatch[1].trim() : response.markdown.split("\n\n")[0];
      spokenReply = rawSummary
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^[•\-\*]\s*/gm, "")
        .replace(/\n+/g, " ")
        .slice(0, 1000)
        .trim();
    }

    response.spokenReply = spokenReply;

    if (body.voiceMode && spokenReply) {
      try {
        const audio = await generateNaturalSpeech(spokenReply.slice(0, 1200), replyLanguage);
        if (audio) return res.json({ ...response, ...audio });
      } catch { console.warn("Combined voice response unavailable"); }
    }
    res.json(response);
  } catch (error) {
    const ml = req.body?.language === "ml" || /[\u0D00-\u0D7F]/.test(String(req.body?.message || ""));
    if (ml && error instanceof ApiError && [400,403,404,503].includes(error.statusCode)) {
      const message = error.statusCode === 403 ? "ഈ വിവരങ്ങൾ കാണാനുള്ള അനുമതി നിങ്ങളുടെ അക്കൗണ്ടിനില്ല." : error.statusCode === 404 ? "ആവശ്യപ്പെട്ട ജീവനക്കാരന്റെ രേഖ കണ്ടെത്തിയില്ല. മുഴുവൻ പേരോ employee code-ഓ പറയാമോ?" : error.statusCode === 503 ? "ഇപ്പോൾ STEMS രേഖകൾ ലഭിക്കുന്നില്ല. കണക്കുകൾ ഊഹിച്ച് പറയാനാവില്ല; അല്പസമയത്തിന് ശേഷം വീണ്ടും ശ്രമിക്കൂ." : "ശരിയായ റിപ്പോർട്ട് നൽകാൻ ജീവനക്കാരന്റെ മുഴുവൻ പേരും ആവശ്യമായ തീയതിയും വ്യക്തമാക്കാമോ?";
      return res.status(error.statusCode).json({message});
    }
    next(error);
  }
});



aiRouter.post("/voice-transcribe", async (req, res, next) => {
  try {
    const body = z.object({
      audio: z.string().min(1).max(10_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
      mimeType: z.enum(["audio/webm", "audio/webm;codecs=opus", "audio/ogg", "audio/ogg;codecs=opus", "audio/wav", "audio/mp4", "audio/mpeg"]).optional()
    }).parse(req.body);

    const { geminiClient } = await import("./gemini-client.service.js");
    const text = await geminiClient.transcribeAudio(body.audio, body.mimeType || "audio/webm");

    if (!text) throw new ApiError(503, "Voice transcription is unavailable. Please type your message or try again.");
    res.json({ text });
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
      language: z.enum(["en", "ml"]).optional().default("ml"),
      naturalOnly: z.boolean().optional().default(false)
    }).parse(req.body);

    const isMalayalam = body.language === "ml";
    const textToSpeak = body.text.slice(0, 1200);

    try {
      const audio = await generateNaturalSpeech(textToSpeak, body.language);
      if (audio) return res.json(audio);
    } catch {
      console.warn("Natural speech request timed out or failed");
    }
    if (body.naturalOnly) throw new ApiError(503, "The natural voice is temporarily unavailable. Please try again shortly.");

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

