// The upload ledger is durable even when concurrent sheet saves lose a snapshot.
// Rebuild the automatic rows on read so every acknowledged upload stays visible.
export function buildWordPressActivitySheets(values: unknown[]) {
  const sheets: Record<string, Record<string, unknown>[]> = {};
  const brands: Record<string, string> = {
    trikonet: "Trikonet", medbiomate: "Medbiomate", mediyox: "Mediyox",
  };
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const upload = value as Record<string, any>;
    const brand = brands[upload.site];
    if (!brand || !["job", "company"].includes(upload.type) || !upload.employeeId ||
        typeof upload.url !== "string" || !/^https?:\/\//i.test(upload.url)) continue;
    const activityTimestamp = upload.activityType === "edited"
      ? upload.editedAt || upload.uploadedAt
      : upload.createdAt || upload.uploadedAt;
    if (!Number.isFinite(Date.parse(activityTimestamp))) continue;
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(activityTimestamp));
    const sheet = upload.type === "job" ? "Jobs" : "Employer";
    const key = `${brand}-${sheet}-${day}`;
    const companyName = String(upload.companyName || "").trim();
    const row = {
      count: 1, companyName: companyName.toLowerCase() === "nmc" ? "NMC Healthcare" : companyName,
      jobCount: 1, category: upload.categories?.[0] || "", sourceUrl: upload.url,
      status: upload.status === "publish" ? "Uploaded" : "Not Uploaded",
      jobTitle: upload.title, notes: upload.title, postId: upload.postId,
      createdAt: upload.createdAt || upload.uploadedAt, uploadedAt: upload.uploadedAt,
      uploadedBy: upload.employeeName, activityType: upload.activityType || "created",
      editedBy: upload.editedBy, editedAt: upload.editedAt, updatedAt: upload.updatedAt, date: day,
    };
    for (const target of [key, `${key}-${upload.employeeId}`]) {
      (sheets[target] ||= []).push(row);
    }
  }
  return sheets;
}
