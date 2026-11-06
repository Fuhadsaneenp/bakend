import { test } from "node:test";
import assert from "node:assert/strict";
import { paidLeaveDays, isPaidLeave, firstPaidLeaveDay } from "../src/lib/paidLeave.js";
import { assertPaidLeaveLimit, withPaidLeaveLock } from "../src/modules/wfh/paid-leave-limit.js";
import { prisma } from "../src/lib/prisma.js";
import mariadb from "mariadb";
import { buildAttendanceSnapshot } from "../src/modules/payroll/payroll.service.js";
const leave = (day: string, status = "APPROVED", reason = "[Paid Leave] Requested") => ({ startDate: new Date(day + "T00:00:00+05:30"), endDate: new Date(day + "T00:00:00+05:30"), reason, status });

test("one paid date per IST calendar month, with duplicate dates and rejected requests handled", () => {
  assert.deepEqual([...paidLeaveDays([leave("2026-10-30"), leave("2026-10-12"), leave("2026-10-12"), leave("2026-11-02"), leave("2026-11-01", "REJECTED")])], ["2026-10-12", "2026-11-02"]);
  assert.equal(isPaidLeave("[Unpaid Leave] Leave"), false);
  assert.equal(isPaidLeave('{"type":"Paid Leave"}'), true);
});
test("server validates quota for pending requests, approvals and multi-day submissions", async () => {
  const original = prisma.wFHRequest.findMany;
  let existing: any[] = [{ reason: "[Paid Leave] first" }]; let where: any;
  (prisma.wFHRequest as any).findMany = async (args: any) => { where = args.where; return existing; };
  try {
    await assert.rejects(assertPaidLeaveLimit("employee", leave("2026-10-30")), /already has a paid-leave/);
    assert.deepEqual(where.status, { not: "REJECTED" });
    await assert.rejects(assertPaidLeaveLimit("employee", leave("2026-10-30"), true, "request"), /already has a paid-leave/);
    assert.equal(where.status, "APPROVED"); assert.deepEqual(where.id, { not: "request" });
    existing = [];
    await assertPaidLeaveLimit("employee", leave("2026-11-01"));
    await assert.rejects(assertPaidLeaveLimit("employee", { startDate: "2026-10-12", endDate: "2026-10-13" }), /Only one day/);
  } finally { prisma.wFHRequest.findMany = original; await prisma.$disconnect(); }
});
test("paid-leave lock releases and closes its dedicated session on workflow failure", async () => {
  const original = mariadb.createConnection; const calls: string[] = [];
  (mariadb as any).createConnection = async () => ({ query: async (sql: string) => { calls.push(sql); return [{ held: 1 }]; }, end: async () => { calls.push("end"); } });
  try { await assert.rejects(withPaidLeaveLock("employee", async () => { throw Error("failure"); }), /failure/); assert.deepEqual(calls, ["SELECT GET_LOCK(?, 10) AS held", "SELECT RELEASE_LOCK(?)", "end"]); }
  finally { mariadb.createConnection = original; }
});
test("payroll credits October 12 but does not pay October 30 as a second paid-leave day", () => {
  const snapshot = buildAttendanceSnapshot({ month: 10, year: 2026, type: "REGULAR", employee: { dateOfJoining: new Date("2020-01-01"), company: { name: "Second Tales LLP", worksSevenDays: true }, attendance: [], wfhRequests: [leave("2026-10-30"), leave("2026-10-12")] } });
  assert.equal(snapshot.dayCredits.get("2026-10-12"), 1);
  assert.equal(snapshot.dayCredits.get("2026-10-30"), 0);
});

test("three-month eligibility respects the 15th cutoff and rolls into the next year", () => {
  assert.equal(firstPaidLeaveDay("2026-08-14"), "2026-11-14");
  assert.equal(firstPaidLeaveDay("2026-08-15"), "2026-12-01");
  assert.equal(firstPaidLeaveDay("2026-08-25"), "2026-12-01");
  assert.equal(firstPaidLeaveDay("2026-09-16"), "2027-01-01");
});
