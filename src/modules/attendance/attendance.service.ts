import { Role } from "@prisma/client";
import { differenceInMinutes } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";

const lateHour = 9;
const standardWorkMinutes = 8 * 60;

export function getKolkataStartOfDay(date: Date): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  return new Date(`${year}-${month}-${day}T00:00:00+05:30`);
}

function getShiftTime(workDate: Date, timeStr: string): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(workDate);
  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  return new Date(`${year}-${month}-${day}T${timeStr}:00+05:30`);
}

function getShiftEndTime(workDate: Date, startTimeStr: string, endTimeStr: string): Date {
  const start = getShiftTime(workDate, startTimeStr);
  let end = getShiftTime(workDate, endTimeStr);
  if (end < start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return end;
}

interface ShiftParams {
  startTime: string;
  endTime: string;
  gracePeriod: number;
  earlyPunchTolerance: number;
  workMinutesFix: number;
}

function getShiftParams(employee: any): ShiftParams {
  if (employee?.shift) {
    return {
      startTime: employee.shift.startTime,
      endTime: employee.shift.endTime,
      gracePeriod: employee.shift.gracePeriod,
      earlyPunchTolerance: employee.shift.earlyPunchTolerance,
      workMinutesFix: employee.shift.workMinutesFix
    };
  }
  return {
    startTime: "09:00",
    endTime: "18:00",
    gracePeriod: 15,
    earlyPunchTolerance: 15,
    workMinutesFix: 8 * 60
  };
}

async function recalculateDraftPayrollForWorkDate(companyId: string, workDate: Date) {
  const { payrollService } = await import("../payroll/payroll.service.js");
  await payrollService.recalculateDraftRunsForPeriods(companyId, [
    {
      month: workDate.getMonth() + 1,
      year: workDate.getFullYear()
    }
  ]);
}

export const attendanceService = {
  async getTodayStatus(userId: string) {
    const employee = await prisma.employee.findUnique({ where: { userId }, include: { shift: true } });
    if (!employee) return null;

    const now = new Date();
    const workDate = getKolkataStartOfDay(now);
    const attendance = await prisma.attendance.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate } }
    });

    const shiftParams = getShiftParams(employee);
    const isWorking = Boolean(attendance?.checkInAt && !attendance?.checkOutAt);

    let currentWorkMinutes = attendance?.workMinutes || 0;
    if (isWorking && attendance?.checkInAt) {
      currentWorkMinutes = Math.max(0, differenceInMinutes(now, attendance.checkInAt));
    }

    return {
      employeeId: employee.id,
      employeeName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
      workDate,
      checkInAt: attendance?.checkInAt || null,
      checkOutAt: attendance?.checkOutAt || null,
      workMinutes: currentWorkMinutes,
      isLate: attendance?.isLate || false,
      isEarlyLeave: attendance?.isEarlyLeave || false,
      isWorking,
      shift: shiftParams
    };
  },

  async checkIn(userId: string, location?: { latitude?: number; longitude?: number }) {
    const employee = await prisma.employee.findUnique({ where: { userId }, include: { shift: true } });
    if (!employee) throw notFound("Employee");

    const now = new Date();
    const workDate = getKolkataStartOfDay(now);
    const shiftParams = getShiftParams(employee);
    const shiftStart = getShiftTime(workDate, shiftParams.startTime);
    const lateLimit = new Date(shiftStart.getTime() + shiftParams.gracePeriod * 60 * 1000);

    const existing = await prisma.attendance.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate } }
    });

    let result;
    if (!existing) {
      result = await prisma.attendance.create({
        data: {
          employeeId: employee.id,
          workDate,
          checkInAt: now,
          checkOutAt: null,
          isLate: now > lateLimit,
          latitude: location?.latitude,
          longitude: location?.longitude
        }
      });
    } else {
      result = await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          checkInAt: existing.checkInAt || now,
          checkOutAt: null,
          isLate: existing.checkInAt ? existing.isLate : (now > lateLimit),
          latitude: location?.latitude ?? existing.latitude,
          longitude: location?.longitude ?? existing.longitude
        }
      });
    }

    await recalculateDraftPayrollForWorkDate(employee.companyId, workDate);
    return result;
  },

  async checkOut(userId: string) {
    const employee = await prisma.employee.findUnique({ where: { userId }, include: { shift: true } });
    if (!employee) throw notFound("Employee");
    const now = new Date();
    const workDate = getKolkataStartOfDay(now);
    const attendance = await prisma.attendance.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
    if (!attendance?.checkInAt) throw new ApiError(400, "Check-in required before checkout");

    const shiftParams = getShiftParams(employee);
    const shiftEnd = getShiftEndTime(workDate, shiftParams.startTime, shiftParams.endTime);
    const earlyLimit = new Date(shiftEnd.getTime() - shiftParams.earlyPunchTolerance * 60 * 1000);

    const worked = Math.max(0, differenceInMinutes(now, attendance.checkInAt));
    const isEarlyLeave = now < earlyLimit;

    const result = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkOutAt: now,
        workMinutes: worked,
        isEarlyLeave,
        overtimeMinutes: Math.max(0, worked - shiftParams.workMinutesFix)
      }
    });
    await recalculateDraftPayrollForWorkDate(employee.companyId, workDate);
    return result;
  },

  monthlyReport(companyId: string, month: number, year: number) {
    const from = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`);
    const totalDays = new Date(year, month, 0).getDate();
    const to = new Date(`${year}-${String(month).padStart(2, "0")}-${String(totalDays).padStart(2, "0")}T23:59:59+05:30`);
    return prisma.attendance.findMany({
      where: { employee: { companyId }, workDate: { gte: from, lte: to } },
      include: { employee: { include: { shift: true } } },
      orderBy: [{ workDate: "asc" }]
    });
  },

  async monthlyReportForUser(user: AuthUser, month: number, year: number, requestedCompanyId?: string) {
    const employee = await prisma.employee.findUnique({ where: { userId: user.id } });
    const fallbackCompanyId = user.companyId || employee?.companyId || undefined;

    const from = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`);
    const totalDays = new Date(year, month, 0).getDate();
    const to = new Date(`${year}-${String(month).padStart(2, "0")}-${String(totalDays).padStart(2, "0")}T23:59:59+05:30`);

    if (user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN) {
      if (requestedCompanyId) {
        return this.monthlyReport(requestedCompanyId, month, year);
      }

      return prisma.attendance.findMany({
        where: { workDate: { gte: from, lte: to } },
        include: { employee: { include: { shift: true } } },
        orderBy: [{ workDate: "asc" }]
      });
    }

    if (!employee) return [];

    const employeeWhere =
      user.role === Role.MANAGER
        ? { OR: [{ id: employee.id }, { managerId: employee.id }] }
        : { id: employee.id };

    return prisma.attendance.findMany({
      where: { employee: employeeWhere, workDate: { gte: from, lte: to } },
      include: { employee: { include: { shift: true } } },
      orderBy: [{ workDate: "asc" }]
    });
  },

  async biometricPunch(
    biometricId: string,
    punchTimeStr: string,
    direction?: "IN" | "OUT",
    options?: { skipPayrollRecalc?: boolean }
  ) {
    let employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { biometricId },
          { employeeCode: biometricId }
        ]
      },
      include: { shift: true }
    });

    // Fallback suffix matching for numeric biometric IDs (e.g., "2" -> "ST002")
    if (!employee && /^\d+$/.test(biometricId)) {
      const paddedId = biometricId.padStart(3, "0");
      employee = await prisma.employee.findFirst({
        where: {
          OR: [
            { employeeCode: { endsWith: paddedId } },
            { biometricId: { endsWith: paddedId } }
          ]
        },
        include: { shift: true }
      });
    }

    // Attendance data must never create people. Device PIN slots can remain on
    // the machine after an employee is deleted, and their later punches would
    // otherwise recreate placeholder accounts such as "Employee ST011".
    if (!employee) throw notFound(`Employee for biometric ID ${biometricId}`);

    let punchTime: Date;
    if (punchTimeStr.includes("Z") || punchTimeStr.includes("+")) {
      punchTime = new Date(punchTimeStr);
    } else {
      const isoStr = punchTimeStr.replace(" ", "T") + "+05:30";
      punchTime = new Date(isoStr);
    }

    const workDate = getKolkataStartOfDay(punchTime);
    const shiftParams = getShiftParams(employee);
    const shiftStart = getShiftTime(workDate, shiftParams.startTime);
    const lateLimit = new Date(shiftStart.getTime() + shiftParams.gracePeriod * 60 * 1000);

    let attendance = await prisma.attendance.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate } }
    });

    if (!attendance) {
      attendance = await prisma.attendance.create({
        data: {
          employeeId: employee.id,
          workDate,
          checkInAt: punchTime,
          isLate: punchTime > lateLimit
        }
      });
      if (!options?.skipPayrollRecalc) {
        await recalculateDraftPayrollForWorkDate(employee.companyId, workDate);
      }
      return { employeeId: employee.id, type: "CHECK_IN", attendanceId: attendance.id };
    }

    let checkInAt = attendance.checkInAt;
    let checkOutAt = attendance.checkOutAt;

    if (!checkInAt || punchTime < checkInAt) {
      const oldCheckIn = checkInAt;
      checkInAt = punchTime;
      if (oldCheckIn) {
        const diff = differenceInMinutes(oldCheckIn, checkInAt);
        if (diff >= 5) {
          if (!checkOutAt || oldCheckIn > checkOutAt) {
            checkOutAt = oldCheckIn;
          }
        }
      }
    } else {
      const diff = differenceInMinutes(punchTime, checkInAt);
      if (diff >= 5) {
        if (!checkOutAt || punchTime > checkOutAt) {
          checkOutAt = punchTime;
        }
      }
    }

    const worked = checkInAt && checkOutAt ? Math.max(0, differenceInMinutes(checkOutAt, checkInAt)) : 0;
    const isLate = checkInAt ? checkInAt > lateLimit : false;

    let isEarlyLeave = false;
    if (checkOutAt) {
      const shiftEnd = getShiftEndTime(workDate, shiftParams.startTime, shiftParams.endTime);
      const earlyLimit = new Date(shiftEnd.getTime() - shiftParams.earlyPunchTolerance * 60 * 1000);
      isEarlyLeave = checkOutAt < earlyLimit;
    }

    attendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkInAt,
        checkOutAt,
        isLate,
        isEarlyLeave,
        workMinutes: worked,
        overtimeMinutes: Math.max(0, worked - shiftParams.workMinutesFix)
      }
    });
    if (!options?.skipPayrollRecalc) {
      await recalculateDraftPayrollForWorkDate(employee.companyId, workDate);
    }
    return { employeeId: employee.id, type: "CHECK_OUT", attendanceId: attendance.id };
  }
};
