import { env } from "../../config/env.js";

export interface LLMGenerateRequest {
  prompt: string;
  systemContext?: string;
  temperature?: number;
}

export const ollamaClient = {
  isConfigured(): boolean {
    return Boolean(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL);
  },

  async generate(req: LLMGenerateRequest): Promise<string | null> {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const model = process.env.OLLAMA_MODEL || "llama3";

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: req.prompt,
          system: req.systemContext,
          stream: false,
          options: {
            temperature: req.temperature ?? 0.4
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as any;
      return data?.response || null;
    } catch {
      // Gracefully fall back to local rule & analytics engine
      return null;
    }
  }
};
