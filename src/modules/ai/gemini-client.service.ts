import { env } from "../../config/env.js";
import { googleCloudSpeech } from "./google-cloud-speech.service.js";

export interface GeminiGenerateRequest {
  prompt: string;
  systemContext?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}
export interface GeminiChatRequest {
  timeoutMs?: number;
  systemContext?: string;
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
  temperature?: number;
  maxTokens?: number;
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
type Content = { role: string; parts: Part[] };

export const geminiClient = {
  getApiKey(): string | null {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || null;
  },
  isConfigured(): boolean { return env.AI_PROVIDER === "vertex" ? Boolean(env.GOOGLE_APPLICATION_CREDENTIALS && env.GOOGLE_CLOUD_PROJECT) : Boolean(this.getApiKey()); },

  async request(contents: Content[], options: { systemContext?: string; temperature?: number; maxTokens?: number; timeoutMs?: number }, transcription = false): Promise<string | null> {
    const vertex = env.AI_PROVIDER === "vertex";
    const apiKey = vertex ? await googleCloudSpeech.accessToken() : this.getApiKey();
    if (!apiKey) return null;
    const models = [...new Set([
      transcription ? env.GEMINI_TRANSCRIPTION_MODEL : env.GEMINI_MODEL,
      env.GEMINI_FALLBACK_MODEL
    ].filter(Boolean))] as string[];
    // Shared deadline prevents each fallback from adding another full timeout.
    const signal = AbortSignal.timeout(options.timeoutMs ?? 15000);
    for (const model of models) {
      if (signal.aborted) break;
      try {
        const body: any = {
          contents,
          generationConfig: {
            temperature: options.temperature ?? 0.2,
            maxOutputTokens: model.startsWith("gemini-3.8") ? Math.max(2048, options.maxTokens ?? 1600) : options.maxTokens ?? 1600,
            ...(model.startsWith("gemini-3") && model.includes("flash") ? { thinkingConfig: { thinkingLevel: model.startsWith("gemini-3.8") ? "low" : "minimal" } } : {}),
            ...(model.startsWith("gemini-2.5-flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {})
          }
        };
        if (options.systemContext) body.systemInstruction = { parts: [{ text: options.systemContext }] };
        const url = vertex ? `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(env.GOOGLE_CLOUD_PROJECT!)}/locations/global/publishers/google/models/${encodeURIComponent(model)}:generateContent` : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        const response = await fetch(url, {
          method: "POST",
          headers: vertex ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` } : { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body), signal
        });
        if (!response.ok) {
          // Never log request URLs, prompts, keys, or provider error bodies.
          console.warn("Gemini request failed", { model, status: response.status });
          if ([400, 401, 403].includes(response.status)) return null;
          continue;
        }
        const data = await response.json() as any;
        const candidate = data?.candidates?.[0];
        if (candidate?.finishReason === "SAFETY" || data?.promptFeedback?.blockReason) return null;
        const text = (candidate?.content?.parts ?? [])
          .filter((part: any) => typeof part.text === "string" && !part.thought)
          .map((part: any) => part.text).join("\n").trim();
        if (text) return text;
        console.warn("Gemini returned no text", { model, finishReason: candidate?.finishReason });
      } catch {
        console.warn("Gemini request unavailable", { model, timedOut: signal.aborted });
      }
    }
    return null;
  },
  async generate(req: GeminiGenerateRequest): Promise<string | null> {
    return this.request([{ role: "user", parts: [{ text: req.prompt }] }], req);
  },
  async generateWithHistory(req: GeminiChatRequest): Promise<string | null> {
    const contents: Content[] = [];
    for (const entry of req.history.slice(-12)) {
      const role = entry.role === "user" ? "user" : "model";
      const text = entry.text.trim().slice(0, 4000);
      if (!text || (!contents.length && role === "model")) continue;
      if (contents.at(-1)?.role === role) contents.at(-1)!.parts.push({ text });
      else contents.push({ role, parts: [{ text }] });
    }
    if (contents.at(-1)?.role === "user") contents.at(-1)!.parts.push({ text: req.message });
    else contents.push({ role: "user", parts: [{ text: req.message }] });
    return this.request(contents, req);
  },
  async transcribeAudio(base64Audio: string, mimeType = "audio/webm"): Promise<string | null> {
    return this.request([{ role: "user", parts: [
      { inlineData: { mimeType: mimeType.split(";")[0], data: base64Audio } },
      { text: "Transcribe the spoken audio verbatim in its original language, English or Malayalam. Return only the transcript." }
    ] }], { temperature: 0.1, maxTokens: 1000 }, true);
  }
};
