import PDFDocument from "pdfkit";
export function renderSeoReport(
  clientName: string,
  report: { month: string; snapshot: any; summary: string | null },
) {
  const doc = new PDFDocument({ margin: 45, size: "A4" }),
    s = report.snapshot;
  doc
    .fillColor("#0f172a")
    .fontSize(22)
    .text(clientName)
    .fontSize(15)
    .fillColor("#0f766e")
    .text(`Monthly SEO report | ${report.month}`)
    .moveDown();
  const section = (title: string) => {
    doc
      .moveDown()
      .fillColor("#0f766e")
      .fontSize(14)
      .text(title)
      .moveDown(0.3)
      .fillColor("#0f172a")
      .fontSize(10);
  };
  const number = (value: any, digits = 0) =>
    value == null
      ? "Unavailable"
      : Number(value).toLocaleString("en-US", {
          maximumFractionDigits: digits,
        });
  section("Google search performance");
  doc.text(
    s.hasData
      ? "Source: stored Google Search Console search analytics."
      : "No Search Console data was stored for this month.",
  );
  for (const key of ["clicks", "impressions", "ctr", "position"]) {
    const label: Record<string, string> = {
      clicks: "Organic clicks",
      impressions: "Search impressions",
      ctr: "Average CTR",
      position: "Average position",
    };
    const current = s.totals?.[key],
      previous = s.previous?.[key];
    const value =
      key === "ctr" && current != null
        ? `${number(current * 100, 2)}%`
        : number(current, 2);
    const prior =
      key === "ctr" && previous != null
        ? `${number(previous * 100, 2)}%`
        : number(previous, 2);
    doc.text(`${label[key]}: ${value} | Previous month: ${prior}`);
  }
  section("Verified SEO work");
  for (const [label, value] of Object.entries(s.work || {}))
    doc.text(`${label.replace(/([A-Z])/g, " $1")}: ${value}`);
  section("Completed activities");
  const approved = (s.tasks || []).filter(
    (t: any) =>
      t.status === "APPROVED" &&
      t.reviews?.some(
        (r: any) =>
          r.status === "APPROVED" && r.createdAt.slice(0, 7) === report.month,
      ),
  );
  if (!approved.length)
    doc.text("No approved tasks recorded in the reporting period.");
  for (const t of approved)
    doc.text(
      `${t.category}: ${t.completedQuantity} units | Employee ${t.employeeId} | Quality ${t.quality ?? "Unrated"}/5`,
    );
  for (const [title, rows] of [
    ["Top queries", s.queries],
    ["Top landing pages", s.pages],
  ] as const) {
    section(title);
    if (!rows?.length) doc.text("No available data.");
    for (const row of (rows || []).slice(0, 15))
      doc.text(
        `${row.label}\n${number(row.clicks)} clicks | ${number(row.impressions)} impressions | CTR ${number(row.ctr * 100, 2)}% | Average position ${number(row.position, 2)}`,
        { paragraphGap: 6 },
      );
  }
  section("Keyword performance changes");
  if (!s.keywordChanges?.length)
    doc.text("No comparable stored query averages for both months.");
  for (const row of (s.keywordChanges || []).slice(0, 20))
    doc.text(
      `${row.keyword}: ${number(row.previous, 2)} to ${number(row.current, 2)} average position (${row.change > 0 ? "improved" : row.change < 0 ? "declined" : "unchanged"}).`,
    );
  section("Pending improvements");
  const pending = (s.activities || []).filter(
    (a: any) => a.verification !== "APPROVED",
  );
  if (!pending.length) doc.text("No pending activities recorded.");
  for (const a of pending.slice(0, 30))
    doc.text(`${a.kind} | ${a.status} | ${a.url}`);
  section("AI performance summary and next-month recommendations");
  doc.text(report.summary || "AI analysis is unavailable.");
  section("Data coverage");
  doc
    .fontSize(9)
    .fillColor("#64748b")
    .text(
      s.limitations ||
        "Search Console may omit privacy-filtered queries. Average positions are not exact rankings.",
    );
  doc.end();
  return doc;
}
