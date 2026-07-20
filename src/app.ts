import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { apiRouter } from "./routes/index.js";
import { errorHandler } from "./middleware/error.js";
import { prisma } from "./lib/prisma.js";
import { iclockRouter } from "./routes/iclock.js";
import { storageService } from "./storage/storage.service.js";

const productionOrigins = [
  "https://stems.secondtales.com",
  "https://www.stems.secondtales.com",
  "https://secondtales.com"
];

const configuredOrigins = () => {
  const origins = new Set([
    env.APP_ORIGIN,
    ...productionOrigins,
    ...(env.ALLOWED_ORIGINS?.split(",").map((origin: string) => origin.trim()).filter(Boolean) ?? [])
  ]);

  if (env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return origins;
};

const isDesktopAppOrigin = (origin: string) => {
  if (env.NODE_ENV === "production") return false;
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
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"]
      }
    }
  }));
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (configuredOrigins().has(origin) || isDesktopAppOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    maxAge: 600
  }));
  app.use("/iclock", iclockRouter);
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
  app.use(morgan("combined"));
  app.use(rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false
  }));
  app.get("/files/*", async (req, res, next) => {
    const key = (req.params as Record<string, string>)["0"];
    if (!key || key.includes("..")) return res.status(400).json({ message: "Invalid file key" });

    try {
      const document = await prisma.employeeDocument.findFirst({
        where: { fileKey: key },
        select: { fileData: true, fileName: true, mimeType: true }
      });

      const letter = document ? null : await prisma.employeeLetter.findFirst({
        where: { fileKey: key },
        select: { fileData: true, title: true }
      });

      const databaseBytes = document?.fileData || letter?.fileData;
      const bytes = databaseBytes
        ? Buffer.from(databaseBytes)
        : await storageService.getObject(key);
      const mimeType = document?.mimeType || (letter ? "application/pdf" : "application/octet-stream");
      const fileName = document?.fileName || (letter ? `${letter.title}.pdf` : key.split("/").pop()) || "download";

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      return res.send(bytes);
    } catch (error: any) {
      if (error?.code === "ENOENT" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
        return res.status(404).json({ message: "File not found" });
      }
      return next(error);
    }
  });

  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, service: "hr-saas-backend", database: "connected" });
    } catch (dbError: any) {
      console.error("Database connection check failed:", dbError);
      res.status(500).json({ 
        ok: false, 
        service: "hr-saas-backend", 
        database: "disconnected"
      });
    }
  });
  app.use("/api", apiRouter);
  app.use(errorHandler);
  return app;
};
