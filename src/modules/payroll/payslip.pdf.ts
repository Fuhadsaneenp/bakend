import PDFDocument from "pdfkit";

export type PayslipPdfInput = {
  companyName: string;
  employeeName: string;
  employeeCode: string;
  payslipNumber: string;
  month: number;
  year: number;
  basic: number;
  allowances: number;
  deductions: number;
  grossPay: number;
  netPay: number;
  attendanceDays: number;
  payableDays: number;
};

export const renderPayslipPdf = (input: PayslipPdfInput) => {
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  doc.fontSize(20).text(input.companyName, { align: "center" });
  doc.fontSize(14).text(`Payslip ${input.month}/${input.year}`, { align: "center" });
  doc.moveDown();
  doc.fontSize(10).text(`Payslip ID: ${input.payslipNumber}`);
  doc.text(`Employee: ${input.employeeName} (${input.employeeCode})`);
  doc.text(`Attendance: ${input.payableDays}/${input.attendanceDays} payable days`);
  doc.moveDown();

  doc.fontSize(12).text("Earnings", { underline: true });
  doc.text(`Basic: ${input.basic.toFixed(2)}`);
  doc.text(`Allowances: ${input.allowances.toFixed(2)}`);
  doc.text(`Gross Pay: ${input.grossPay.toFixed(2)}`);
  doc.moveDown();
  doc.fontSize(12).text("Deductions", { underline: true });
  doc.text(`Deductions: ${input.deductions.toFixed(2)}`);
  doc.moveDown();
  doc.fontSize(16).text(`Net Salary: ${input.netPay.toFixed(2)}`, { align: "right" });
  doc.end();

  return new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
};
