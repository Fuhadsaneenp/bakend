import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { env } from "./config/env.js";
import { apiRouter } from "./routes/index.js";
import { errorHandler } from "./middleware/error.js";
import { prisma } from "./lib/prisma.js";

const isDesktopAppOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
};

export const createApp = () => {
  const app = express();
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowedOrigins = [
        env.APP_ORIGIN,
        "https://ptimeworks.com",
        "https://www.ptimeworks.com",
        "http://localhost:3000"
      ];
      if (
        allowedOrigins.includes(origin) || 
        origin.endsWith(".ptimeworks.com") || 
        origin === "https://ptimeworks.com" ||
        isDesktopAppOrigin(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true
  }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan("combined"));
  app.use(rateLimit({ windowMs: 60_000, limit: 300 }));
  app.use("/files", express.static(path.resolve(env.LOCAL_STORAGE_PATH)));

  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, service: "hr-saas-backend", database: "connected" });
    } catch (dbError: any) {
      console.error("Database connection check failed:", dbError);
      res.status(500).json({ 
        ok: false, 
        service: "hr-saas-backend", 
        database: "disconnected", 
        error: dbError.message || dbError 
      });
    }
  });
  app.use("/api", apiRouter);
  app.use(errorHandler);
  return app;
};
