import { env } from "../../config/env.js";

export interface LLMGenerateRequest {
  prompt: string;
  systemContext?: string;
  temperature?: number;
  history?: { role: "user" | "assistant"; text: string }[];
  maxTokens?: number;
}
export const ollamaClient = {
  isConfigured(): boolean { return env.AI_PROVIDER === "ollama"; },
  async generate(req: LLMGenerateRequest): Promise<string | null> {
    try {
      const response = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.OLLAMA_MODEL, stream: false, keep_alive: "30m", messages: [
          ...(req.systemContext ? [{ role: "system", content: req.systemContext }] : []),
          ...(req.history ?? []).slice(-6).map(entry => ({ role: entry.role, content: entry.text.slice(0, 1500) })),
          { role: "user", content: req.prompt }
        ], options: { temperature: req.temperature ?? 0.2, num_ctx: 8192, num_predict: req.maxTokens ?? 700 } }),
        signal: AbortSignal.timeout(90000)
      });
      if (!response.ok) { console.warn("Local AI unavailable", { status: response.status }); return null; }
      const data = await response.json() as any;
      return typeof data.message?.content === "string" ? data.message.content.trim() : null;
    } catch { console.warn("Local AI connection unavailable"); return null; }
  }
};
