import { env } from "../../config/env.js";

export interface GeminiGenerateRequest {
  prompt: string;
  systemContext?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GeminiChatRequest {
  systemContext?: string;
  history: { role: "user" | "assistant"; text: string }[];
  message: string;
  temperature?: number;
  maxTokens?: number;
}

export const geminiClient = {
  getApiKey(): string | null {
    return process.env.GEMINI_API_KEY || (env as any)?.GEMINI_API_KEY || null;
  },

  isConfigured(): boolean {
    return Boolean(this.getApiKey());
  },

  async generate(req: GeminiGenerateRequest): Promise<string | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    // Ultra-fast lightweight models first for instant execution
    const models = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-3.5-flash-lite",
      "gemini-flash-latest"
    ];

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const systemInstruction = req.systemContext
          ? { parts: [{ text: req.systemContext }] }
          : undefined;

        const body: any = {
          contents: [
            {
              role: "user",
              parts: [{ text: req.prompt }]
            }
          ],
          generationConfig: {
            temperature: req.temperature ?? 0.3,
            maxOutputTokens: req.maxTokens ?? 1000
          }
        };

        if (systemInstruction) {
          body.systemInstruction = systemInstruction;
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          continue;
        }

        const data = (await response.json()) as any;
        const candidateText =
          data?.candidates?.[0]?.content?.parts?.[0]?.text || null;

        if (candidateText && candidateText.trim().length > 0) {
          return candidateText.trim();
        }
      } catch {
        continue;
      }
    }

    return null;
  },

  // Multi-turn chat with full conversation history
  async generateWithHistory(req: GeminiChatRequest): Promise<string | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    const models = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-3.5-flash-lite",
      "gemini-flash-latest"
    ];

    // Build Gemini multi-turn contents array from history
    const contents: { role: string; parts: { text: string }[] }[] = [];

    // Add history (skip system-level messages, keep user/model turns)
    for (const h of req.history) {
      const geminiRole = h.role === "user" ? "user" : "model";
      contents.push({ role: geminiRole, parts: [{ text: h.text.slice(0, 500) }] });
    }

    // Add the current user message
    contents.push({ role: "user", parts: [{ text: req.message }] });

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const body: any = {
          contents,
          generationConfig: {
            temperature: req.temperature ?? 0.4,
            maxOutputTokens: req.maxTokens ?? 1200
          }
        };

        if (req.systemContext) {
          body.systemInstruction = { parts: [{ text: req.systemContext }] };
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);


        if (!response.ok) continue;

        const data = (await response.json()) as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text && text.trim().length > 0) {
          return text.trim();
        }
      } catch {
        continue;
      }
    }

    return null;
  },

  async transcribeAudio(base64Audio: string, mimeType = "audio/webm"): Promise<string | null> {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"];

    for (const model of models) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const body: any = {
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: mimeType.split(";")[0] || "audio/webm",
                    data: base64Audio
                  }
                },
                {
                  text: "Transcribe this spoken audio verbatim in English or Malayalam. Return ONLY the spoken text with no extra commentary or markdown."
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 200
          }
        };

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        if (!response.ok) continue;

        const data = (await response.json()) as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) {
          return text.trim();
        }
      } catch {
        continue;
      }
    }
    return null;
  }
};
