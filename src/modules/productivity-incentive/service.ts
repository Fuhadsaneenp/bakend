import { createHash } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { employedDuring } from "../../lib/employment.js";
import type { AuthUser } from "../../middleware/auth.js";
import { allowedCompanyIds } from "../org/company-access.service.js";
import { actualExtraMinutes, calculate, canonicalUrl, defaultPolicy, localDay, localMinute, policySchema, sourceIdentity, type Policy, type Verification } from "./domain.js";

type Tx = Prisma.TransactionClient;
const json = (value: any): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const hash = (value: any) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lockKey = "productivity_incentive_lock_v1";
export const isIncentiveAdmin = (user: AuthUser) => [Role.SUPER_ADMIN, Role.HR_ADMIN].includes(user.role as any);

export async function context(user: AuthUser) {
  const ids = await allowedCompanyIds(user);
  const companies = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const company = companies.find(c => c.name.trim().toLowerCase() === "medbiomate");
  if (!company) throw new ApiError(403, "Medbiomate company access is required");
  const employee = await prisma.employee.findUnique({ where: { userId: user.id }, select: { id: true, companyId: true } });
  if (!isIncentiveAdmin(user) && employee?.companyId !== company.id) throw new ApiError(403, "Medbiomate employee access is required");
  return { company, employee, admin: isIncentiveAdmin(user) };
}

async function locked<T>(companyId: string, action: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.companySetting.upsert({ where: { companyId_key: { companyId, key: lockKey } }, create: { companyId, key: lockKey, value: {} }, update: { value: {} } });
    await tx.$queryRaw`SELECT id FROM CompanySetting WHERE companyId = ${companyId} AND \`key\` = ${lockKey} FOR UPDATE`;
    return action(tx);
  }, { timeout: 60000, maxWait: 15000 });
}
async function audit(tx: Tx, companyId: string, actorId: string, action: string, detail: any, creditId?: string) {
  await tx.incentiveAudit.create({ data: { companyId, actorId, action, creditId, detail: json(detail) } });
}

function rateFor(employee: any, policy: Policy, day: string) {
  const cutoff = Date.parse(`${day}T23:59:59+05:30`);
  const salary = [...(employee.salaryHistory || []), ...(employee.salary ? [employee.salary] : [])]
    .filter(s => new Date(s.effectiveFrom).getTime() <= cutoff).sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime())[0];
  if (!salary || !policy.monthlyHoursDivisor) return null;
  const amount = Number(salary.basic) + (policy.salaryBasis === "BASIC_AND_ALLOWANCES" ? Number(salary.allowances) : 0);
  return Number.isFinite(amount) && amount >= 0 ? amount / policy.monthlyHoursDivisor : null;
}
const activePolicy = (policies: any[], day: string) => policies.find(p => p.effectiveFrom <= day);
const eligible = (employee: any, p: Policy, day: string) => employedDuring(employee, day, day) && (p.allEmployees || p.eligibleEmployeeIds.includes(employee.id) || (!!employee.departmentId && p.eligibleDepartmentIds.includes(employee.departmentId)));

/** Reconciles the server-owned source ledger, including later invalidations. Never trusts sheet counts. */
export async function reconcile(companyId: string, month: string, actorId: string, recalculate = false) {
  return locked(companyId, async tx => {
    const [policies, saved, sources, employees, attendance] = await Promise.all([
      tx.incentivePolicy.findMany({ where: { companyId }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }] }),
      tx.incentiveCredit.findMany({ where: { companyId } }),
      tx.companySetting.findMany({ where: { companyId, key: { gte: "wordpress_upload_v1_", lt: "wordpress_upload_v2_" } }, select: { value: true } }),
      tx.employee.findMany({ where: { companyId }, include: { salary: true, salaryHistory: true } }),
      tx.attendance.findMany({ where: { employee: { companyId }, workDate: { gte: new Date(`${month}-01T00:00:00+05:30`), lt: new Date(Date.parse(`${month}-01T00:00:00+05:30`) + 32 * 86400000) } } })
    ]);
    const employeeMap = new Map(employees.map(e => [e.id, e]));
    const attendanceMap = new Map(attendance.map(a => [`${a.employeeId}:${localDay(a.workDate)}`, a]));
    const existing = new Map(saved.map(c => [c.sourceKey, c]));
    const inputs = new Map<string, any>();
    for (const row of sources) {
      const value: any = row.value; const key = sourceIdentity(value);
      if (!key) continue;
      const previous = inputs.get(key);
      if (!previous || Date.parse(value.updatedAt) > Date.parse(previous.updatedAt)) inputs.set(key, value);
    }
    const all = [...inputs.entries()].sort((a, b) => (Date.parse(a[1].createdAt) || Infinity) - (Date.parse(b[1].createdAt) || Infinity) || a[0].localeCompare(b[0]));
    const seenUrls = new Map<string, string>(), seenContent = new Map<string, string>();
    const seen = new Set<string>();
    let changed = 0, missingCreationTimestamps = 0;
    for (const [key, value] of all) {
      const old = existing.get(key);
      // Creation time is never inferred from edit, sync receipt or publication timestamps.
      const date = old?.occurredAt || new Date(value.createdAt);
      if (!Number.isFinite(date.getTime())) { missingCreationTimestamps++; continue; }
      if (date.getTime() > Date.now()) continue;
      const day = old?.day || localDay(date);
      const contentKey = hash([value.site, value.type, String(value.title).trim().toLowerCase(), String(value.companyName).trim().toLowerCase(), String(value.location).trim().toLowerCase()]);
      const urlKey = value.type + ":" + canonicalUrl(value.url);
      const duplicateOf = seenUrls.get(urlKey) || seenContent.get(contentKey);
      // Exclude URL and content aliases across the complete ledger, not just the selected month.
      seenUrls.set(urlKey, duplicateOf || key); seenContent.set(contentKey, duplicateOf || key);
      if (day.slice(0, 7) !== month || localMinute(date) < 1050) continue;
      seen.add(key);
      const employee = employeeMap.get(old?.employeeId || value.employeeId);
      if (!old && !employee) continue;
      const policy = old && !recalculate ? policies.find(p => p.id === old.policyId) : activePolicy(policies, day);
      const config = policy ? policySchema.parse(policy.config) : null;
      const verification = old?.verification as Verification | null;
      const snapshot: any = old?.snapshot;
      const identityChanged = !!old && (value.employeeId !== old.employeeId || (value.createdAt && Date.parse(value.createdAt) !== old.occurredAt.getTime()));
      const eligibility = old && !recalculate && typeof snapshot?.eligible === "boolean" ? snapshot.eligible : employee && config ? eligible(employee, config, day) : false;
      let issue = !employee ? "EMPLOYEE_NOT_FOUND" : employee.companyId !== companyId ? "WRONG_COMPANY" : identityChanged ? "SOURCE_IDENTITY_CHANGED" : duplicateOf && duplicateOf !== key ? "DUPLICATE_SOURCE" : !["publish", "published"].includes(String(value.status).toLowerCase()) || !String(value.title || "").trim() || value.isValid === false || value.duplicateOf ? "INVALID_SOURCE" : !policy ? "NO_EFFECTIVE_POLICY" : !eligibility ? "NOT_ELIGIBLE" : "";
      // Rates and policies are frozen at the first calculation; explicit recalculation is audited.
      const hourlyRate = old && !recalculate && snapshot?.hourlyRate !== undefined ? snapshot.hourlyRate : employee && config ? rateFor(employee, config, day) : null;
      const result = config ? calculate(config, value.type, day, date, hourlyRate, verification, attendanceMap.get(`${employee?.id}:${day}`) || null) : { standardMinutes: 0, creditedMinutes: 0, estimatedCents: 0, weightedPercent: null, allocations: [], issue: "NO_EFFECTIVE_POLICY" };
      issue ||= result.issue;
      const invalid = ["EMPLOYEE_NOT_FOUND", "WRONG_COMPANY", "SOURCE_IDENTITY_CHANGED", "DUPLICATE_SOURCE", "INVALID_SOURCE", "NOT_ELIGIBLE"].includes(issue);
      const calculation = { ...result, issue, duplicateOf: duplicateOf !== key ? duplicateOf : undefined };
      if (invalid) { calculation.creditedMinutes = 0; calculation.estimatedCents = 0; }
      const nextSnapshot = { title: value.title, sourceStatus: value.status, employeeId: old?.employeeId || value.employeeId, occurredAt: date.toISOString(), hourlyRate, eligible: eligibility, policy: config, source: key };
      const fingerprint = hash({ nextSnapshot, calculation });
      if (snapshot?.fingerprint === fingerprint) continue;
      const retainApproval = old?.status === "APPROVED" && !issue && old.policyId === policy?.id && old.estimatedCents === calculation.estimatedCents && old.creditedMinutes === calculation.creditedMinutes;
      const status = invalid ? "INVALIDATED" : old?.status === "REJECTED" ? "REJECTED" : retainApproval ? "APPROVED" : "PENDING";
      const data = { companyId, employeeId: old?.employeeId || value.employeeId || "unmapped", sourceKey: key, sourceUrl: value.url, kind: value.type, occurredAt: date, day, month, policyId: policy?.id || null, snapshot: json({ ...nextSnapshot, fingerprint }), calculation: json(calculation), standardMinutes: invalid ? 0 : result.standardMinutes, creditedMinutes: status === "REJECTED" ? 0 : calculation.creditedMinutes, estimatedCents: status === "REJECTED" ? 0 : calculation.estimatedCents, approvedCents: retainApproval ? old!.approvedCents : 0, status };
      const credit = old ? await tx.incentiveCredit.update({ where: { id: old.id }, data: { ...data, revision: { increment: 1 } } }) : await tx.incentiveCredit.create({ data });
      await audit(tx, companyId, actorId, old ? recalculate ? "EXPLICIT_RECALCULATION" : "SOURCE_RECONCILED" : "SOURCE_CAPTURED", { before: old ? { snapshot: old.snapshot, calculation: old.calculation, approvedCents: old.approvedCents, status: old.status, revision: old.revision } : null, after: { snapshot: nextSnapshot, calculation, approvedCents: credit.approvedCents, status: credit.status, revision: credit.revision }, issue, fingerprint }, credit.id);
      if (config && !config.approvalRequired && !issue && status === "PENDING") {
        try { await approveLocked(tx, companyId, credit.id, credit.revision, actorId, "Automatic approval under effective policy"); }
        catch (error) { if (!(error instanceof ApiError) || error.statusCode !== 409) throw error; await audit(tx, companyId, actorId, "AUTOMATIC_APPROVAL_HELD", { reason: error.message }, credit.id); }
      }
      changed++;
    }
    for (const old of saved) {
      if (old.month !== month) continue;
      if (seen.has(old.sourceKey) || old.status === "INVALIDATED") continue;
      await tx.incentiveCredit.update({ where: { id: old.id }, data: { status: "INVALIDATED", creditedMinutes: 0, estimatedCents: 0, approvedCents: 0, calculation: json({ issue: "SOURCE_REMOVED" }), revision: { increment: 1 } } });
      await audit(tx, companyId, actorId, "SOURCE_REMOVED", { snapshot: old.snapshot, calculation: old.calculation, previousApprovedCents: old.approvedCents, previousStatus: old.status }, old.id);
      changed++;
    }
    return { changed, missingCreationTimestamps };
  });
}

async function approveLocked(tx: Tx, companyId: string, id: string, revision: number, actorId: string, reason: string) {
  const row = await tx.incentiveCredit.findFirst({ where: { id, companyId } });
  if (!row) throw new ApiError(404, "Credit not found");
  if (row.revision !== revision) throw new ApiError(409, "Calculation changed. Refresh before approval.");
  if (row.status === "APPROVED") return row;
  if (row.status !== "PENDING" || (row.calculation as any).issue) throw new ApiError(409, "Only validated, fully calculated credits can be approved");
  const policies = await tx.incentivePolicy.findMany({ where: { companyId }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }] });
  // Monthly expenditure uses the latest effective budget for that month.
  const budget = activePolicy(policies, [localDay(new Date()), `${row.month}-31`].sort()[0])?.config as any;
  const approved = await tx.incentiveCredit.aggregate({ where: { companyId, month: row.month, id: { not: id } }, _sum: { approvedCents: true } });
  if (budget?.monthlyBudgetCents !== null && budget?.monthlyBudgetCents !== undefined && (approved._sum.approvedCents || 0) + row.estimatedCents > budget.monthlyBudgetCents) throw new ApiError(409, "Monthly bonus budget would be exceeded");
  const result = await tx.incentiveCredit.update({ where: { id }, data: { status: "APPROVED", approvedCents: row.estimatedCents, revision: { increment: 1 } } });
  await audit(tx, companyId, actorId, "APPROVED", { reason, approvedCents: result.approvedCents, revision: result.revision }, id);
  return result;
}

export async function review(companyId: string, id: string, revision: number, actorId: string, action: "APPROVE" | "REJECT" | "REOPEN", reason: string) {
  return locked(companyId, async tx => {
    if (action === "APPROVE") return approveLocked(tx, companyId, id, revision, actorId, reason);
    const row = await tx.incentiveCredit.findFirst({ where: { id, companyId } });
    if (!row) throw new ApiError(404, "Credit not found");
    if (row.revision !== revision) throw new ApiError(409, "Calculation changed. Refresh first.");
    if (action === "REOPEN") {
      if (row.status !== "REJECTED") throw new ApiError(409, "Only rejected credits can be reopened");
      const result = await tx.incentiveCredit.update({ where: { id }, data: { status: "PENDING", snapshot: json({ ...(row.snapshot as any), fingerprint: null }), revision: { increment: 1 } } });
      await audit(tx, companyId, actorId, "REOPENED", { reason, previousStatus: row.status }, id);
      return result;
    }
    const result = await tx.incentiveCredit.update({ where: { id }, data: { status: "REJECTED", creditedMinutes: 0, estimatedCents: 0, approvedCents: 0, revision: { increment: 1 } } });
    await audit(tx, companyId, actorId, "REJECTED", { reason, previousStatus: row.status, previousApprovedCents: row.approvedCents, calculation: row.calculation }, id);
    return result;
  });
}

export async function verify(companyId: string, id: string, revision: number, actorId: string, interval: { start: string; end: string; evidence: string }) {
  const month = await locked(companyId, async tx => {
    const row = await tx.incentiveCredit.findFirst({ where: { id, companyId } });
    if (!row) throw new ApiError(404, "Credit not found");
    if (row.revision !== revision) throw new ApiError(409, "Calculation changed. Refresh first.");
    if (["INVALIDATED", "REJECTED"].includes(row.status)) throw new ApiError(409, "Resolve source validity before verifying work");
    if (Date.parse(interval.end) <= Date.parse(interval.start) || Date.parse(interval.end) > row.occurredAt.getTime() || localDay(interval.start) !== row.day || localDay(new Date(Date.parse(interval.end) - 1)) !== row.day) throw new ApiError(422, "Work interval must be on the activity day and end by creation time");
    const attendance = await tx.attendance.findUnique({ where: { employeeId_workDate: { employeeId: row.employeeId, workDate: new Date(`${row.day}T00:00:00+05:30`) } } });
    if (!attendance?.checkInAt || !attendance.checkOutAt || Date.parse(interval.start) < attendance.checkInAt.getTime() || Date.parse(interval.end) > attendance.checkOutAt.getTime()) throw new ApiError(422, "Verified work must be inside complete attendance punches");
    const others = await tx.incentiveCredit.findMany({ where: { companyId, employeeId: row.employeeId, day: row.day, id: { not: id }, status: { notIn: ["INVALIDATED", "REJECTED"] } } });
    if (others.some(other => { const v = other.verification as Verification | null; return v && Date.parse(v.start) < Date.parse(interval.end) && Date.parse(v.end) > Date.parse(interval.start); })) throw new ApiError(409, "This work interval overlaps an already credited activity");
    const verification = { ...interval, verifiedBy: actorId, verifiedAt: new Date().toISOString() };
    // Clear the calculation fingerprint so verification forces a fresh calculation.
    await tx.incentiveCredit.update({ where: { id }, data: { verification: json(verification), snapshot: json({ ...(row.snapshot as any), fingerprint: null }), status: "PENDING", approvedCents: 0, revision: { increment: 1 } } });
    await audit(tx, companyId, actorId, "INTERVAL_VERIFIED", { verification, previousVerification: row.verification, previousApprovedCents: row.approvedCents }, id);
    return row.month;
  });
  await reconcile(companyId, month, actorId);
}

export async function savePolicy(companyId: string, actorId: string, effectiveFrom: string, config: Policy) {
  return locked(companyId, async tx => {
    const employees = await tx.employee.count({ where: { companyId, id: { in: config.eligibleEmployeeIds } } });
    const departments = await tx.department.count({ where: { companyId, id: { in: config.eligibleDepartmentIds } } });
    if (employees !== new Set(config.eligibleEmployeeIds).size || departments !== new Set(config.eligibleDepartmentIds).size) throw new ApiError(422, "Eligibility must refer to Medbiomate employees and departments");
    const policy = await tx.incentivePolicy.create({ data: { companyId, effectiveFrom, config: json(config), createdBy: actorId } });
    await audit(tx, companyId, actorId, "POLICY_CREATED", { policyId: policy.id, effectiveFrom, config });
    return policy;
  });
}

export async function report(user: AuthUser, month: string, day?: string, selectedEmployeeId?: string) {
  const ctx = await context(user);
  if (!ctx.admin && selectedEmployeeId && selectedEmployeeId !== ctx.employee?.id) throw new ApiError(403, "Employee reports are limited to your own activity");
  const employeeId = ctx.admin ? selectedEmployeeId : ctx.employee!.id;
  const [credits, employees, attendance, policies, audits, departments, monthlyTotals] = await Promise.all([
    prisma.incentiveCredit.findMany({ where: { companyId: ctx.company.id, month, ...(employeeId ? { employeeId } : {}) }, orderBy: { occurredAt: "desc" } }),
    prisma.employee.findMany({ where: { companyId: ctx.company.id, ...(employeeId ? { id: employeeId } : {}) }, select: { id: true, firstName: true, middleName: true, lastName: true, employeeCode: true, departmentId: true } }),
    prisma.attendance.findMany({ where: { employee: { companyId: ctx.company.id }, ...(employeeId ? { employeeId } : {}), workDate: { gte: new Date(`${month}-01T00:00:00+05:30`), lt: new Date(Date.parse(`${month}-01T00:00:00+05:30`) + 32 * 86400000) } } }),
    prisma.incentivePolicy.findMany({ where: { companyId: ctx.company.id }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }] }),
    ctx.admin ? prisma.incentiveAudit.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    ctx.admin ? prisma.department.findMany({ where: { companyId: ctx.company.id }, select: { id: true, name: true } }) : [],
    prisma.incentiveCredit.aggregate({ where: { companyId: ctx.company.id, month, ...(!ctx.admin ? { employeeId: ctx.employee!.id } : {}) }, _sum: { approvedCents: true } })
  ]);
  const rows = employees.map(employee => {
    const monthly = credits.filter(c => c.employeeId === employee.id);
    const filtered = day ? monthly.filter(c => c.day === day) : monthly;
    const valid = filtered.filter(c => !["INVALIDATED", "REJECTED"].includes(c.status));
    const sums = (key: "creditedMinutes" | "estimatedCents" | "approvedCents") => filtered.reduce((sum, c) => sum + c[key], 0);
    const punches = attendance.filter(a => a.employeeId === employee.id && localDay(a.workDate).startsWith(month) && (!day || localDay(a.workDate) === day));
    const actual = punches.map(a => actualExtraMinutes(localDay(a.workDate), a));
    const totalMinutes = sums("creditedMinutes");
    return { employee, jobs: valid.filter(c => c.kind === "job").length, employers: valid.filter(c => c.kind === "company").length, productivityMinutes: valid.reduce((sum, c) => sum + c.standardMinutes, 0), creditedMinutes: totalMinutes, actualExtraMinutes: actual.length && actual.every(a => a !== null) ? actual.reduce<number>((sum, a) => sum + (a || 0), 0) : null, incompleteAttendanceDays: actual.filter(a => a === null).length, estimatedPercent: totalMinutes ? filtered.reduce((sum, c) => sum + c.creditedMinutes * ((c.calculation as any).weightedPercent || 0), 0) / totalMinutes : null, estimatedCents: sums("estimatedCents"), approvedCents: sums("approvedCents"), monthlyBonusCents: monthly.reduce((sum, c) => sum + c.approvedCents, 0), pending: valid.filter(c => c.status === "PENDING").length };
  });
  const monthlyApprovedCents = monthlyTotals._sum.approvedCents || 0;
  const latest = activePolicy(policies, [localDay(new Date()), `${month}-31`].sort()[0]);
  return { company: ctx.company, admin: ctx.admin, month, day, rows, credits: (day ? credits.filter(c => c.day === day) : credits).map(c => ctx.admin ? c : { ...c, snapshot: { title: (c.snapshot as any).title }, verification: c.verification ? { start: (c.verification as any).start, end: (c.verification as any).end } : null, calculation: { issue: (c.calculation as any).issue, weightedPercent: (c.calculation as any).weightedPercent, allocations: (c.calculation as any).allocations } }), monthlyApprovedCents, monthlyBudgetCents: ctx.admin ? (latest?.config as any)?.monthlyBudgetCents ?? null : null, policies: ctx.admin ? policies : [], defaults: ctx.admin ? defaultPolicy : null, audits, departments, note: "Discretionary incentive only. Actual extra time uses recorded attendance punches; breaks are not inferred. Statutory overtime and payroll are unchanged." };
}
