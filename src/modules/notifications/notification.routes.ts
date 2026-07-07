import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { notificationService } from "./notification.service.js";

export const notificationRouter = Router();
notificationRouter.use(requireAuth);

notificationRouter.get("/", async (req, res, next) => {
  try {
    res.json(await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" }, take: 50 }));
  } catch (error) {
    next(error);
  }
});

notificationRouter.post("/send", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const body = z.object({
      userId: z.string().optional(),
      email: z.string().email().optional(),
      subject: z.string().min(3),
      body: z.string().min(3)
    }).parse(req.body);
    res.status(201).json(await notificationService.send(body));
  } catch (error) {
    next(error);
  }
});
