import { Prisma } from "@prisma/client";
import { endOfDay, startOfDay } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { storageService } from "../../storage/storage.service.js";
import { notificationService } from "../notifications/notification.service.js";
import { renderPayslipPdf } from "./payslip.pdf.js";
import { formatFullName } from "../../lib/formatName.js";

const decimalToNumber = (value: Prisma.Decimal | number) => Number(value);
const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
type PayrollWeekday = typeof weekdayNames[number];

function formatDayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function parseRequestType(reason: string) {
  const match = reason.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match) {
    return match[1].trim();
  }
  return "Work From Home (WFH)";
}

function getLopDaysForRequest(input: { status: string; reason: string }) {
  const requestType = parseRequestType(input.reason).trim().toUpperCase();
  const isHalfDay = requestType.includes("HALF");
  const isUnpaid = requestType.includes("UNPAID");
  const isApproved = input.status === "APPROVED";

  // Half day should always reduce only half a day. Paid leave/WFH remain fully paid.
  if (isHalfDay) return 0.5;
  if (isUnpaid) return 1;
  if (!isApproved) return 1;
  return 0;
}

function getKolkataMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function getAttendanceWorkedMinutes(row: {
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  workMinutes?: number | null;
}) {
  const storedWorkedMinutes = Number(row.workMinutes || 0);
  if (!row.checkInAt || !row.checkOutAt) return storedWorkedMinutes;
  const calculatedWorkedMinutes = Math.max(0, Math.floor((row.checkOutAt.getTime() - row.checkInAt.getTime()) / 60_000));
  return Math.max(storedWorkedMinutes, calculatedWorkedMinutes);
}

function attendanceCredit(
  row: {
    checkInAt?: Date | null;
    checkOutAt?: Date | null;
    workMinutes?: number | null;
  },
  employee?: {
    customAttendanceHoursEnabled?: boolean | null;
    customFullDayHours?: any;
    customHalfDayHours?: any;
  } | null
) {
  if (!row.checkInAt) return 0;
  const worked = getAttendanceWorkedMinutes(row);

  if (employee?.customAttendanceHoursEnabled && employee.customFullDayHours != null) {
    const fullDayMin = Number(employee.customFullDayHours) * 60;
    const halfDayMin = employee.customHalfDayHours != null
      ? Number(employee.customHalfDayHours) * 60
      : fullDayMin / 2;

    if (worked >= fullDayMin) return 1;
    if (worked >= halfDayMin) return 0.5;
    if (!row.checkOutAt) return 0.5;
    return 0.5;
  }

  if (!row.checkOutAt) return 0.5;
  if (worked > 0 && worked < 4 * 60) return 0.5;
  if (getKolkataMinutes(row.checkInAt) > 13 * 60) return 0.5;
  if (getKolkataMinutes(row.checkOutAt) < 15 * 60) return 0.5;
  return 1;
}

function parseWorkingDays(raw: string | null | undefined): PayrollWeekday[] {
  if (!raw) return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((day): day is PayrollWeekday => weekdayNames.includes(day));
    }
  } catch {}
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
}

function weekdayNameForDate(date: Date): PayrollWeekday {
  return weekdayNames[date.getDay()];
}

function isWorkingDayForPayroll(
  date: Date,
  employee: {
    shift?: { workingDays?: string | null } | null;
    company?: { worksSevenDays?: boolean | null } | null;
  }
) {
  if (employee.company?.worksSevenDays) return true;
  const workingDays = parseWorkingDays(employee.shift?.workingDays);
  return workingDays.includes(weekdayNameForDate(date));
}

function requestDayCredit(request: { status: string; reason: string }) {
  return Math.max(0, 1 - getLopDaysForRequest(request));
}

function buildPayableDayTotal(input: {
  attendance: Array<{ checkInAt?: Date | null; checkOutAt?: Date | null; workDate: Date; workMinutes?: number | null }>;
  wfhRequests: Array<{ startDate: Date; endDate: Date; reason: string; status: string }>;
  periodStart: Date;
  periodEnd: Date;
  employee?: {
    customAttendanceHoursEnabled?: boolean | null;
    customFullDayHours?: any;
    customHalfDayHours?: any;
  } | null;
}) {
  const payableDays = new Map<string, number>();

  for (const row of input.attendance) {
    const credit = attendanceCredit(row, input.employee);
    if (credit > 0) payableDays.set(formatDayKey(row.workDate), credit);
  }

  for (const request of input.wfhRequests) {
    const lopDays = getLopDaysForRequest({ status: request.status, reason: request.reason });
    const dayCredit = Math.max(0, 1 - lopDays);
    if (dayCredit <= 0) continue;

    const effectiveStart = new Date(Math.max(request.startDate.getTime(), input.periodStart.getTime()));
    const effectiveEnd = new Date(Math.min(request.endDate.getTime(), input.periodEnd.getTime()));

    if (effectiveStart > effectiveEnd) continue;

    const cursor = new Date(effectiveStart);
    while (cursor <= effectiveEnd) {
      const dayKey = formatDayKey(cursor);
      const attendanceValue = payableDays.get(dayKey) || 0;
      payableDays.set(dayKey, Math.max(attendanceValue, dayCredit));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return Array.from(payableDays.values()).reduce((total, days) => total + days, 0);
}

function buildLopDayTotal(input: {
  attendance: Array<{ checkInAt?: Date | null; checkOutAt?: Date | null; workDate: Date; workMinutes?: number | null }>;
  wfhRequests: Array<{ startDate: Date; endDate: Date; reason: string; status: string }>;
  periodStart: Date;
  periodEnd: Date;
  employee?: {
    customAttendanceHoursEnabled?: boolean | null;
    customFullDayHours?: any;
    customHalfDayHours?: any;
  } | null;
}) {
  const lopDays = new Map<string, number>();

  for (const row of input.attendance) {
    const workTime = row.workDate.getTime();
    if (workTime < input.periodStart.getTime() || workTime > input.periodEnd.getTime()) continue;

    const dayKey = formatDayKey(row.workDate);
    const attendanceLop = Math.max(0, 1 - attendanceCredit(row, input.employee));
    if (attendanceLop > 0) lopDays.set(dayKey, Math.max(lopDays.get(dayKey) || 0, attendanceLop));
  }

  for (const request of input.wfhRequests) {
    const effectiveStart = new Date(Math.max(request.startDate.getTime(), input.periodStart.getTime()));
    const effectiveEnd = new Date(Math.min(request.endDate.getTime(), input.periodEnd.getTime()));

    if (effectiveStart > effectiveEnd) continue;

    const cursor = new Date(effectiveStart);
    while (cursor <= effectiveEnd) {
      const dayKey = formatDayKey(cursor);
      const requestLop = getLopDaysForRequest({ status: request.status, reason: request.reason });
      lopDays.set(dayKey, Math.max(lopDays.get(dayKey) || 0, requestLop));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return Array.from(lopDays.values()).reduce((sum, value) => sum + value, 0);
}

export function isMedbiomateCompany(company?: { name?: string | null; legalName?: string | null } | null): boolean {
  if (!company) return false;
  const name = (company.name || "").toLowerCase();
  const legalName = (company.legalName || "").toLowerCase();
  return name.includes("medbiomate") || legalName.includes("medbiomate");
}

export function evaluateMedbiomateAttendance(input: {
  month: number;
  year: number;
  holidays?: Array<{ date: string; isPaid?: boolean }> | null;
  employee: {
    dateOfJoining: Date;
    dateOfExit?: Date | null;
    customAttendanceHoursEnabled?: boolean | null;
    customFullDayHours?: any;
    customHalfDayHours?: any;
    attendance: Array<{ checkInAt?: Date | null; checkOutAt?: Date | null; workDate: Date; workMinutes?: number | null }>;
    wfhRequests: Array<{ startDate: Date; endDate: Date; reason: string; status: string }>;
  };
  employeePeriodStart: Date;
  employeePeriodEnd: Date;
}): { dayCredits: Map<string, number>; weeklyBonus: number } {
  const totalDaysInMonth = new Date(input.year, input.month, 0).getDate();
  const paidHolidaySet = new Set<string>();
  if (Array.isArray(input.holidays)) {
    for (const h of input.holidays) {
      if (h && h.date && h.isPaid !== false) {
        paidHolidaySet.add(h.date);
      }
    }
  }

  // Pre-calculate raw credits for each date in a window around the month
  const rawDayCredits = new Map<string, number>();

  const getRawDayCredit = (dateStr: string) => {
    if (paidHolidaySet.has(dateStr)) return 1.0;

    let credit = 0;
    for (const row of input.employee.attendance) {
      if (formatDayKey(row.workDate) === dateStr) {
        credit = Math.max(credit, attendanceCredit(row, input.employee));
      }
    }

    for (const req of input.employee.wfhRequests) {
      const startKey = formatDayKey(req.startDate);
      const endKey = formatDayKey(req.endDate);
      if (dateStr >= startKey && dateStr <= endKey) {
        credit = Math.max(credit, requestDayCredit(req));
      }
    }

    return credit;
  };

  const windowStart = new Date(input.year, input.month - 1, 1 - 10, 12, 0, 0);
  const windowEnd = new Date(input.year, input.month, 10, 12, 0, 0);
  const cur = new Date(windowStart);
  while (cur <= windowEnd) {
    const k = formatDayKey(cur);
    rawDayCredits.set(k, getRawDayCredit(k));
    cur.setDate(cur.getDate() + 1);
  }

  const finalDayCredits = new Map<string, number>();
  let totalWeeklyBonus = 0;

  const startOfMonthDate = new Date(input.year, input.month - 1, 1, 12, 0, 0);
  const endOfMonthDate = new Date(input.year, input.month, 0, 12, 0, 0);

  // Find Monday of the first week touching day 1
  const day1Js = startOfMonthDate.getDay();
  const day1Iso = day1Js === 0 ? 7 : day1Js;
  const firstMonday = new Date(input.year, input.month - 1, 1 - (day1Iso - 1), 12, 0, 0);

  let currentMonday = new Date(firstMonday);

  while (currentMonday <= endOfMonthDate) {
    const weekSunday = new Date(currentMonday.getTime() + 6 * 24 * 60 * 60 * 1000);
    const isWeekCompletedInCurrentMonth = weekSunday <= endOfMonthDate;

    const weekDates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      weekDates.push(new Date(currentMonday.getTime() + i * 24 * 60 * 60 * 1000));
    }

    const [monD, tueD, wedD, thuD, friD, satD, sunD] = weekDates;
    const monKey = formatDayKey(monD);
    const tueKey = formatDayKey(tueD);
    const wedKey = formatDayKey(wedD);
    const thuKey = formatDayKey(thuD);
    const friKey = formatDayKey(friD);
    const satKey = formatDayKey(satD);
    const sunKey = formatDayKey(sunD);

    const cMon = rawDayCredits.get(monKey) ?? 0;
    const cTue = rawDayCredits.get(tueKey) ?? 0;
    const cWed = rawDayCredits.get(wedKey) ?? 0;
    const cThu = rawDayCredits.get(thuKey) ?? 0;
    const cFri = rawDayCredits.get(friKey) ?? 0;
    const cSat = rawDayCredits.get(satKey) ?? 0;
    const cSun = rawDayCredits.get(sunKey) ?? 0;

    const weekdaysWorked = cMon + cTue + cWed + cThu + cFri;
    const totalDaysWorked = weekdaysWorked + cSat + cSun;
    const satWorked = cSat >= 0.5;
    const sunWorked = cSun >= 0.5;

    if (!isWeekCompletedInCurrentMonth) {
      // Incomplete week carried forward: record raw worked credit for days within current month.
      // The week's Sunday resolution (weekly off / 7th day bonus) is evaluated in the next month.
      for (const d of weekDates) {
        if (d.getMonth() + 1 === input.month && d.getFullYear() === input.year) {
          const k = formatDayKey(d);
          finalDayCredits.set(k, rawDayCredits.get(k) ?? 0);
        }
      }
    } else {
      // Complete week resolved in this month:
      let weekDayResolvedCredits: Record<string, number> = {
        [monKey]: cMon,
        [tueKey]: cTue,
        [wedKey]: cWed,
        [thuKey]: cThu,
        [friKey]: cFri,
        [satKey]: cSat,
        [sunKey]: cSun
      };

      if (totalDaysWorked >= 7) {
        // All 7 days worked: full pay + ₹400 bonus for 7th day
        weekDayResolvedCredits[monKey] = 1.0;
        weekDayResolvedCredits[tueKey] = 1.0;
        weekDayResolvedCredits[wedKey] = 1.0;
        weekDayResolvedCredits[thuKey] = 1.0;
        weekDayResolvedCredits[friKey] = 1.0;
        weekDayResolvedCredits[satKey] = 1.0;
        weekDayResolvedCredits[sunKey] = 1.0;
        totalWeeklyBonus += 400;
      } else if (totalDaysWorked >= 6) {
        // 6 working days completed: full salary for the week (7 paid days)
        weekDayResolvedCredits[monKey] = 1.0;
        weekDayResolvedCredits[tueKey] = 1.0;
        weekDayResolvedCredits[wedKey] = 1.0;
        weekDayResolvedCredits[thuKey] = 1.0;
        weekDayResolvedCredits[friKey] = 1.0;
        weekDayResolvedCredits[satKey] = 1.0;
        weekDayResolvedCredits[sunKey] = 1.0;
      } else {
        // Fewer than 6 working days:
        if (satWorked && !sunWorked) {
          // Worked Saturday, took Sunday off -> Sunday is Paid Weekly Leave
          weekDayResolvedCredits[sunKey] = 1.0;
          weekDayResolvedCredits[satKey] = cSat;
        } else if (!satWorked && sunWorked) {
          // Worked Sunday, took Saturday off -> Saturday is Paid Weekly Leave
          weekDayResolvedCredits[satKey] = 1.0;
          weekDayResolvedCredits[sunKey] = cSun;
        } else if (!satWorked && !sunWorked) {
          // Took leave on both Saturday and Sunday:
          // "If an employee takes leave on both Saturday and Sunday, only one day will be paid; the other will be treated as unpaid leave."
          weekDayResolvedCredits[sunKey] = 1.0; // Paid weekly leave
          weekDayResolvedCredits[satKey] = 0.0; // Unpaid leave (LOP)
        } else {
          // Both worked partially or worked Sat & Sun but took multiple weekdays off
          const uncreditedDays = [monKey, tueKey, wedKey, thuKey, friKey, satKey, sunKey].filter(k => (weekDayResolvedCredits[k] || 0) < 1);
          if (uncreditedDays.length > 0) {
            // Treat 1 day off as paid weekly leave
            weekDayResolvedCredits[uncreditedDays[uncreditedDays.length - 1]] = 1.0;
          }
        }
      }

      // Record final credits for days in Month M
      for (const d of weekDates) {
        if (d.getMonth() + 1 === input.month && d.getFullYear() === input.year) {
          const k = formatDayKey(d);
          finalDayCredits.set(k, weekDayResolvedCredits[k] ?? (rawDayCredits.get(k) ?? 0));
        }
      }
    }

    currentMonday.setDate(currentMonday.getDate() + 7);
  }

  // Ensure every day of Month M has an entry
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dayStr = String(day).padStart(2, "0");
    const monthStr = String(input.month).padStart(2, "0");
    const dayKey = `${input.year}-${monthStr}-${dayStr}`;
    if (!finalDayCredits.has(dayKey)) {
      finalDayCredits.set(dayKey, rawDayCredits.get(dayKey) ?? 0);
    }
  }

  return {
    dayCredits: finalDayCredits,
    weeklyBonus: totalWeeklyBonus
  };
}

export function buildAttendanceSnapshot(input: {
  month: number;
  year: number;
  type: "REGULAR" | "FINAL";
  holidays?: Array<{ date: string; isPaid?: boolean }> | null;
  employee: {
    dateOfJoining: Date;
    dateOfExit?: Date | null;
    shift?: { workingDays?: string | null } | null;
    company?: { name?: string | null; legalName?: string | null; worksSevenDays?: boolean | null } | null;
    customAttendanceHoursEnabled?: boolean | null;
    customFullDayHours?: any;
    customHalfDayHours?: any;
    attendance: Array<{ checkInAt?: Date | null; checkOutAt?: Date | null; workDate: Date; workMinutes?: number | null }>;
    wfhRequests: Array<{ startDate: Date; endDate: Date; reason: string; status: string }>;
  };
}) {
  const endOfMonthDate = new Date(input.year, input.month, 0);
  const startOfMonthDate = new Date(input.year, input.month - 1, 1);
  const totalDaysInMonth = endOfMonthDate.getDate();

  let attendanceDays = totalDaysInMonth;
  if (input.type === "FINAL" && input.employee.dateOfExit) {
    attendanceDays = input.employee.dateOfExit.getDate();
  } else if (input.employee.dateOfJoining > startOfMonthDate) {
    attendanceDays = totalDaysInMonth - input.employee.dateOfJoining.getDate() + 1;
  }

  const employeePeriodStart =
    input.employee.dateOfJoining > startOfMonthDate
      ? startOfDay(input.employee.dateOfJoining)
      : startOfDay(startOfMonthDate);
  const employeePeriodEnd =
    input.type === "FINAL" && input.employee.dateOfExit
      ? endOfDay(input.employee.dateOfExit)
      : endOfDay(endOfMonthDate);

  const dayCredits = new Map<string, number>();
  let medbiomateBonus = 0;

  if (isMedbiomateCompany(input.employee.company)) {
    const medResult = evaluateMedbiomateAttendance({
      month: input.month,
      year: input.year,
      holidays: input.holidays,
      employee: input.employee,
      employeePeriodStart,
      employeePeriodEnd
    });
    for (const [key, cred] of medResult.dayCredits.entries()) {
      dayCredits.set(key, cred);
    }
    medbiomateBonus = medResult.weeklyBonus;
  } else {
    // Standard calculation for non-Medbiomate companies
    const paidHolidaySet = new Set<string>();
    if (Array.isArray(input.holidays)) {
      for (const h of input.holidays) {
        if (h && h.date && h.isPaid !== false) {
          paidHolidaySet.add(h.date);
        }
      }
    }

    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dayStr = String(day).padStart(2, "0");
      const monthStr = String(input.month).padStart(2, "0");
      const dayKey = `${input.year}-${monthStr}-${dayStr}`;
      const dayDate = new Date(input.year, input.month - 1, day, 12, 0, 0);

      if (dayDate >= startOfDay(employeePeriodStart) && dayDate <= endOfDay(employeePeriodEnd)) {
        const isWorkingDay = isWorkingDayForPayroll(dayDate, input.employee);
        const isPaidHoliday = paidHolidaySet.has(dayKey);
        dayCredits.set(dayKey, (!isWorkingDay || isPaidHoliday) ? 1 : 0);
      }
    }

    for (const row of input.employee.attendance) {
      const dayKey = formatDayKey(row.workDate);
      const currentCredit = dayCredits.get(dayKey) ?? 0;
      dayCredits.set(dayKey, Math.max(currentCredit, attendanceCredit(row, input.employee)));
    }

    const wfhRequestsInPeriod = input.employee.wfhRequests.filter(
      (row) => row.startDate.getTime() <= employeePeriodEnd.getTime() && row.endDate.getTime() >= employeePeriodStart.getTime()
    );

    for (const request of wfhRequestsInPeriod) {
      const effectiveStart = new Date(Math.max(request.startDate.getTime(), employeePeriodStart.getTime()));
      const effectiveEnd = new Date(Math.min(request.endDate.getTime(), employeePeriodEnd.getTime()));
      if (effectiveStart > effectiveEnd) continue;

      const requestCursor = new Date(effectiveStart);
      while (requestCursor <= effectiveEnd) {
        const dayKey = formatDayKey(requestCursor);
        const currentCredit = dayCredits.get(dayKey) ?? 0;
        dayCredits.set(dayKey, Math.max(currentCredit, requestDayCredit(request)));
        requestCursor.setDate(requestCursor.getDate() + 1);
      }
    }
  }

  let payableDays = 0;
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dayDate = new Date(input.year, input.month - 1, day, 12, 0, 0);
    if (dayDate >= startOfDay(employeePeriodStart) && dayDate <= endOfDay(employeePeriodEnd)) {
      const dayKey = `${input.year}-${String(input.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      payableDays += (dayCredits.get(dayKey) ?? 0);
    }
  }
  const lopDays = Math.max(0, attendanceDays - payableDays);

  return {
    attendanceDays,
    payableDays: Math.max(0, Math.min(attendanceDays, payableDays)),
    lopDays,
    dayCredits,
    medbiomateBonus,
    employeePeriodStart,
    employeePeriodEnd
  };
}

export function computePayrollAmounts(input: {
  month: number;
  year: number;
  type: "REGULAR" | "FINAL";
  holidays?: Array<{ date: string; isPaid?: boolean }> | null;
  employee: {
    id: string;
    employeeCode: string;
    dateOfJoining: Date;
    dateOfExit?: Date | null;
    shift?: { workingDays?: string | null } | null;
    company?: { name?: string | null; legalName?: string | null; worksSevenDays?: boolean | null } | null;
    attendance: Array<{ checkInAt?: Date | null; checkOutAt?: Date | null; workDate: Date; workMinutes?: number | null }>;
    wfhRequests: Array<{ startDate: Date; endDate: Date; reason: string; status: string }>;
    salary: { basic: Prisma.Decimal | number; allowances: Prisma.Decimal | number; deductions?: Prisma.Decimal | number; effectiveFrom?: Date | string };
    salaryHistory?: Array<{ basic: Prisma.Decimal | number; allowances: Prisma.Decimal | number; deductions?: Prisma.Decimal | number; effectiveFrom: Date | string }>;
  };
}) {
  const totalDaysInMonth = new Date(input.year, input.month, 0).getDate();
  const snapshot = buildAttendanceSnapshot(input);

  // Collect all available salary revisions
  const revisions: Array<{ basic: number; allowances: number; deductions: number; effectiveFrom: Date }> = [];

  if (input.employee.salaryHistory && input.employee.salaryHistory.length > 0) {
    for (const h of input.employee.salaryHistory) {
      revisions.push({
        basic: decimalToNumber(h.basic),
        allowances: decimalToNumber(h.allowances),
        deductions: decimalToNumber(h.deductions ?? 0),
        effectiveFrom: new Date(h.effectiveFrom)
      });
    }
  }

  // Also include the current salary record if not already present
  if (input.employee.salary) {
    const sEff = input.employee.salary.effectiveFrom ? new Date(input.employee.salary.effectiveFrom) : input.employee.dateOfJoining;
    const exists = revisions.some((r) => r.effectiveFrom.getTime() === sEff.getTime());
    if (!exists) {
      revisions.push({
        basic: decimalToNumber(input.employee.salary.basic),
        allowances: decimalToNumber(input.employee.salary.allowances),
        deductions: decimalToNumber(input.employee.salary.deductions ?? 0),
        effectiveFrom: sEff
      });
    }
  }

  // Sort revisions chronologically by effectiveFrom
  revisions.sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());

  // Helper to get active salary for any specific calendar date
  const getSalaryForDate = (date: Date) => {
    if (revisions.length === 0) {
      return {
        basic: decimalToNumber(input.employee.salary?.basic ?? 0),
        allowances: decimalToNumber(input.employee.salary?.allowances ?? 0),
        deductions: decimalToNumber(input.employee.salary?.deductions ?? 0)
      };
    }
    let active = revisions[0];
    const targetTime = endOfDay(date).getTime();
    for (const rev of revisions) {
      if (rev.effectiveFrom.getTime() <= targetTime) {
        active = rev;
      } else {
        break;
      }
    }
    return active;
  };

  // Day-by-day calculation across the calendar days of the month
  let totalBasic = 0;
  let totalAllowances = 0;
  let totalDeductions = 0;

  for (let day = 1; day <= totalDaysInMonth; day++) {
    const dayStr = String(day).padStart(2, "0");
    const monthStr = String(input.month).padStart(2, "0");
    const dayKey = `${input.year}-${monthStr}-${dayStr}`;
    const dayDate = new Date(input.year, input.month - 1, day, 12, 0, 0);

    if (dayDate < startOfDay(snapshot.employeePeriodStart) || dayDate > endOfDay(snapshot.employeePeriodEnd)) {
      continue;
    }

    const dayCredit = snapshot.dayCredits.get(dayKey) ?? 0;
    const sal = getSalaryForDate(dayDate);

    totalBasic += (sal.basic / totalDaysInMonth) * dayCredit;
    totalAllowances += (sal.allowances / totalDaysInMonth) * dayCredit;
    totalDeductions += (sal.deductions / totalDaysInMonth) * (dayCredit > 0 ? 1 : 0);
  }

  // Add Medbiomate 7th day weekly bonus (₹400 for each full 7-day completed week)
  totalAllowances += snapshot.medbiomateBonus;

  return {
    attendanceDays: snapshot.attendanceDays,
    payableDays: snapshot.payableDays,
    lopDays: snapshot.lopDays,
    basic: Math.round(totalBasic * 100) / 100,
    allowances: Math.round(totalAllowances * 100) / 100,
    deductions: Math.round(totalDeductions * 100) / 100
  };
}

async function deliverPayslipById(payslipId: string) {
  const payslip = await prisma.payslip.findUnique({
    where: { id: payslipId },
    include: { employee: { include: { user: true } } }
  });
  if (!payslip || !payslip.pdfKey) throw new ApiError(404, "Payslip PDF not found");

  const pdfUrl = storageService.publicUrl(payslip.pdfKey);
  const pdf = await storageService.getObject(payslip.pdfKey);
  await notificationService.sendPayslip({
    userId: payslip.employee.userId,
    email: payslip.employee.user.email,
    phone: payslip.employee.phone,
    employeeName: formatFullName(payslip.employee),
    month: payslip.month,
    year: payslip.year,
    pdf,
    pdfUrl,
    filename: `${payslip.payslipNumber}.pdf`
  });

  return prisma.payslip.update({ where: { id: payslip.id }, data: { sentAt: new Date() } });
}

export const payrollService = {
  async generate(companyId: string, processedBy: string, month: number, year: number, type: "REGULAR" | "FINAL" = "REGULAR", employeeId?: string) {
    const existing = await prisma.payrollRun.findUnique({
      where: { companyId_month_year_type: { companyId, month, year, type } }
    });
    if (existing) {
      if (existing.status.startsWith("DRAFT")) {
        await prisma.$transaction([
          prisma.payslip.deleteMany({ where: { payrollRunId: existing.id } }),
          prisma.payrollRun.delete({ where: { id: existing.id } })
        ]);
      } else {
        throw new ApiError(409, "Payroll already generated and approved/paid for this period and type");
      }
    }

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const holidaySetting = await prisma.companySetting.findUnique({
      where: { companyId_key: { companyId, key: "timeoff_holidays" } }
    });
    const holidays = Array.isArray(holidaySetting?.value)
      ? (holidaySetting.value as Array<{ date: string; isPaid?: boolean }>)
      : [];
    const endOfMonthDate = new Date(year, month, 0);
    const startOfMonthDate = new Date(year, month - 1, 1);

    const employees = await prisma.employee.findMany({
      where: {
        companyId,
        salary: { isNot: null },
        ...(employeeId
          ? { id: employeeId }
          : type === "FINAL"
            ? {
                OR: [
                  { status: "TERMINATED" },
                  { status: "INACTIVE" },
                  { dateOfExit: { not: null } }
                ]
              }
            : {
                status: "ACTIVE",
                dateOfJoining: { lte: endOfDay(endOfMonthDate) }
              }
        )
      },
      include: {
        salary: true,
        salaryHistory: { orderBy: { effectiveFrom: "asc" } },
        shift: true,
        company: true,
        user: true,
        attendance: {
          where: {
            workDate: {
              gte: startOfDay(new Date(year, month - 1, 1 - 10)),
              lte: endOfDay(new Date(year, month, 10))
            }
          }
        },
        wfhRequests: {
          where: {
            startDate: { lte: endOfDay(new Date(year, month, 10)) },
            endDate: { gte: startOfDay(new Date(year, month - 1, 1 - 10)) }
          }
        }
      }
    });

    if (employees.length === 0) {
      if (type === "FINAL") {
        throw new ApiError(400, "No eligible offboarded employee found with salary details for final settlement.");
      }
      throw new ApiError(400, "No active employees found with salary details for this period.");
    }

    let grossTotal = 0;
    let netTotal = 0;

    const run = await prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: {
          companyId,
          month,
          year,
          processedBy,
          type,
          grossTotal: 0,
          netTotal: 0,
          status: type === "FINAL" ? "DRAFT_FINAL" : "DRAFT"
        }
      });

      for (const employee of employees) {
        const salary = employee.salary!;
        const { attendanceDays, payableDays, basic, allowances, deductions: computedDeductions } = computePayrollAmounts({
          month,
          year,
          type,
          holidays,
          employee: {
            id: employee.id,
            employeeCode: employee.employeeCode,
            dateOfJoining: employee.dateOfJoining,
            dateOfExit: employee.dateOfExit,
            shift: employee.shift,
            company: employee.company,
            attendance: employee.attendance,
            wfhRequests: employee.wfhRequests,
            salary,
            salaryHistory: employee.salaryHistory
          }
        });
        const deductions = (employee.salaryHistory && employee.salaryHistory.length > 1)
          ? computedDeductions
          : decimalToNumber(salary.deductions);
        
        const grossPay = basic + allowances;
        const netPay = Math.max(0, grossPay - deductions);
        
        grossTotal += grossPay;
        netTotal += netPay;

        const payslipNumber = `PS-${year}${String(month).padStart(2, "0")}-${employee.employeeCode}${type === "FINAL" ? "-F" : ""}`;
        const pdf = await renderPayslipPdf({
          companyName: company.name,
          employeeName: formatFullName(employee),
          employeeCode: employee.employeeCode,
          payslipNumber,
          month,
          year,
          basic,
          allowances,
          deductions,
          grossPay,
          netPay,
          attendanceDays,
          payableDays
        });
        const pdfKey = `companies/${companyId}/payslips/${year}-${month}/${employee.id}${type === "FINAL" ? "-final" : ""}.pdf`;
        await storageService.putObject(pdfKey, pdf, "application/pdf");

        await tx.payslip.create({
          data: {
            payrollRunId: run.id,
            employeeId: employee.id,
            payslipNumber,
            month,
            year,
            basic,
            allowances,
            deductions,
            attendanceDays,
            payableDays,
            grossPay,
            netPay,
            pdfKey
          }
        });
      }

      return tx.payrollRun.update({
        where: { id: run.id },
        data: { grossTotal, netTotal },
        include: { payslips: { include: { employee: true } } }
      });
    });

    const dispatchSummary = {
      attempted: run.payslips.length,
      sent: 0,
      failed: 0,
      failures: [] as Array<{ payslipId: string; employeeId: string; employeeName: string; reason: string }>
    };

    for (const payslip of run.payslips) {
      try {
        await deliverPayslipById(payslip.id);
        dispatchSummary.sent += 1;
      } catch (error) {
        dispatchSummary.failed += 1;
        dispatchSummary.failures.push({
          payslipId: payslip.id,
          employeeId: payslip.employeeId,
          employeeName: formatFullName(payslip.employee),
          reason: error instanceof Error ? error.message : "Unknown delivery error"
        });
      }
    }

    return {
      ...run,
      dispatchSummary
    };
  },

  async updatePayslip(
    companyId: string,
    payslipId: string,
    data: {
      payableDays: number;
      basic: number;
      allowances: number;
      deductions: number;
      gratuity?: number;
      leaveEncashment?: number;
      noticePay?: number;
    }
  ) {
    const payslip = await prisma.payslip.findFirst({
      where: { id: payslipId, payrollRun: { companyId } },
      include: { employee: { include: { company: true } }, payrollRun: true }
    });
    if (!payslip) throw new ApiError(404, "Payslip not found");
    if (payslip.payrollRun.status !== "DRAFT" && payslip.payrollRun.status !== "DRAFT_FINAL") {
      throw new ApiError(400, "Can only modify payslips in a DRAFT payroll run");
    }

    const gratuity = Number(data.gratuity || 0);
    const leaveEncashment = Number(data.leaveEncashment || 0);
    const noticePay = Number(data.noticePay || 0);

    const grossPay = Number(data.basic) + Number(data.allowances) + gratuity + leaveEncashment + noticePay;
    const netPay = Math.max(0, grossPay - Number(data.deductions));

    // Map additional fields into allowances/deductions for PDF presentation to avoid layout shifts
    const pdfAllowances = Number(data.allowances) + gratuity + leaveEncashment + (noticePay > 0 ? noticePay : 0);
    const pdfDeductions = Number(data.deductions) + (noticePay < 0 ? Math.abs(noticePay) : 0);

    const pdf = await renderPayslipPdf({
      companyName: payslip.employee.company.name,
      employeeName: formatFullName(payslip.employee),
      employeeCode: payslip.employee.employeeCode,
      payslipNumber: payslip.payslipNumber,
      month: payslip.month,
      year: payslip.year,
      basic: Number(data.basic),
      allowances: pdfAllowances,
      deductions: pdfDeductions,
      grossPay,
      netPay,
      attendanceDays: Number(payslip.attendanceDays),
      payableDays: data.payableDays
    });
    const pdfKey = payslip.pdfKey || `companies/${companyId}/payslips/${payslip.year}-${payslip.month}/${payslip.employeeId}.pdf`;
    await storageService.putObject(pdfKey, pdf, "application/pdf");

    return prisma.$transaction(async (tx) => {
      const updatedPayslip = await tx.payslip.update({
        where: { id: payslipId },
        data: {
          payableDays: data.payableDays,
          basic: data.basic,
          allowances: data.allowances,
          deductions: data.deductions,
          gratuity,
          leaveEncashment,
          noticePay,
          grossPay,
          netPay,
          pdfKey
        },
        include: { employee: true }
      });

      const runPayslips = await tx.payslip.findMany({
        where: { payrollRunId: payslip.payrollRunId }
      });

      const grossTotal = runPayslips.reduce((sum, p) => sum + Number(p.grossPay), 0);
      const netTotal = runPayslips.reduce((sum, p) => sum + Number(p.netPay), 0);

      const updatedRun = await tx.payrollRun.update({
        where: { id: payslip.payrollRunId },
        data: { grossTotal, netTotal }
      });

      return { payslip: updatedPayslip, run: updatedRun };
    });
  },

  async recalculateDraftRun(companyId: string, runId: string) {
    const run = await prisma.payrollRun.findFirst({
      where: { id: runId, companyId },
      include: {
        company: true,
        payslips: {
          include: {
            employee: {
              include: {
                salary: true,
                salaryHistory: { orderBy: { effectiveFrom: "asc" } },
                shift: true,
                company: true,
                attendance: true,
                wfhRequests: true
              }
            }
          }
        }
      }
    });
    if (!run) throw new ApiError(404, "Payroll run not found");
    if (run.status !== "DRAFT" && run.status !== "DRAFT_FINAL") return run;

    const holidaySetting = await prisma.companySetting.findUnique({
      where: { companyId_key: { companyId, key: "timeoff_holidays" } }
    });
    const holidays = Array.isArray(holidaySetting?.value)
      ? (holidaySetting.value as Array<{ date: string; isPaid?: boolean }>)
      : [];

    const payrollType: "REGULAR" | "FINAL" = run.status.endsWith("_FINAL") ? "FINAL" : "REGULAR";
    let grossTotal = 0;
    let netTotal = 0;

    for (const payslip of run.payslips) {
      const salary = payslip.employee.salary;
      if (!salary) continue;

      const { attendanceDays, payableDays, basic, allowances, deductions: computedDeductions } = computePayrollAmounts({
        month: run.month,
        year: run.year,
        type: payrollType,
        holidays,
        employee: {
          id: payslip.employee.id,
          employeeCode: payslip.employee.employeeCode,
          dateOfJoining: payslip.employee.dateOfJoining,
          dateOfExit: payslip.employee.dateOfExit,
          shift: payslip.employee.shift,
          company: payslip.employee.company,
          attendance: payslip.employee.attendance.filter(
            (row) => row.workDate >= startOfDay(new Date(run.year, run.month - 1, 1 - 10)) && row.workDate <= endOfDay(new Date(run.year, run.month, 10))
          ),
          wfhRequests: payslip.employee.wfhRequests.filter(
            (row) => row.startDate <= endOfDay(new Date(run.year, run.month, 10)) && row.endDate >= startOfDay(new Date(run.year, run.month - 1, 1 - 10))
          ),
          salary,
          salaryHistory: payslip.employee.salaryHistory
        }
      });

      const deductions = Number(payslip.deductions || 0);
      const gratuity = Number(payslip.gratuity || 0);
      const leaveEncashment = Number(payslip.leaveEncashment || 0);
      const noticePay = Number(payslip.noticePay || 0);
      const grossPay = basic + allowances + gratuity + leaveEncashment + noticePay;
      const netPay = Math.max(0, grossPay - deductions);

      const pdfAllowances = allowances + gratuity + leaveEncashment + (noticePay > 0 ? noticePay : 0);
      const pdfDeductions = deductions + (noticePay < 0 ? Math.abs(noticePay) : 0);
      const pdfKey = payslip.pdfKey || `companies/${companyId}/payslips/${run.year}-${run.month}/${payslip.employeeId}.pdf`;
      const pdf = await renderPayslipPdf({
        companyName: run.company.name,
        employeeName: formatFullName(payslip.employee),
        employeeCode: payslip.employee.employeeCode,
        payslipNumber: payslip.payslipNumber,
        month: run.month,
        year: run.year,
        basic,
        allowances: pdfAllowances,
        deductions: pdfDeductions,
        grossPay,
        netPay,
        attendanceDays,
        payableDays
      });
      await storageService.putObject(pdfKey, pdf, "application/pdf");

      await prisma.payslip.update({
        where: { id: payslip.id },
        data: {
          attendanceDays,
          payableDays,
          basic,
          allowances,
          grossPay,
          netPay,
          pdfKey
        }
      });

      grossTotal += grossPay;
      netTotal += netPay;
    }

    return prisma.payrollRun.update({
      where: { id: run.id },
      data: { grossTotal, netTotal },
      include: { payslips: { include: { employee: { include: { salary: true } } } } }
    });
  },

  async recalculateDraftRunsForPeriods(companyId: string, periods: Array<{ month: number; year: number }>) {
    const uniquePeriods = Array.from(
      new Map(
        periods
          .filter((period) => period.month >= 1 && period.month <= 12 && period.year >= 2020)
          .map((period) => [`${period.year}-${period.month}`, period] as const)
      ).values()
    );

    if (uniquePeriods.length === 0) return [];

    const runs = await prisma.payrollRun.findMany({
      where: {
        companyId,
        status: { in: ["DRAFT", "DRAFT_FINAL"] },
        OR: uniquePeriods.map((period) => ({ month: period.month, year: period.year }))
      },
      select: { id: true }
    });

    const recalculatedRuns = [];
    for (const run of runs) {
      recalculatedRuns.push(await this.recalculateDraftRun(companyId, run.id));
    }
    return recalculatedRuns;
  },

  async skipPayslip(companyId: string, payslipId: string) {
    const payslip = await prisma.payslip.findFirst({
      where: { id: payslipId, payrollRun: { companyId } },
      include: { payrollRun: true }
    });
    if (!payslip) throw new ApiError(404, "Payslip not found");
    if (payslip.payrollRun.status !== "DRAFT") {
      throw new ApiError(400, "Can only skip employees in a DRAFT payroll run");
    }

    return prisma.$transaction(async (tx) => {
      await tx.payslip.delete({ where: { id: payslipId } });

      const runPayslips = await tx.payslip.findMany({
        where: { payrollRunId: payslip.payrollRunId }
      });

      const grossTotal = runPayslips.reduce((sum, p) => sum + Number(p.grossPay), 0);
      const netTotal = runPayslips.reduce((sum, p) => sum + Number(p.netPay), 0);

      const updatedRun = await tx.payrollRun.update({
        where: { id: payslip.payrollRunId },
        data: { grossTotal, netTotal },
        include: { payslips: { include: { employee: true } } }
      });

      return updatedRun;
    });
  },

  async sendPayslip(payslipId: string) {
    return deliverPayslipById(payslipId);
  },

  async sendAllPayslips(runId: string) {
    const payslips = await prisma.payslip.findMany({
      where: { payrollRunId: runId }
    });
    const results = [];
    for (const payslip of payslips) {
      try {
        await deliverPayslipById(payslip.id);
        results.push({ id: payslip.id, success: true });
      } catch (error) {
        results.push({ id: payslip.id, success: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }
};
