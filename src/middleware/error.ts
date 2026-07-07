import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError } from "../lib/errors.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(422).json({ message: "Validation failed", issues: error.flatten() });
  }

  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({ message: error.message, details: error.details });
  }

  console.error(error);
  return res.status(500).json({ message: "Internal server error" });
};
