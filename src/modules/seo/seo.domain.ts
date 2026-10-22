import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { ApiError } from "../../lib/errors.js";
export const categories = [
  "Keyword research",
  "Competitor analysis",
  "Meta title optimization",
  "Meta description optimization",
  "Meta title and description optimization",
  "Content optimization",
  "Internal linking",
  "Backlink outreach",
  "Backlink acquisition",
  "Technical SEO fixes",
  "Broken link fixing",
  "Image SEO",
  "Schema markup implementation",
  "Sitemap optimization",
  "Content publishing",
  "Google Search Console analysis",
  "Website SEO auditing",
  "Other SEO activities",
] as const;
export const defaults: Record<string, [number, number]> = {
  "Keyword research": [10, 1],
  "Meta title and description optimization": [1, 1],
  "Content optimization": [1, 3],
  "Internal linking": [10, 1],
  "Backlink outreach": [10, 1],
  "Backlink acquisition": [1, 2],
  "Technical SEO fixes": [1, 3],
};
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function key() {
  const value = process.env.SEO_TOKEN_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new ApiError(503, "SEO_TOKEN_KEY must contain a 32-byte hex key");
  return Buffer.from(value, "hex");
}
export function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((x) => x.toString("base64url"))
    .join(".");
}
export function unseal(value: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
export function aggregate(
  rows: { clicks: number; impressions: number; position: number }[],
) {
  const clicks = rows.reduce((s, r) => s + r.clicks, 0),
    impressions = rows.reduce((s, r) => s + r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    position: impressions
      ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions
      : null,
  };
}
export function transition(current: string, next: string, manager: boolean) {
  const allowed: Record<string, string[]> = {
    ASSIGNED: ["IN_PROGRESS"],
    IN_PROGRESS: ["SUBMITTED"],
    REJECTED: ["IN_PROGRESS"],
    CORRECTIONS: ["IN_PROGRESS"],
    SUBMITTED: manager ? ["APPROVED", "REJECTED", "CORRECTIONS"] : [],
  };
  if (!allowed[current]?.includes(next))
    throw new ApiError(409, "Invalid task transition");
}
export const day = (date: Date) => date.toISOString().slice(0, 10);
export const dateValue = (date: string) => new Date(`${date}T00:00:00.000Z`);
export function period(start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end))
    throw new ApiError(400, "Invalid date");
  const a = dateValue(start),
    b = dateValue(end);
  if (
    !Number.isFinite(+a) ||
    !Number.isFinite(+b) ||
    day(a) !== start ||
    day(b) !== end ||
    +b < +a ||
    +b - +a > 366 * 86400000
  )
    throw new ApiError(400, "Date range must be valid and at most 367 days");
  return { gte: a, lte: b };
}
export function keywordIdentity(
  keyword: string,
  targetUrl: string,
  country: string,
  device: string,
) {
  return hash(
    JSON.stringify([
      keyword.trim().toLowerCase(),
      targetUrl,
      country.toLowerCase(),
      device.toUpperCase(),
    ]),
  );
}
