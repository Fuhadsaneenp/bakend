import { Router } from "express";
import { z } from "zod";
import { authService } from "./auth.service.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
    res.json(await authService.login(body.email, body.password));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const body = z.object({ refreshToken: z.string() }).parse(req.body);
    res.json(await authService.refresh(body.refreshToken));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    res.json(await authService.requestResetPassword(body.email));
  } catch (error) {
    next(error);
  }
});

authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const body = z.object({
      email: z.string().email(),
      code: z.string().length(6),
      newPassword: z.string().min(8)
    }).parse(req.body);
    res.json(await authService.resetPassword(body.email, body.code, body.newPassword));
  } catch (error) {
    next(error);
  }
});
