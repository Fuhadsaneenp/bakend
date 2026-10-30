import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ApiError } from "../../lib/errors.js";
export const sites = ["trikonet.com", "medbiomate.com"] as const;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function key() {
  const value = process.env.ADSENSE_TOKEN_KEY || process.env.SEO_TOKEN_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new ApiError(503, "AdSense token encryption is not configured");
  return Buffer.from(value, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString("base64url")).join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map(part => Buffer.from(part, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export function day(timeZone: string, now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now); }
export function offset(date: string, days: number) { return new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10); }
export function range(start: string, end: string) {
  if (![start, end].every(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value) || start > end || Date.parse(end) - Date.parse(start) > 365 * 86400000) throw new ApiError(400, "Choose a valid date range of up to 366 days");
  return { start, end };
}
export function reportQuery(siteId: string, start: string, end: string) {
  range(start, end);
  const params = new URLSearchParams({ dimensions: "DATE", metrics: "PAGE_VIEWS", filters: `OWNED_SITE_ID==${siteId}`, dateRange: "CUSTOM", reportingTimeZone: "ACCOUNT_TIME_ZONE", orderBy: "+DATE", languageCode: "en", limit: "1000" });
  for (const [prefix, date] of [["startDate", start], ["endDate", end]]) {
    const [year, month, day] = date.split("-");
    params.set(`${prefix}.year`, String(Number(year))); params.set(`${prefix}.month`, String(Number(month))); params.set(`${prefix}.day`, String(Number(day)));
  }
  return params;
}
export function parseReport(result: any, start: string, end: string) {
  if (result.warnings?.length) throw new ApiError(502, "AdSense returned a reporting warning; the previous successful data has been retained");
  if (!Array.isArray(result.headers) || result.headers.length !== 2 || result.headers[0]?.name !== "DATE" || result.headers[1]?.name !== "PAGE_VIEWS") throw new ApiError(502, "Unexpected AdSense page-view report format");
  const rows = result.rows || [];
  if (!Array.isArray(rows) || Number(result.totalMatchedRows || 0) > rows.length) throw new ApiError(502, "AdSense report was truncated");
  const values = new Map<string, number>();
  for (const row of rows) {
    const date = row.cells?.[0]?.value, raw = row.cells?.[1]?.value;
    if (!date || date < start || date > end || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) throw new ApiError(502, "Invalid AdSense page-view data");
    values.set(date, Number(raw));
  }
  return Array.from({ length: Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1 }, (_, i) => ({ date: offset(start, i), pageViews: values.get(offset(start, i)) || 0 }));
}
