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

const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const shiftSchema = z.object({
  name: z.string().min(1),
  startTime: z.string().regex(/^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
  endTime: z.string().regex(/^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"),
  gracePeriod: z.number().int().nonnegative(),
  earlyPunchTolerance: z.number().int().nonnegative(),
  workMinutesFix: z.number().int().nonnegative(),
  workingDays: z.array(z.enum(weekdayNames)).min(1),
  effectiveFrom: z.string().optional(),
  scheduleType: z.enum(["Duration-based", "Clock-based"]).default("Clock-based"),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional()
});

function parseWorkingDays(raw: string | null | undefined) {
  if (!raw) return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((day) => typeof day === "string")) {
      return parsed;
    }
  } catch {}
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
}

function serializeShift(shift: any) {
  return {
    ...shift,
    workingDays: parseWorkingDays(shift.workingDays)
  };
}

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
attendanceRouter.get("/shifts", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.EMPLOYEE), async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");
    const shifts = await prisma.shift.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: "desc" }
    });
    res.json(shifts.map(serializeShift));
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post("/shifts", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const body = shiftSchema.parse(req.body);

    const shift = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.shift.updateMany({
          where: { companyId },
          data: { isDefault: false }
        });
      }

      return tx.shift.create({
        data: {
          companyId,
          name: body.name,
          startTime: body.startTime,
          endTime: body.endTime,
          gracePeriod: body.gracePeriod,
          earlyPunchTolerance: body.earlyPunchTolerance,
          workMinutesFix: body.workMinutesFix,
          workingDays: JSON.stringify(body.workingDays),
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
          scheduleType: body.scheduleType,
          isDefault: body.isDefault ?? false,
          isActive: body.isActive ?? true
        }
      });
    });
    res.status(201).json(serializeShift(shift));
  } catch (error) {
    next(error);
  }
});

attendanceRouter.put("/shifts/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req, res, next) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const body = shiftSchema.parse(req.body);

    const existing = await prisma.shift.findFirst({
      where: { id: req.params.id, companyId }
    });
    if (!existing) throw new ApiError(404, "Shift not found");

    const shift = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.shift.updateMany({
          where: { companyId, id: { not: req.params.id } },
          data: { isDefault: false }
        });
      }

      return tx.shift.update({
        where: { id: req.params.id },
        data: {
          name: body.name,
          startTime: body.startTime,
          endTime: body.endTime,
          gracePeriod: body.gracePeriod,
          earlyPunchTolerance: body.earlyPunchTolerance,
          workMinutesFix: body.workMinutesFix,
          workingDays: JSON.stringify(body.workingDays),
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : existing.effectiveFrom,
          scheduleType: body.scheduleType,
          isDefault: body.isDefault ?? existing.isDefault,
          isActive: body.isActive ?? existing.isActive
        }
      });
    });
    res.json(serializeShift(shift));
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
    if (existing.isDefault) {
      throw new ApiError(400, "Cannot delete the default work schedule. Set another schedule as default first.");
    }

    await prisma.shift.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
