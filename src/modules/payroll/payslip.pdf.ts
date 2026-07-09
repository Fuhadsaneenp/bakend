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

const formatMoney = (value: number) => `INR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function drawBrand(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc.save();
  doc.circle(x + 18, y + 18, 18).fill("#08e000");
  doc.circle(x + 18, y + 18, 10).fill("#ffffff");
  doc.fillColor("#07111f").fontSize(20).font("Helvetica-Bold").text("second", x + 48, y + 1, { continued: false });
  doc.text("tales", x + 48, y + 22);
  doc.restore();
}

function row(doc: PDFKit.PDFDocument, label: string, value: string, y: number, options: { bold?: boolean; color?: string } = {}) {
  doc.font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.bold ? 11 : 10).fillColor(options.color ?? "#1f2937");
  doc.text(label, 64, y);
  doc.text(value, 372, y, { width: 150, align: "right" });
}

export const renderPayslipPdf = (input: PayslipPdfInput) => {
  const doc = new PDFDocument({ size: "A4", margin: 44 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  doc.rect(0, 0, 612, 112).fill("#07111f");
  drawBrand(doc, 44, 28);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text("Payslip", 390, 34, { width: 158, align: "right" });
  doc.font("Helvetica").fontSize(11).fillColor("#cbd5e1").text(`${monthNames[input.month]} ${input.year}`, 390, 63, { width: 158, align: "right" });

  doc.roundedRect(44, 136, 504, 96, 8).fill("#f8fafc").stroke("#e2e8f0");
  doc.fillColor("#64748b").fontSize(9).font("Helvetica-Bold").text("EMPLOYEE", 64, 158);
  doc.fillColor("#0f172a").fontSize(15).text(input.employeeName, 64, 176);
  doc.fillColor("#64748b").fontSize(10).font("Helvetica").text(`Emp. ID: ${input.employeeCode}`, 64, 198);

  doc.fillColor("#64748b").fontSize(9).font("Helvetica-Bold").text("PAYSLIP NO.", 330, 158);
  doc.fillColor("#0f172a").fontSize(11).font("Helvetica").text(input.payslipNumber, 330, 176);
  doc.fillColor("#64748b").fontSize(9).font("Helvetica-Bold").text("PAYABLE DAYS", 440, 158);
  doc.fillColor("#0f172a").fontSize(16).text(String(input.payableDays), 440, 176);
  doc.fillColor("#64748b").fontSize(10).text(`Base days: ${input.attendanceDays}`, 440, 198);

  doc.roundedRect(44, 252, 504, 72, 8).fill("#ecfdf5").stroke("#bbf7d0");
  doc.fillColor("#047857").font("Helvetica-Bold").fontSize(10).text("NET PAY", 64, 274);
  doc.fillColor("#064e3b").fontSize(24).text(formatMoney(input.netPay), 64, 291);
  doc.fillColor("#047857").fontSize(10).text(input.companyName, 370, 286, { width: 150, align: "right" });

  doc.fillColor("#047857").font("Helvetica-Bold").fontSize(11).text("(+) Earnings", 64, 358);
  doc.fillColor("#64748b").text("Amount", 372, 358, { width: 150, align: "right" });
  doc.moveTo(64, 378).lineTo(524, 378).strokeColor("#e2e8f0").stroke();
  row(doc, "Basic", formatMoney(input.basic), 398);
  row(doc, "Fixed Allowance", formatMoney(input.allowances), 424);
  row(doc, "Gross Pay", formatMoney(input.grossPay), 456, { bold: true });

  doc.fillColor("#e11d48").font("Helvetica-Bold").fontSize(11).text("(-) Deductions", 64, 502);
  doc.fillColor("#64748b").text("Amount", 372, 502, { width: 150, align: "right" });
  doc.moveTo(64, 522).lineTo(524, 522).strokeColor("#e2e8f0").stroke();
  row(doc, "Income Tax", formatMoney(0), 542);
  row(doc, "Other Deductions", formatMoney(input.deductions), 568);

  doc.roundedRect(44, 628, 504, 58, 8).fill("#f1f5f9").stroke("#e2e8f0");
  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13).text("Net Pay", 64, 650);
  doc.fontSize(16).text(formatMoney(input.netPay), 340, 646, { width: 184, align: "right" });

  doc.fillColor("#64748b").font("Helvetica").fontSize(9).text("This is a system generated payslip from Second Tales EMS.", 44, 724, { align: "center", width: 504 });
  doc.end();

  return new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
};
