import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.preprocess((val) => {
    if (typeof val === "string" && /^\d+$/.test(val)) return Number(val);
    return val;
  }, z.union([z.string(), z.number()])).default(4000),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  ALLOWED_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string(),
  JWT_ACCESS_SECRET: z.string().min(24),
  JWT_REFRESH_SECRET: z.string().min(24),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  BIOMETRIC_API_KEY: z.string().optional(),
  ALLOWED_BIOMETRIC_SNS: z.string().optional(),
  LOCAL_STORAGE_PATH: z.string().default("./storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("HR Platform <no-reply@example.com>"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default("Second Tales EMS <onboarding@resend.dev>"),
  WHATSAPP_PROVIDER: z.enum(["meta", "twilio"]).default("meta"),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default("v20.0")
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
  process.exit(1);
}

export const env = parsedEnv;
