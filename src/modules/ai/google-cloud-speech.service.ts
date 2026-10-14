import { readFile } from "node:fs/promises";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

export function speechChunks(text: string, maxBytes = 800): string[] {
  if(!Number.isInteger(maxBytes)||maxBytes<16)throw new Error('Invalid speech chunk size');
  const chunks:string[]=[];let current='';
  const clean=text.replace(/[*#`]/g,'').trim();
  const flush=()=>{if(current.trim())chunks.push(current.trim());current='';};
  const sentences=new Intl.Segmenter('ml',{granularity:'sentence'}).segment(clean);
  for(const {segment} of sentences){
    const sentence=segment.trim();if(!sentence)continue;
    if(Buffer.byteLength(sentence,'utf8')<=maxBytes){if(current&&Buffer.byteLength(current+' '+sentence,'utf8')>maxBytes)flush();current+=(current?' ':'')+sentence;continue;}
    flush();
    for(const word of sentence.split(/\s+/).filter(Boolean)){
      if(Buffer.byteLength(word,'utf8')<=maxBytes){if(current&&Buffer.byteLength(current+' '+word,'utf8')>maxBytes)flush();current+=(current?' ':'')+word;}
      else {flush();for(const {segment:grapheme} of new Intl.Segmenter('ml',{granularity:'grapheme'}).segment(word)){if(Buffer.byteLength(current+grapheme,'utf8')>maxBytes)flush();current+=grapheme;}}
    }
    flush();
  }
  flush();return chunks;
}

let cached: { path: string; token: string; expires: number } | undefined;
export const googleCloudSpeech = {
  async accessToken(): Promise<string | null> {
    const path = env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!path) return null;
    if (cached && cached.path === path && cached.expires > Date.now()) return cached.token;
    const account = JSON.parse(await readFile(path, "utf8"));
    if (account.type !== "service_account" || typeof account.client_email !== "string" || typeof account.private_key !== "string") return null;
    const assertion = jwt.sign({ scope: "https://www.googleapis.com/auth/cloud-platform" }, account.private_key, { algorithm: "RS256", issuer: account.client_email, audience: "https://oauth2.googleapis.com/token", expiresIn: 3600 });
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(6000) });
    if (!response.ok) { console.warn("Google Cloud speech authentication unavailable", { status: response.status }); return null; }
    const data = await response.json() as any;
    if (typeof data.access_token !== "string" || !Number.isFinite(Number(data.expires_in))) return null;
    cached = { path, token: data.access_token, expires: Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000 };
    return cached.token;
  },
  async synthesize(text: string, language: "en" | "ml") {
    try {
      const token = await this.accessToken(); if (!token) return null;
      const voice = language === "ml" ? "ml-IN-Chirp3-HD-Achernar" : "en-IN-Chirp3-HD-Achernar";
      const audioParts: Buffer[] = [];
      for (const chunk of speechChunks(text)) {
      const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ input: { text: chunk }, voice: { languageCode: language === "ml" ? "ml-IN" : "en-IN", name: voice }, audioConfig: { audioEncoding: "MP3" } }), signal: AbortSignal.timeout(12000) });
      if (!response.ok) { console.warn("Google Cloud speech unavailable", { status: response.status }); return null; }
      const data = await response.json() as any;
      if (typeof data.audioContent !== "string" || !data.audioContent.length) return null;
      audioParts.push(Buffer.from(data.audioContent, "base64"));
      }
      if (!audioParts.length) return null;
      return { audio: Buffer.concat(audioParts).toString("base64"), mimeType: "audio/mpeg", provider: "google_cloud", voice };
    } catch { console.warn("Google Cloud speech connection unavailable"); return null; }
  }
};
