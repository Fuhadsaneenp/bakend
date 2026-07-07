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
    const employees = await prisma.employee.findMany({
      where: { companyId, status: "ACTIVE", salary: { isNot: null } },
      include: { salary: true, user: true, attendance: { where: { workDate: { gte: startOfDay(new Date(year, month - 1, 1)), lte: endOfDay(new Date(year, month, 0)) } } } }
    });

    let grossTotal = 0;
    let netTotal = 0;

    return prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.create({
        data: { companyId, month, year, processedBy, grossTotal: 0, netTotal: 0 }
      });

      for (const employee of employees) {
        const salary = employee.salary!;
        const attendanceDays = new Date(year, month, 0).getDate();
        const payableDays = Math.max(1, employee.attendance.filter((a) => a.checkInAt).length || attendanceDays);
        const proration = payableDays / attendanceDays;
        const basic = decimalToNumber(salary.basic) * proration;
        const allowances = decimalToNumber(salary.allowances) * proration;
        const deductions = decimalToNumber(salary.deductions);
        const grossPay = basic + allowances;
        const netPay = grossPay - deductions;
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
          data: { payrollRunId: run.id, employeeId: employee.id, payslipNumber, month, year, basic, allowances, deductions, attendanceDays, payableDays, grossPay, netPay, pdfKey }
        });
      }

      return tx.payrollRun.update({ where: { id: run.id }, data: { grossTotal, netTotal }, include: { payslips: true } });
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
