import { Prisma } from "@prisma/client";
import { endOfDay, startOfDay } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { storageService } from "../../storage/storage.service.js";
import { notificationService } from "../notifications/notification.service.js";
import { renderPayslipPdf } from "./payslip.pdf.js";

const decimalToNumber = (value: Prisma.Decimal | number) => Number(value);

export const payrollService = {
  async generate(companyId: string, processedBy: string, month: number, year: number) {
    const existing = await prisma.payrollRun.findUnique({ where: { companyId_month_year: { companyId, month, year } } });
    if (existing) throw new ApiError(409, "Payroll already generated for this period");

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const endOfMonthDate = new Date(year, month, 0);
    const startOfMonthDate = new Date(year, month - 1, 1);

    const employees = await prisma.employee.findMany({
      where: {
        companyId,
        status: "ACTIVE",
        salary: { isNot: null },
        dateOfJoining: { lte: endOfDay(endOfMonthDate) }
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
        }
      }
    });

    let grossTotal = 0;
    let netTotal = 0;

    return prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: { companyId, month, year, processedBy, grossTotal: 0, netTotal: 0, status: "DRAFT" }
      });

      for (const employee of employees) {
        const salary = employee.salary!;
        const totalDaysInMonth = endOfMonthDate.getDate();
        
        let attendanceDays = totalDaysInMonth;
        
        // Middle-of-month joining check
        if (employee.dateOfJoining > startOfMonthDate) {
          attendanceDays = totalDaysInMonth - employee.dateOfJoining.getDate() + 1;
        }

        const checkInCount = employee.attendance.filter((a) => a.checkInAt).length;
        const payableDays = checkInCount > 0 ? Math.min(attendanceDays, checkInCount) : attendanceDays;
        
        const proration = payableDays / totalDaysInMonth;
        const basic = decimalToNumber(salary.basic) * proration;
        const allowances = decimalToNumber(salary.allowances) * proration;
        const deductions = decimalToNumber(salary.deductions);
        
        const grossPay = basic + allowances;
        const netPay = Math.max(0, grossPay - deductions);
        
        grossTotal += grossPay;
        netTotal += netPay;

        const payslipNumber = `PS-${year}${String(month).padStart(2, "0")}-${employee.employeeCode}`;
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
        const pdfKey = `companies/${companyId}/payslips/${year}-${month}/${employee.id}.pdf`;
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
  },

  async updatePayslip(
    companyId: string,
    payslipId: string,
    data: { payableDays: number; basic: number; allowances: number; deductions: number }
  ) {
    const payslip = await prisma.payslip.findFirst({
      where: { id: payslipId, payrollRun: { companyId } },
      include: { employee: { include: { company: true } }, payrollRun: true }
    });
    if (!payslip) throw new ApiError(404, "Payslip not found");
    if (payslip.payrollRun.status !== "DRAFT") {
      throw new ApiError(400, "Can only modify payslips in a DRAFT payroll run");
    }

    const grossPay = Number(data.basic) + Number(data.allowances);
    const netPay = Math.max(0, grossPay - Number(data.deductions));

    const pdf = await renderPayslipPdf({
      companyName: payslip.employee.company.name,
      employeeName: `${payslip.employee.firstName} ${payslip.employee.lastName}`,
      employeeCode: payslip.employee.employeeCode,
      payslipNumber: payslip.payslipNumber,
      month: payslip.month,
      year: payslip.year,
      basic: Number(data.basic),
      allowances: Number(data.allowances),
      deductions: Number(data.deductions),
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
};
