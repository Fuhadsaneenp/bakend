import PDFDocument from "pdfkit";

export type EmployeeLetterPdfInput = {
  companyName: string;
  employeeName: string;
  employeeCode: string;
  title: string;
  body: string;
  issuedAt: Date;
};

export const renderEmployeeLetterPdf = (input: EmployeeLetterPdfInput) => {
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  doc.fontSize(20).text(input.companyName, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor("#64748b").text(`Employee: ${input.employeeName} (${input.employeeCode})`, { align: "center" });
  doc.text(`Issued: ${input.issuedAt.toLocaleDateString("en-IN")}`, { align: "center" });
  doc.moveDown(2);

  doc.fillColor("#111827").fontSize(16).text(input.title, { align: "center", underline: true });
  doc.moveDown();

  input.body.split("\n").forEach((line) => {
    doc.fontSize(11).text(line, { align: "left", lineGap: 4 });
  });

  doc.moveDown(3);
  doc.fontSize(11).text("Authorized Signatory");
  doc.text(input.companyName);
  doc.end();

  return new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
};
