import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { attendanceService } from "./attendance.service.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { runBiometricSync } from "../../routes/biometricSync.js";

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

attendanceRouter.get("/report", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const query = z.object({ month: z.coerce.number().min(1).max(12), year: z.coerce.number().min(2020) }).parse(req.query);
    res.json(await attendanceService.monthlyReportForUser(req.user, query.month, query.year));
  } catch (error) {
    next(error);
  }
});

attendanceRouter.get("/biometric/logs", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    const logs = await prisma.biometricRawLog.findMany({
      orderBy: { receivedAt: "desc" },
      take: 50
    });
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post("/biometric/sync", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req, res, next) => {
  try {
    await runBiometricSync();
    res.json({ success: true, message: "Sync executed successfully" });
  } catch (error) {
    next(error);
  }
});

// Shifts CRUD endpoints
attendanceRouter.get("/shifts", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const shifts = await prisma.shift.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: "desc" }
    });
    res.json(shifts);
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post("/shifts", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      name: z.string().min(1),
      startTime: z.string().regex(/^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
      endTime: z.string().regex(/^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
      gracePeriod: z.number().int().nonnegative(),
      earlyPunchTolerance: z.number().int().nonnegative(),
      workMinutesFix: z.number().int().nonnegative()
    }).parse(req.body);

    const shift = await prisma.shift.create({
      data: {
        companyId: req.user.companyId,
        ...body
      }
    });
    res.status(201).json(shift);
  } catch (error) {
    next(error);
  }
});

attendanceRouter.put("/shifts/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      name: z.string().min(1),
      startTime: z.string().regex(/^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
      endTime: z.string().regex(/^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
      gracePeriod: z.number().int().nonnegative(),
      earlyPunchTolerance: z.number().int().nonnegative(),
      workMinutesFix: z.number().int().nonnegative()
    }).parse(req.body);

    const existing = await prisma.shift.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId }
    });
    if (!existing) throw new ApiError(404, "Shift not found");

    const shift = await prisma.shift.update({
      where: { id: req.params.id },
      data: body
    });
    res.json(shift);
  } catch (error) {
    next(error);
  }
});

attendanceRouter.delete("/shifts/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const existing = await prisma.shift.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId }
    });
    if (!existing) throw new ApiError(404, "Shift not found");

    const employeesCount = await prisma.employee.count({
      where: { shiftId: req.params.id }
    });
    if (employeesCount > 0) {
      throw new ApiError(400, "Cannot delete shift because it is assigned to employees");
    }

    await prisma.shift.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

