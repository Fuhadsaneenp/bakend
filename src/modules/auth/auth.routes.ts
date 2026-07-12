import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authService } from "./auth.service.js";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many authentication attempts. Please try again later." }
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many password reset attempts. Please try again later." }
});

const passwordSchema = z.string()
  .min(12)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/)
  .regex(/[^A-Za-z0-9]/);

authRouter.post("/login", authLimiter, async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
    res.json(await authService.login(body.email, body.password));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/refresh", authLimiter, async (req, res, next) => {
  try {
    const body = z.object({ refreshToken: z.string() }).parse(req.body);
    res.json(await authService.refresh(body.refreshToken));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/forgot-password", passwordResetLimiter, async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    res.json(await authService.requestResetPassword(body.email));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/reset-password", passwordResetLimiter, async (req, res, next) => {
  try {
    const body = z.object({
      email: z.string().email(),
      code: z.string().regex(/^\d{6}$/),
      newPassword: passwordSchema
    }).parse(req.body);
    res.json(await authService.resetPassword(body.email, body.code, body.newPassword));
  } catch (error) {
    next(error);
  }
});
