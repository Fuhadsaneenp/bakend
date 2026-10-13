import { env } from "../../config/env.js";
import { geminiClient } from "./gemini-client.service.js";
import { googleCloudSpeech } from "./google-cloud-speech.service.js";

export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000 || pcm.length % 2) throw new Error("Invalid PCM format");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

type SpeechResult = { audio: string; mimeType: string; provider: string; voice: string };
const cache = new Map<string, { expires: number; value: SpeechResult }>();
const pending = new Map<string, Promise<SpeechResult | null>>();
const cooldown = new Map<string, number>();

export async function generateNaturalSpeech(text: string, language: "en" | "ml"): Promise<SpeechResult | null> {
  const google = env.SPEECH_PROVIDER === "google_cloud";
  const azure = env.SPEECH_PROVIDER === "azure" || Boolean(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION);
  const key = google ? env.GOOGLE_APPLICATION_CREDENTIALS : azure ? env.AZURE_SPEECH_KEY : geminiClient.getApiKey(); if (!key) return null;
  const cacheKey = `${google ? "google_cloud" : azure ? "azure" : "gemini"}:${azure ? env.AZURE_SPEECH_VOICE_ML : "Achernar"}:${language}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  const existing = pending.get(cacheKey); if (existing) return existing;
  const job = google ? googleCloudSpeech.synthesize(text, language) : azure ? requestAzureSpeech(text, language, key) : requestSpeech(text, language, key);
  pending.set(cacheKey, job);
  try {
    const value = await job;
    if (value) {
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { expires: Date.now() + 300000, value });
    }
    return value;
  } finally { pending.delete(cacheKey); }
}

export function azureSpeechSsml(text: string, language: "en" | "ml", voice: string): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language === "ml" ? "ml-IN" : "en-IN"}"><voice name="${escape(voice)}">${escape(text)}</voice></speak>`;
}

async function requestAzureSpeech(text: string, language: "en" | "ml", key: string): Promise<SpeechResult | null> {
  if (!env.AZURE_SPEECH_REGION) return null;
  const voice = language === "ml" ? env.AZURE_SPEECH_VOICE_ML : "en-IN-NeerjaNeural";
  try {
    const response = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST", headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "Stems-Tale-Buddy" },
      body: azureSpeechSsml(text, language, voice), signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) { console.warn("Azure speech unavailable", { status: response.status }); return null; }
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length || !response.headers.get("content-type")?.toLowerCase().startsWith("audio/")) return null;
    return { audio: audio.toString("base64"), mimeType: "audio/mpeg", provider: "azure", voice };
  } catch { console.warn("Azure speech connection unavailable"); return null; }
}

async function requestSpeech(text: string, language: "en" | "ml", key: string): Promise<SpeechResult | null> {
  const models = [...new Set([env.GEMINI_TTS_MODEL, env.GEMINI_TTS_FALLBACK_MODEL].filter(Boolean))] as string[];
  const deadline = Date.now() + 14000;
  for (const model of models) {
    if ((cooldown.get(model) || 0) > Date.now()) continue;
    const remaining = deadline - Date.now(); if (remaining <= 0) break;
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(Math.min(8000, remaining)),
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Achernar" } } } }
        })
      });
      if (!response.ok) {
        console.warn("Natural speech model unavailable", { model, status: response.status });
        if ([401, 403, 400].includes(response.status)) return null;
        cooldown.set(model, Date.now() + (response.status === 429 ? 60000 : 5000));
        continue;
      }
      const result = await response.json() as any;
      const part = result?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
      if (!part) continue;
      const bytes = Buffer.from(part.data, "base64");
      const pcm = /audio\/(l16|pcm)/i.test(part.mimeType || "");
      const rate = Number(/rate=(\d+)/.exec(part.mimeType || "")?.[1] || 24000);
      const data = pcm ? pcmToWav(bytes, rate) : bytes;
      return { audio: data.toString("base64"), mimeType: pcm ? "audio/wav" : part.mimeType || "audio/wav", provider: "gemini", voice: "Achernar" };
    } catch { console.warn("Natural speech request failed", { model }); }
  }
  return null;
}
