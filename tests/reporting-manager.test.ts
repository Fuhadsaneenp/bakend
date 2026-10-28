import { test } from "node:test";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { assertReportingManager, reportingManagerOptions } from "../src/modules/employees/reporting-manager.service.js";

test("active Core Team managers can serve both companies without changing their employing company", async () => {
  const originalFind = prisma.employee.findUnique;
  const originalList = prisma.employee.findMany;
  const originalSetting = prisma.companySetting.findFirst;
  const active = { id: "core", companyId: "home", firstName: "Core", middleName: null, lastName: "Manager", employeeCode: "C1", isCoreTeam: true, status: "ACTIVE", dateOfJoining: new Date("2020-01-01"), dateOfExit: null, user: { isActive: true, role: Role.MANAGER }, department: { name: "Leadership", code: "LEAD" }, designation: { title: "Director" } };
  let candidate: any = { ...active };
  (prisma.employee as any).findUnique = async () => candidate;
  (prisma.companySetting as any).findFirst = async () => ({ value: ["second"] });
  (prisma.employee as any).findMany = async () => [active, { ...active, id: "local", companyId: "second", isCoreTeam: false }, { ...active, id: "unassigned", isCoreTeam: false }, { ...active, id: "former", dateOfExit: new Date("2021-01-01") }];
  try {
    assert.equal((await assertReportingManager("core", "second")).companyId, "home");
    candidate = { ...active, isCoreTeam: false };
    await assert.rejects(assertReportingManager("core", "second"), /company or be a Core Team/);
    await assertReportingManager("core", "home");
    candidate = { ...active, isCoreTeam: false, department: { name: "Core Team", code: "CORE" } };
    await assertReportingManager("core", "second");
    for (const invalid of [{ status: "INACTIVE" }, { dateOfExit: new Date("2021-01-01") }, { user: { isActive: false, role: Role.MANAGER } }, { dateOfJoining: new Date("2099-01-01") }]) {
      candidate = { ...active, ...invalid };
      await assert.rejects(assertReportingManager("core", "second"), /active reporting manager/);
    }
    candidate = null;
    await assert.rejects(assertReportingManager("missing", "second"), /active reporting manager/);
    const user = { id: "hr", email: "hr@example.test", role: Role.HR_ADMIN, companyId: "second" };
    const options = await reportingManagerOptions(user, "second");
    assert.deepEqual(options.map(e => e.id), ["core", "local"]);
    assert.equal(options[0].isCoreTeam, true);
    assert.equal("user" in options[0], false);
    assert.equal("salary" in options[0], false);
    await assert.rejects(reportingManagerOptions(user, "unassigned"), /do not have access/);
  } finally {
    prisma.employee.findUnique = originalFind;
    prisma.employee.findMany = originalList;
    prisma.companySetting.findFirst = originalSetting;
    await prisma.$disconnect();
  }
});
