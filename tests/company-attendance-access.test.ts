import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalStatus, Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { attendanceService } from "../src/modules/attendance/attendance.service.js";
import { wfhService } from "../src/modules/wfh/wfh.service.js";
import { notificationService } from "../src/modules/notifications/notification.service.js";
import { payrollService } from "../src/modules/payroll/payroll.service.js";

test("both-company attendance access includes reports and regularisations, and revocation blocks reviews", async () => {
  const db = prisma as any;
  const restores: (() => void)[] = [];
  const stub = (object: any, key: string, value: any) => {
    const original = object[key]; object[key] = value; restores.push(() => { object[key] = original; });
  };
  const user = { id: "reviewer", email: "reviewer@example.test", companyId: "second-tales", role: Role.EMPLOYEE };
  let assignments = ["second-tales", "medbiomate"];
  let reportWhere: any, requestsWhere: any, reviewData: any, corrected: any, payrollCompany: string | undefined;
  const employee = { id: "med-staff", userId: "med-user", companyId: "medbiomate", firstName: "Med", lastName: "Staff", managerId: null, manager: null, shift: null };
  const request: any = { id: "request", employeeId: employee.id, employee, startDate: new Date("2026-11-02T00:00:00+05:30"), endDate: new Date("2026-11-02T00:00:00+05:30"), reason: "[Missed Punch] [Full Time] [IN=09:00] [OUT=18:00] Correction", status: ApprovalStatus.PENDING, immediateManagerStatus: ApprovalStatus.PENDING, higherManagerStatus: ApprovalStatus.PENDING, hrHeadStatus: ApprovalStatus.PENDING };
  stub(db.companySetting, "findFirst", async ({ where }: any) => typeof where.key === "string" ? { value: assignments } : null);
  stub(db.employee, "findUnique", async ({ where }: any) => where.id ? employee : { id: "reviewer-employee", userId: user.id, companyId: user.companyId, firstName: "Reviewer", lastName: "Staff", department: null, designation: null });
  stub(db.attendance, "findMany", async ({ where }: any) => { reportWhere = where; return []; });
  stub(db.wFHRequest, "findMany", async ({ where }: any) => { requestsWhere = where; return []; });
  stub(db.wFHRequest, "findUnique", async () => request);
  stub(db.wFHRequest, "update", async ({ data }: any) => { reviewData = data; return { ...request, ...data }; });
  stub(db.attendance, "upsert", async (args: any) => { corrected = args; return {}; });
  stub(notificationService, "inApp", async () => ({}));
  stub(payrollService, "recalculateDraftRunsForPeriods", async (companyId: string) => { payrollCompany = companyId; });
  try {
    await attendanceService.monthlyReportForUser(user, 11, 2026);
    assert.deepEqual(reportWhere.employee.companyId, { in: assignments });
    await attendanceService.monthlyReportForUser(user, 11, 2026, "medbiomate");
    assert.equal(reportWhere.employee.companyId, "medbiomate");
    await wfhService.listForUser(user);
    assert.deepEqual(requestsWhere.employee.companyId, { in: assignments });
    await wfhService.listForUser(user, "medbiomate");
    assert.equal(requestsWhere.employee.companyId, "medbiomate");
    const approved = await wfhService.review("request", user, ApprovalStatus.APPROVED);
    assert.equal(approved.status, ApprovalStatus.APPROVED);
    assert.equal(reviewData.hrHeadReviewedBy, user.id);
    assert.equal(corrected.where.employeeId_workDate.employeeId, employee.id);
    assert.equal(corrected.update.checkInAt.toISOString(), "2026-11-02T03:30:00.000Z");
    assert.equal(payrollCompany, "medbiomate");

    assignments = ["second-tales"];
    corrected = undefined;
    await assert.rejects(wfhService.review("request", user, ApprovalStatus.APPROVED), /do not have access/);
    await assert.rejects(wfhService.review("request", { ...user, role: Role.HR_ADMIN }, ApprovalStatus.APPROVED), /do not have access/);
    assert.equal(corrected, undefined);
    await assert.rejects(wfhService.listForUser(user, "medbiomate"), /do not have access/);
    await assert.rejects(attendanceService.monthlyReportForUser(user, 11, 2026, "medbiomate"), /do not have access/);
    await attendanceService.monthlyReportForUser(user, 11, 2026);
    assert.equal(reportWhere.employee.id, "reviewer-employee");
    assert.deepEqual(reportWhere.employee.companyId, { in: ["second-tales"] });
  } finally {
    restores.reverse().forEach(restore => restore());
    await prisma.$disconnect();
  }
});
