import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { ApiError } from "../lib/errors.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(422).json({ message: "Validation failed", issues: error.flatten() });
  }

  if (error instanceof ApiError) {
    const body: { message: string; details?: unknown } = { message: error.message };
    if (env.NODE_ENV !== "production" && error.details) body.details = error.details;
    return res.status(error.statusCode).json(body);
  }

  console.error(error);
  const message = error instanceof Error ? error.message : "";
  const cause = typeof error === "object" && error !== null && "cause" in error ? String((error as any).cause?.cause || (error as any).cause?.message || "") : "";
  const combined = `${message}\n${cause}`.toLowerCase();
  if (env.NODE_ENV !== "production" && (combined.includes("access denied for user") || combined.includes("pool timeout"))) {
    return res.status(503).json({
      message: "Local database connection failed. Check backend/.env DATABASE_URL credentials or database access."
    });
  }
  return res.status(500).json({ message: "Internal server error" });
};
