import { Prisma } from "@prisma/client";
import { endOfDay, startOfDay } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { storageService } from "../../storage/storage.service.js";
import { notificationService } from "../notifications/notification.service.js";
import { renderPayslipPdf } from "./payslip.pdf.js";

const decimalToNumber = (value: Prisma.Decimal | number) => Number(value);

function formatDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseRequestType(reason: string) {
  const match = reason.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match) {
    return match[1].trim();
  }
  return "Work From Home (WFH)";
}

function isPayrollCreditedRequest(reason: string) {
  const normalizedType = parseRequestType(reason).trim().toUpperCase();
  return normalizedType === "PAID LEAVE" || normalizedType === "WORK FROM HOME (WFH)" || normalizedType === "WFH";
}

function buildPayableDaySet(input: {
  attendance: Array<{ checkInAt?: Date | null; workDate: Date }>;
  wfhRequests: Array<{ startDate: Date; endDate: Date; reason: string }>;
  periodStart: Date;
  periodEnd: Date;
}) {
  const payableDays = new Set<string>();

  for (const row of input.attendance) {
    if (row.checkInAt) {
      payableDays.add(formatDayKey(row.workDate));
    }
  }

  for (const request of input.wfhRequests) {
    if (!isPayrollCreditedRequest(request.reason)) continue;

    const effectiveStart = new Date(Math.max(request.startDate.getTime(), input.periodStart.getTime()));
    const effectiveEnd = new Date(Math.min(request.endDate.getTime(), input.periodEnd.getTime()));

    if (effectiveStart > effectiveEnd) continue;

    const cursor = new Date(effectiveStart);
    while (cursor <= effectiveEnd) {
      payableDays.add(formatDayKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return payableDays;
}

async function deliverPayslipById(payslipId: string) {
  const payslip = await prisma.payslip.findUnique({
    where: { id: payslipId },
    include: { employee: { include: { user: true, company: true } } }
  });
  if (!payslip?.pdfKey) throw new ApiError(404, "Payslip PDF not found");

  const pdfUrl = storageService.publicUrl(payslip.pdfKey);
  const pdf = await storageService.getObject(payslip.pdfKey);
  await notificationService.sendPayslip({
    userId: payslip.employee.userId,
    email: payslip.employee.user.email,
    phone: payslip.employee.phone,
    employeeName: `${payslip.employee.firstName} ${payslip.employee.lastName}`,
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
            status: "APPROVED",
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
        const totalDaysInMonth = endOfMonthDate.getDate();
        
        let attendanceDays = totalDaysInMonth;
        
        if (type === "FINAL" && employee.dateOfExit) {
          attendanceDays = employee.dateOfExit.getDate();
        } else if (employee.dateOfJoining > startOfMonthDate) {
          attendanceDays = totalDaysInMonth - employee.dateOfJoining.getDate() + 1;
        }

        const employeePeriodStart = employee.dateOfJoining > startOfMonthDate ? startOfDay(employee.dateOfJoining) : startOfDay(startOfMonthDate);
        const employeePeriodEnd =
          type === "FINAL" && employee.dateOfExit
            ? endOfDay(employee.dateOfExit)
            : endOfDay(endOfMonthDate);

        const payableDaySet = buildPayableDaySet({
          attendance: employee.attendance,
          wfhRequests: employee.wfhRequests,
          periodStart: employeePeriodStart,
          periodEnd: employeePeriodEnd
        });
        const payableDays = Math.min(attendanceDays, payableDaySet.size);

        const proration = payableDays / totalDaysInMonth;
        const basic = decimalToNumber(salary.basic) * proration;
        const allowances = decimalToNumber(salary.allowances) * proration;
        const deductions = decimalToNumber(salary.deductions);
        
        const grossPay = basic + allowances;
        const netPay = Math.max(0, grossPay - deductions);
        
        grossTotal += grossPay;
        netTotal += netPay;

        const payslipNumber = `PS-${year}${String(month).padStart(2, "0")}-${employee.employeeCode}${type === "FINAL" ? "-F" : ""}`;
        const pdf = await renderPayslipPdf({
          companyName: company.name,
          employeeName: `${employee.firstName} ${employee.lastName}`,
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
          employeeName: `${payslip.employee.firstName} ${payslip.employee.lastName}`,
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
      employeeName: `${payslip.employee.firstName} ${payslip.employee.lastName}`,
      employeeCode: payslip.employee.employeeCode,
      payslipNumber: payslip.payslipNumber,
      month: payslip.month,
      year: payslip.year,
      basic: Number(data.basic),
      allowances: pdfAllowances,
      deductions: pdfDeductions,
      grossPay,
      netPay,
      attendanceDays: payslip.attendanceDays,
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
