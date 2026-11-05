import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import { reconcile, review, verify, context, report } from "../src/modules/productivity-incentive/service.js";
import { defaultPolicy } from "../src/modules/productivity-incentive/domain.js";
import { Role } from "@prisma/client";

test("source ingestion, frozen calculations, invalidation audit, overlapping intervals, budgets and tenant visibility", async () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-11-06T00:00:00Z");
  const saved = { transaction: prisma.$transaction, company: prisma.company.findMany, employee: prisma.employee.findUnique, settings: prisma.companySetting.findFirst, credits: prisma.incentiveCredit.findMany, employees: prisma.employee.findMany, attendance: prisma.attendance.findMany, policies: prisma.incentivePolicy.findMany, audits: prisma.incentiveAudit.findMany, departments: prisma.department.findMany, aggregate: prisma.incentiveCredit.aggregate };
  let rows: any[] = [], audits: any[] = [], lockCount = 0, queue: Promise<any> = Promise.resolve();
  const employees: any[] = [{ id: "med-employee", userId: "med-user", companyId: "med", firstName: "Test", lastName: "Employee", employeeCode: "T1", departmentId: "data", dateOfJoining: new Date("2020-01-01"), dateOfExit: null, salary: { basic: 12000, allowances: 0, effectiveFrom: new Date("2020-01-01") }, salaryHistory: [] }];
  const policies: any[] = [{ id: "p1", effectiveFrom: "2026-11-01", config: { ...defaultPolicy, allEmployees: true, monthlyHoursDivisor: 100 } }];
  const punch = { employeeId: "med-employee", workDate: new Date("2026-11-05T00:00:00+05:30"), checkInAt: new Date("2026-11-05T09:00:00+05:30"), checkOutAt: new Date("2026-11-05T21:00:00+05:30") };
  const input = (site: string, id: number, title: string) => ({ site, type: "job", postId: id, employeeId: "med-employee", url: `https://${site}.com/jobs/${id}`, title, companyName: "Employer", location: "Kochi", createdAt: "2026-11-05T18:30:00+05:30", uploadedAt: "2026-11-05T18:30:00+05:30", updatedAt: "2026-11-05T18:30:00+05:30", status: "publish" });
  const sources: any[] = [input("medbiomate", 1, "Job 1"), input("trikonet", 2, "Job 1"), input("mediyox", 3, "Job 1")];
  const match = (r: any, where: any) => (!where.companyId || r.companyId === where.companyId) && (!where.month || r.month === where.month) && (!where.day || r.day === where.day) && (!where.employeeId || r.employeeId === where.employeeId) && (!where.id?.not || r.id !== where.id.not) && (!where.status?.notIn || !where.status.notIn.includes(r.status));
  const findMany = async ({ where }: any = {}) => rows.filter(r => match(r, where || {}));
  const aggregate = async ({ where }: any) => ({ _sum: { approvedCents: rows.filter(r => match(r, where)).reduce((sum, r) => sum + r.approvedCents, 0) } });
  const tx: any = {
    companySetting: { upsert: async () => ({}), findMany: async () => sources.map(value => ({ value })) },
    $queryRaw: async (parts: TemplateStringsArray) => { assert.match(parts.join("?"), /FOR UPDATE/); lockCount++; return []; },
    incentivePolicy: { findMany: async () => [...policies].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)) },
    employee: { findMany: async () => employees }, attendance: { findMany: async () => [punch], findUnique: async () => punch },
    incentiveAudit: { create: async ({ data }: any) => { audits.push(data); return data; } },
    incentiveCredit: { findMany, aggregate, findFirst: async ({ where }: any) => rows.find(r => r.id === where.id && r.companyId === where.companyId),
      create: async ({ data }: any) => { const row = { ...data, id: `c${rows.length + 1}`, revision: 1, verification: null }; rows.push(row); return row; },
      update: async ({ where, data }: any) => { const index = rows.findIndex(r => r.id === where.id); rows[index] = { ...rows[index], ...data, revision: data.revision?.increment ? rows[index].revision + data.revision.increment : rows[index].revision }; return rows[index]; }
    }
  };
  (prisma as any).$transaction = (fn: any) => { const call = queue.then(async () => { const beforeRows = structuredClone(rows), beforeAudits = structuredClone(audits); try { return await fn(tx); } catch (e) { rows = beforeRows; audits = beforeAudits; throw e; } }); queue = call.catch(() => {}); return call; };
  const interval = (start: string, end: string) => ({ start: `2026-11-05T${start}:00+05:30`, end: `2026-11-05T${end}:00+05:30`, evidence: "Verified work log" });
  try {
    const captured = await reconcile("med", "2026-11", "admin"); assert.equal(captured.changed, 3); assert.equal(rows.length, 3);
    assert.equal((await reconcile("med", "2026-11", "admin")).changed, 0, "retries cannot earn twice");
    sources[0].activityType = "edited"; sources[0].updatedAt = "2026-11-05T19:00:00+05:30";
    assert.equal((await reconcile("med", "2026-11", "admin")).changed, 0, "edits retain original creation identity");
    await verify("med", "c1", rows[0].revision, "admin", interval("17:50", "18:10"));
    assert.equal(rows[0].estimatedCents, 50);
    await review("med", "c1", rows[0].revision, "admin", "APPROVE", "Verified"); assert.equal(rows[0].approvedCents, 50);
    const approvedRevision = rows[0].revision;
    assert.equal((await reconcile("med", "2026-11", "admin")).changed, 0); assert.equal(rows[0].revision, approvedRevision);
    await assert.rejects(review("med", "c1", approvedRevision - 1, "admin", "APPROVE", "Retry"), /changed/);
    sources[0].status = "draft"; await reconcile("med", "2026-11", "admin"); assert.equal(rows[0].approvedCents, 0); assert.equal(rows[0].creditedMinutes, 0); assert.equal(rows[0].status, "INVALIDATED");
    assert.ok(audits.some(a => a.action === "SOURCE_RECONCILED" && a.detail.before?.approvedCents === 50));
    sources[0].status = "publish"; await reconcile("med", "2026-11", "admin");
    employees[0].salary.basic = 24000;
    policies.push({ id: "p2", effectiveFrom: "2026-11-05", config: { ...policies[0].config, jobMinutes: 4, monthlyBudgetCents: 75 } });
    await reconcile("med", "2026-11", "admin"); assert.equal(rows[0].policyId, "p1"); assert.equal(rows[0].estimatedCents, 50, "new policies and salary changes do not rewrite history");
    await assert.rejects(verify("med", "c2", rows[1].revision, "admin", interval("17:55", "18:05")), /overlaps/);
    await verify("med", "c2", rows[1].revision, "admin", interval("17:30", "17:40"));
    await verify("med", "c3", rows[2].revision, "admin", interval("17:40", "17:50"));
    const outcomes = await Promise.allSettled([review("med", "c2", rows[1].revision, "admin", "APPROVE", "Verified"), review("med", "c3", rows[2].revision, "admin", "APPROVE", "Verified")]);
    assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1); assert.equal(rows.reduce((sum, r) => sum + r.approvedCents, 0), 40);
    await reconcile("med", "2026-11", "admin", true); assert.equal(rows[0].policyId, "p2"); assert.equal(rows[0].estimatedCents, 200); assert.equal(rows[0].approvedCents, 0); assert.ok(audits.some(a => a.action === "EXPLICIT_RECALCULATION"));
    await assert.rejects(review("med", "c1", rows[0].revision, "admin", "APPROVE", "Verified"), /budget/);
    sources.push({ ...input("medbiomate", 99, "Alias"), url: sources[0].url });
    sources.push({ ...input("mediyox", 100, "Old edited record"), createdAt: "2026-11-05T17:00:00+05:30", activityType: "edited" });
    sources.push({ ...input("trikonet", 101, "Missing creation"), createdAt: undefined });
    const sync = await reconcile("med", "2026-11", "admin"); assert.equal(sync.missingCreationTimestamps, 1); assert.equal(rows.length, 4); assert.equal(rows[3].status, "INVALIDATED"); assert.equal(rows[3].estimatedCents, 0);
    sources.push({ ...input("medbiomate", 98, "New valid role"), createdAt: "2026-11-05T18:00:00+05:30", status: "draft" });
    sources.push(input("medbiomate", 97, "New valid role"));
    await reconcile("med", "2026-11", "admin");
    assert.equal(rows.find(r => r.sourceKey === "medbiomate:job:97").status, "PENDING", "an unpublished draft cannot disqualify the valid saved record");
    sources[0].createdAt = "2026-12-01T18:30:00+05:30";
    await reconcile("med", "2026-12", "admin"); assert.equal(rows.filter(r => r.sourceKey === "medbiomate:job:1").length, 1);
    await reconcile("med", "2026-11", "admin"); assert.equal(rows[0].calculation.issue, "SOURCE_IDENTITY_CHANGED");
    assert.ok(lockCount > 10);

    (prisma.company as any).findMany = async () => [{ id: "med", name: "Medbiomate" }];
    (prisma.companySetting as any).findFirst = async () => ({ value: ["med"] });
    (prisma.employee as any).findUnique = async () => ({ id: "med-employee", companyId: "med" });
    const user = { id: "med-user", role: Role.EMPLOYEE, companyId: "med", email: "test@example.test" };
    assert.equal((await context(user)).admin, false);
    await assert.rejects(report(user, "2026-11", undefined, "another-employee"), /own activity/);
    (prisma.incentiveCredit as any).findMany = findMany;
    (prisma.employee as any).findMany = async () => employees;
    (prisma.attendance as any).findMany = async () => [punch];
    (prisma.incentivePolicy as any).findMany = async () => policies;
    (prisma.incentiveCredit as any).aggregate = aggregate;
    const self = await report(user, "2026-11"); assert.equal(self.admin, false); assert.deepEqual(self.audits, []); assert.deepEqual(self.policies, []); assert.equal((self.credits[0].snapshot as any).hourlyRate, undefined);
  } finally {
    Date.now = originalNow;
    (prisma as any).$transaction = saved.transaction; prisma.company.findMany = saved.company; prisma.employee.findUnique = saved.employee; prisma.companySetting.findFirst = saved.settings;
    prisma.incentiveCredit.findMany = saved.credits; prisma.employee.findMany = saved.employees; prisma.attendance.findMany = saved.attendance; prisma.incentivePolicy.findMany = saved.policies; prisma.incentiveAudit.findMany = saved.audits; prisma.department.findMany = saved.departments; prisma.incentiveCredit.aggregate = saved.aggregate;
    await prisma.$disconnect();
  }
});
