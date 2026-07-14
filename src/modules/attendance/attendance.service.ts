import { Role } from "@prisma/client";
import { differenceInMinutes } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";

const lateHour = 9;
const standardWorkMinutes = 8 * 60;

function getKolkataStartOfDay(date: Date): Date {
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

function getKolkataHour(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const hourPart = parts.find(p => p.type === "hour")?.value || "0";
  return parseInt(hourPart, 10);
}

export const attendanceService = {
  async checkIn(userId: string, location?: { latitude?: number; longitude?: number }) {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw notFound("Employee");

    const now = new Date();
    const workDate = getKolkataStartOfDay(now);
    return prisma.attendance.upsert({
      where: { employeeId_workDate: { employeeId: employee.id, workDate } },
      create: {
        employeeId: employee.id,
        workDate,
        checkInAt: now,
        isLate: getKolkataHour(now) >= lateHour,
        latitude: location?.latitude,
        longitude: location?.longitude
      },
      update: { checkInAt: now, latitude: location?.latitude, longitude: location?.longitude }
    });
  },

  async checkOut(userId: string) {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw notFound("Employee");
    const now = new Date();
    const workDate = getKolkataStartOfDay(now);
    const attendance = await prisma.attendance.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
    if (!attendance?.checkInAt) throw new ApiError(400, "Check-in required before checkout");
    const worked = Math.max(0, differenceInMinutes(now, attendance.checkInAt));
    return prisma.attendance.update({
      where: { id: attendance.id },
      data: { checkOutAt: now, workMinutes: worked, overtimeMinutes: Math.max(0, worked - standardWorkMinutes) }
    });
  },

  monthlyReport(companyId: string, month: number, year: number) {
    const from = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`);
    const totalDays = new Date(year, month, 0).getDate();
    const to = new Date(`${year}-${String(month).padStart(2, "0")}-${String(totalDays).padStart(2, "0")}T23:59:59+05:30`);
    return prisma.attendance.findMany({
      where: { employee: { companyId }, workDate: { gte: from, lte: to } },
      include: { employee: true },
      orderBy: [{ workDate: "asc" }]
    });
  },

  async monthlyReportForUser(user: AuthUser, month: number, year: number) {
    if (!user.companyId) return [];
    const from = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`);
    const totalDays = new Date(year, month, 0).getDate();
    const to = new Date(`${year}-${String(month).padStart(2, "0")}-${String(totalDays).padStart(2, "0")}T23:59:59+05:30`);

    if (user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN) {
      return this.monthlyReport(user.companyId, month, year);
    }

    const employee = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!employee) return [];

    const employeeWhere =
      user.role === Role.MANAGER
        ? { managerId: employee.id }
        : { id: employee.id };

    return prisma.attendance.findMany({
      where: { employee: employeeWhere, workDate: { gte: from, lte: to } },
      include: { employee: true },
      orderBy: [{ workDate: "asc" }]
    });
  },

  async biometricPunch(biometricId: string, punchTimeStr: string, direction?: "IN" | "OUT") {
    const employee = await prisma.employee.findUnique({ where: { biometricId } });
    if (!employee) throw notFound("Employee with biometric ID " + biometricId);

    let punchTime: Date;
    if (punchTimeStr.includes("Z") || punchTimeStr.includes("+")) {
      punchTime = new Date(punchTimeStr);
    } else {
      const isoStr = punchTimeStr.replace(" ", "T") + "+05:30";
      punchTime = new Date(isoStr);
    }

    const workDate = getKolkataStartOfDay(punchTime);

    let attendance = await prisma.attendance.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate } }
    });

    if (!attendance) {
      attendance = await prisma.attendance.create({
        data: {
          employeeId: employee.id,
          workDate,
          checkInAt: punchTime,
          isLate: getKolkataHour(punchTime) >= lateHour
        }
      });
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

    attendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkInAt,
        checkOutAt,
        isLate: checkInAt ? getKolkataHour(checkInAt) >= lateHour : false,
        workMinutes: worked,
        overtimeMinutes: Math.max(0, worked - standardWorkMinutes)
      }
    });
    return { employeeId: employee.id, type: "CHECK_OUT", attendanceId: attendance.id };
  }
};
