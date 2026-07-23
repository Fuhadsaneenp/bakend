import { Prisma } from "@prisma/client";
import { endOfDay, startOfDay } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { storageService } from "../../storage/storage.service.js";
import { notificationService } from "../notifications/notification.service.js";
import { renderPayslipPdf } from "./payslip.pdf.js";
import { formatFullName } from "../../lib/formatName.js";

const decimalToNumber = (value: Prisma.Decimal | number) => Number(value);

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

function attendanceCredit(row: { checkInAt?: Date | null; checkOutAt?: Date | null }) {
  if (!row.checkInAt) return 0;
  if (!row.checkOutAt) return 0.5;
  if (getKolkataMinutes(row.checkInAt) > 13 * 60) return 0.5;
  if (getKolkataMinutes(row.checkOutAt) < 15 * 60) return 0.5;
  return 1;
}

function buildPayableDayTotal(input: {
  attendance: Array<{ checkInAt?: Date | null; checkOutAt?: Date | null; workDate: Date }>;
  wfhRequests: Array<{ startDate: Date; endDate: Date; reason: string; status: string }>;
  periodStart: Date;
  periodEnd: Date;
}) {
  const payableDays = new Map<string, number>();

  for (const row of input.attendance) {
    const credit = attendanceCredit(row);
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
  attendance: Array<{ checkInAt?: Date | null; checkOutAt?: Date | null; workDate: Date }>;
  wfhRequests: Array<{ startDate: Date; endDate: Date; reason: string; status: string }>;
  periodStart: Date;
  periodEnd: Date;
}) {
  const lopDays = new Map<string, number>();

  for (const row of input.attendance) {
    const workTime = row.workDate.getTime();
    if (workTime < input.periodStart.getTime() || workTime > input.periodEnd.getTime()) continue;

    const dayKey = formatDayKey(row.workDate);
    const attendanceLop = Math.max(0, 1 - attendanceCredit(row));
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

function computePayrollAmounts(input: {
  month: number;
  year: number;
  type: "REGULAR" | "FINAL";
  employee: {
    id: string;
    employeeCode: string;
    dateOfJoining: Date;
    dateOfExit?: Date | null;
    attendance: Array<{ checkInAt?: Date | null; checkOutAt?: Date | null; workDate: Date }>;
    wfhRequests: Array<{ startDate: Date; endDate: Date; reason: string; status: string }>;
    salary: { basic: Prisma.Decimal | number; allowances: Prisma.Decimal | number };
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

  const totalLopDays = buildLopDayTotal({
    attendance: input.employee.attendance,
    wfhRequests: input.employee.wfhRequests,
    periodStart: employeePeriodStart,
    periodEnd: employeePeriodEnd
  });
  const payableDays = Math.max(0, attendanceDays - totalLopDays);
  const proration = payableDays / totalDaysInMonth;

  return {
    attendanceDays,
    payableDays,
    basic: decimalToNumber(input.employee.salary.basic) * proration,
    allowances: decimalToNumber(input.employee.salary.allowances) * proration
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
  async generate(companyId: string, processedBy: string, month: number, year: number, type: "REGULAR" | "FINAL" = "REGULAR") {
    const existing = await prisma.payrollRun.findUnique({
      where: { companyId_month_year_type: { companyId, month, year, type } }
    });
    if (existing) throw new ApiError(409, "Payroll already generated for this period and type");

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const endOfMonthDate = new Date(year, month, 0);
    const startOfMonthDate = new Date(year, month - 1, 1);

    const employees = await prisma.employee.findMany({
      where: {
        companyId,
        status: type === "FINAL" ? "TERMINATED" : "ACTIVE",
        salary: { isNot: null },
        ...(type === "FINAL"
          ? { dateOfExit: { gte: startOfMonthDate, lte: endOfDay(endOfMonthDate) } }
          : { dateOfJoining: { lte: endOfDay(endOfMonthDate) } }
        )
      },
      include: {
        salary: true,
        user: true,
        attendance: {
          where: {
            workDate: {
              gte: startOfDay(startOfMonthDate),
              lte: endOfDay(endOfMonthDate)
            }
          }
        },
        wfhRequests: {
          where: {
            startDate: { lte: endOfDay(endOfMonthDate) },
            endDate: { gte: startOfDay(startOfMonthDate) }
          }
        }
      }
    });

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
        const { attendanceDays, payableDays, basic, allowances } = computePayrollAmounts({
          month,
          year,
          type,
          employee: {
            id: employee.id,
            employeeCode: employee.employeeCode,
            dateOfJoining: employee.dateOfJoining,
            dateOfExit: employee.dateOfExit,
            attendance: employee.attendance,
            wfhRequests: employee.wfhRequests,
            salary
          }
        });
        const deductions = decimalToNumber(salary.deductions);
        
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

    const payrollType: "REGULAR" | "FINAL" = run.status.endsWith("_FINAL") ? "FINAL" : "REGULAR";
    let grossTotal = 0;
    let netTotal = 0;

    for (const payslip of run.payslips) {
      const salary = payslip.employee.salary;
      if (!salary) continue;

      const { attendanceDays, payableDays, basic, allowances } = computePayrollAmounts({
        month: run.month,
        year: run.year,
        type: payrollType,
        employee: {
          id: payslip.employee.id,
          employeeCode: payslip.employee.employeeCode,
          dateOfJoining: payslip.employee.dateOfJoining,
          dateOfExit: payslip.employee.dateOfExit,
          attendance: payslip.employee.attendance.filter((row) => row.workDate >= startOfDay(new Date(run.year, run.month - 1, 1)) && row.workDate <= endOfDay(new Date(run.year, run.month, 0))),
          wfhRequests: payslip.employee.wfhRequests.filter((row) => row.startDate <= endOfDay(new Date(run.year, run.month, 0)) && row.endDate >= startOfDay(new Date(run.year, run.month - 1, 1))),
          salary
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
