import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: process.env.AI_ENV_FILE || ".env.ai" });
// Hostinger keeps private AI credentials outside versioned release directories.
dotenv.config({ path: "../../../config/.env.ai" });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.preprocess((val) => {
    if (typeof val === "string" && /^\d+$/.test(val)) return Number(val);
    return val;
  }, z.union([z.string(), z.number()])).default(4000),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  ALLOWED_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string().default("mysql://u394546085_hrrec:Hrrec2026Secure9@srv1824.hstgr.io:3306/u394546085_hrrec"),
  JWT_ACCESS_SECRET: z.string().min(24).default("secondtales_jwt_access_super_secret_key_2026_prod_secure"),
  JWT_REFRESH_SECRET: z.string().min(24).default("secondtales_jwt_refresh_super_secret_key_2026_prod_secure"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  BIOMETRIC_API_KEY: z.string().optional(),
  ALLOWED_BIOMETRIC_SNS: z.string().optional(),
  ENABLE_UNSAFE_ADMIN_ENDPOINTS: z.coerce.boolean().default(false),
  LOCAL_STORAGE_PATH: z.string().default("./storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Second Tales EMS <no-reply@example.com>"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default("Second Tales EMS <onboarding@resend.dev>"),
  WHATSAPP_PROVIDER: z.enum(["meta", "twilio"]).default("meta"),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v20.0"),
  WHATSAPP_VERIFY_TOKEN: z.string().default("secondtales_whatsapp_verify_2026"),
  AI_PROVIDER: z.enum(["gemini", "vertex", "ollama", "direct"]).default("direct"),
  GOOGLE_CLOUD_PROJECT: z.string().regex(/^[a-z][a-z0-9-]+$/).optional(),
  SPEECH_PROVIDER: z.enum(["gemini", "azure", "google_cloud"]).default("gemini"),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().regex(/^[a-z0-9]+$/).optional(),
  AZURE_SPEECH_VOICE_ML: z.enum(["ml-IN-SobhanaNeural", "ml-IN-MidhunNeural"]).default("ml-IN-SobhanaNeural"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("gemma3:4b"),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_TRANSCRIPTION_MODEL: z.string().default("gemini-3.6-flash"),
  GEMINI_TTS_MODEL: z.string().default("gemini-3.8-flash-tts"),
  GEMINI_TTS_FALLBACK_MODEL: z.string().default("gemini-3.1-flash-tts-preview")
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === "production" && !value.BIOMETRIC_API_KEY) {
    console.warn("⚠️ Warning: BIOMETRIC_API_KEY is not configured for production environment.");
  }
});

let parsedEnv: any;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("❌ Environment validation failed:");
    console.error(JSON.stringify(error.format(), null, 2));
  } else {
    console.error(error);
  }
  throw error;
}

export const env = parsedEnv;
