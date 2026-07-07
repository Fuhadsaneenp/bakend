import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { attendanceService } from "./attendance.service.js";
import { env } from "../../config/env.js";

export const attendanceRouter = Router();

// Biometric webhook endpoint (requires x-biometric-key bypass header)
attendanceRouter.post("/biometric", async (req, res, next) => {
  try {
    const key = req.headers["x-biometric-key"];
    if (key !== env.BIOMETRIC_API_KEY) {
      throw new ApiError(401, "Unauthorized biometric key");
    }

    const bodySchema = z.object({
      biometricId: z.string(),
      punchTime: z.string(),
      direction: z.enum(["IN", "OUT"]).optional()
    });

    const isArray = Array.isArray(req.body);
    const punches = isArray
      ? z.array(bodySchema).parse(req.body)
      : [bodySchema.parse(req.body)];

    const results = [];
    for (const punch of punches) {
      const result = await attendanceService.biometricPunch(punch.biometricId, punch.punchTime, punch.direction);
      results.push(result);
    }
    res.status(200).json({ success: true, processed: results.length, data: results });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.use(requireAuth);

attendanceRouter.post("/checkin", async (req, res, next) => {
  try {
    const body = z.object({ latitude: z.number().optional(), longitude: z.number().optional() }).parse(req.body);
    res.status(201).json(await attendanceService.checkIn(req.user!.id, body));
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post("/checkout", async (req, res, next) => {
  try {
    res.json(await attendanceService.checkOut(req.user!.id));
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get("/report", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const query = z.object({ month: z.coerce.number().min(1).max(12), year: z.coerce.number().min(2020) }).parse(req.query);
    res.json(await attendanceService.monthlyReport(req.user.companyId, query.month, query.year));
  } catch (error) {
    next(error);
  }
});
