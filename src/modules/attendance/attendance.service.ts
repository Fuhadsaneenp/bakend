import { differenceInMinutes, endOfDay, startOfDay } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";

const lateHour = 9;
const standardWorkMinutes = 8 * 60;

export const attendanceService = {
  async checkIn(userId: string, location?: { latitude?: number; longitude?: number }) {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw notFound("Employee");

    const now = new Date();
    const workDate = startOfDay(now);
    return prisma.attendance.upsert({
      where: { employeeId_workDate: { employeeId: employee.id, workDate } },
      create: {
        employeeId: employee.id,
        workDate,
        checkInAt: now,
        isLate: now.getHours() >= lateHour,
        latitude: location?.latitude,
        longitude: location?.longitude
      },
      update: { checkInAt: now, latitude: location?.latitude, longitude: location?.longitude }
    });
  },

  async checkOut(userId: string) {
    const employee = await prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw notFound("Employee");
    const workDate = startOfDay(new Date());
    const attendance = await prisma.attendance.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
    if (!attendance?.checkInAt) throw new ApiError(400, "Check-in required before checkout");
    const now = new Date();
    const worked = Math.max(0, differenceInMinutes(now, attendance.checkInAt));
    return prisma.attendance.update({
      where: { id: attendance.id },
      data: { checkOutAt: now, workMinutes: worked, overtimeMinutes: Math.max(0, worked - standardWorkMinutes) }
    });
  },

  monthlyReport(companyId: string, month: number, year: number) {
    const from = new Date(year, month - 1, 1);
    const to = endOfDay(new Date(year, month, 0));
    return prisma.attendance.findMany({
      where: { employee: { companyId }, workDate: { gte: from, lte: to } },
      include: { employee: true },
      orderBy: [{ workDate: "asc" }]
    });
  },

  async biometricPunch(biometricId: string, punchTimeStr: string, direction?: "IN" | "OUT") {
    const employee = await prisma.employee.findUnique({ where: { biometricId } });
    if (!employee) throw notFound("Employee with biometric ID " + biometricId);

    const punchTime = new Date(punchTimeStr);
    const workDate = startOfDay(punchTime);

    let attendance = await prisma.attendance.findUnique({
      where: { employeeId_workDate: { employeeId: employee.id, workDate } }
    });

    if (!attendance) {
      attendance = await prisma.attendance.create({
        data: {
          employeeId: employee.id,
          workDate,
          checkInAt: punchTime,
          isLate: punchTime.getHours() >= lateHour
        }
      });
      return { employeeId: employee.id, type: "CHECK_IN", attendanceId: attendance.id };
    }

    const checkInAt = attendance.checkInAt || punchTime;
    const worked = Math.max(0, differenceInMinutes(punchTime, checkInAt));

    attendance = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkOutAt: punchTime,
        workMinutes: worked,
        overtimeMinutes: Math.max(0, worked - standardWorkMinutes)
      }
    });
    return { employeeId: employee.id, type: "CHECK_OUT", attendanceId: attendance.id };
  }
};
