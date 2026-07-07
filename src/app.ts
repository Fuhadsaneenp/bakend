import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { env } from "./config/env.js";
import { apiRouter } from "./routes/index.js";
import { errorHandler } from "./middleware/error.js";

export const createApp = () => {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: env.APP_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan("combined"));
  app.use(rateLimit({ windowMs: 60_000, limit: 300 }));
  app.use("/files", express.static(path.resolve(env.LOCAL_STORAGE_PATH)));

  app.get("/health", (_req, res) => res.json({ ok: true, service: "hr-saas-backend" }));
  app.use("/api", apiRouter);
  app.use(errorHandler);
  return app;
};
