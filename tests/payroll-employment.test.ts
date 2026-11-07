import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL = "mysql://test:test@127.0.0.1:1/test";
process.env.NODE_ENV = "test";
const { computePayrollAmounts } = await import("../src/modules/payroll/payroll.service.js");

test("regular and final payroll include joining and exit days and exclude punches outside employment", () => {
  const employee = {
    id: "employee",
    employeeCode: "EMP-1",
    dateOfJoining: new Date("2026-11-03"),
    dateOfExit: new Date("2026-11-05"),
    salary: { basic: 30_000, allowances: 3_000, deductions: 300 },
    attendance: [2, 3, 4, 5, 6].map(day => ({
      workDate: new Date(Date.UTC(2026, 10, day)),
      checkInAt: new Date(Date.UTC(2026, 10, day, 4)),
      checkOutAt: new Date(Date.UTC(2026, 10, day, 13)),
      workMinutes: 540
    })),
    wfhRequests: []
  };

  for (const type of ["REGULAR", "FINAL"] as const) {
    const amounts = computePayrollAmounts({ month: 11, year: 2026, type, holidays: [], employee });
    assert.deepEqual(amounts, { attendanceDays: 3, payableDays: 3, lopDays: 0, basic: 3000, allowances: 300, deductions: 30 });
  }

  const followingMonth = computePayrollAmounts({ month: 12, year: 2026, type: "REGULAR", holidays: [], employee });
  assert.equal(followingMonth.payableDays, 0);
  assert.equal(followingMonth.basic, 0);
});
