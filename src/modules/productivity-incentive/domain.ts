import { z } from "zod";

export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, "Invalid date");
const bandSchema = z.object({ start: z.number().int().min(1050).max(1439), end: z.number().int().min(1051).max(1440), percent: z.number().min(0).max(100) });
export const policySchema = z.object({
  jobMinutes: z.number().positive().max(120).default(2),
  employerMinutes: z.number().positive().max(240).default(7),
  monthlyHoursDivisor: z.number().positive().max(744).nullable().default(null),
  salaryBasis: z.enum(["BASIC", "BASIC_AND_ALLOWANCES"]).default("BASIC"),
  bands: z.array(bandSchema).min(1).max(12).default([{ start: 1050, end: 1080, percent: 10 }, { start: 1080, end: 1110, percent: 15 }, { start: 1110, end: 1170, percent: 20 }, { start: 1170, end: 1440, percent: 25 }]),
  eligibleEmployeeIds: z.array(z.string().min(1)).max(1000).default([]),
  eligibleDepartmentIds: z.array(z.string().min(1)).max(1000).default([]),
  allEmployees: z.boolean().default(false),
  approvalRequired: z.boolean().default(true),
  monthlyBudgetCents: z.number().int().nonnegative().max(100000000).nullable().default(null)
}).superRefine((v, ctx) => {
  if (v.bands[0].start !== 1050 || v.bands.at(-1)?.end !== 1440 || v.bands.some((b, i) => b.end <= b.start || (i > 0 && b.start !== v.bands[i - 1].end))) ctx.addIssue({ code: "custom", message: "Bands must cover 17:30–24:00 in order, without gaps or overlaps", path: ["bands"] });
});
export type Policy = z.infer<typeof policySchema>;
export const defaultPolicy = policySchema.parse({});
export const localDay = (date: Date | string) => new Date(new Date(date).getTime() + 19800000).toISOString().slice(0, 10);
export const localMinute = (date: Date | string) => { const d = new Date(new Date(date).getTime() + 19800000); return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000; };
export const atMinute = (day: string, minute: number) => Date.parse(`${day}T00:00:00+05:30`) + minute * 60000;
export const money = (value: number) => Math.round((value + Number.EPSILON) * 100);

export type Verification = { start: string; end: string; evidence: string; verifiedBy: string; verifiedAt: string };
export function calculate(policy: Policy, kind: string, day: string, occurredAt: Date, hourlyRate: number | null, verified: Verification | null, attendance: { checkInAt: Date | null; checkOutAt: Date | null } | null) {
  const standardMinutes = kind === "job" ? policy.jobMinutes : policy.employerMinutes;
  const base = { standardMinutes, creditedMinutes: 0, estimatedCents: 0, hourlyRate, weightedPercent: null as number | null, allocations: [] as { minutes: number; percent: number }[], issue: "" };
  if (!verified) return { ...base, issue: "VERIFIED_INTERVAL_REQUIRED" };
  const start = Date.parse(verified.start), end = Date.parse(verified.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || localDay(new Date(start)) !== day || localDay(new Date(end - 1)) !== day || end > occurredAt.getTime()) return { ...base, issue: "INVALID_WORK_INTERVAL" };
  if (!attendance?.checkInAt || !attendance.checkOutAt) return { ...base, issue: "COMPLETE_ATTENDANCE_REQUIRED" };
  if (start < attendance.checkInAt.getTime() || end > attendance.checkOutAt.getTime()) return { ...base, issue: "INTERVAL_OUTSIDE_ATTENDANCE" };
  const allocations = policy.bands.map(band => ({ minutes: standardMinutes * Math.max(0, Math.min(end, atMinute(day, band.end)) - Math.max(start, atMinute(day, band.start))) / (end - start), percent: band.percent })).filter(a => a.minutes > 0);
  const creditedMinutes = allocations.reduce((sum, a) => sum + a.minutes, 0);
  const weightedPercent = creditedMinutes ? allocations.reduce((sum, a) => sum + a.minutes * a.percent, 0) / creditedMinutes : 0;
  const estimatedCents = hourlyRate === null ? 0 : money(allocations.reduce((sum, a) => sum + a.minutes / 60 * hourlyRate * a.percent / 100, 0));
  if (!Number.isSafeInteger(estimatedCents) || estimatedCents < 0 || estimatedCents > 2147483647) return { ...base, allocations, creditedMinutes, weightedPercent, issue: "AMOUNT_OUT_OF_RANGE" };
  return { ...base, allocations, creditedMinutes, weightedPercent, estimatedCents, issue: hourlyRate === null ? "HOURLY_RATE_NOT_CONFIGURED" : "" };
}

export function sourceIdentity(value: any): string | null {
  const sites: Record<string, string> = { medbiomate: "medbiomate.com", trikonet: "trikonet.com", mediyox: "mediyox.com" };
  if (!sites[value?.site] || !["job", "company"].includes(value.type) || !value.postId) return null;
  try { const url = new URL(value.url); if (url.hostname.toLowerCase().replace(/^www\./, "") !== sites[value.site] || !["http:", "https:"].includes(url.protocol)) return null; } catch { return null; }
  return `${value.site}:${value.type}:${value.postId}`;
}
export function canonicalUrl(url: string) { const parsed = new URL(url); const post = parsed.searchParams.get("p"); return parsed.hostname.toLowerCase().replace(/^www\./, "") + parsed.pathname.replace(/\/+$/, "").toLowerCase() + (post ? `?p=${post}` : ""); }
export function actualExtraMinutes(day: string, attendance: { checkInAt: Date | null; checkOutAt: Date | null } | undefined) {
  if (!attendance?.checkInAt || !attendance.checkOutAt) return null;
  return Math.max(0, Math.min(attendance.checkOutAt.getTime(), atMinute(day, 1440)) - Math.max(attendance.checkInAt.getTime(), atMinute(day, 1050))) / 60000;
}
