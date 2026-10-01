import test from "node:test";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { employeeService } from "./employee.service.js";

test("super admins can load every company and explicitly select one; HR retains its company scope", async () => {
  const originalFindUnique = prisma.employee.findUnique;
  const originalFindMany = prisma.employee.findMany;
  const originalFindSetting = prisma.companySetting.findFirst;
  const employees = [
    { id: "second-tales-employee", companyId: "second-tales" },
    { id: "medbiomate-employee", companyId: "medbiomate" }
  ];
  const scopes: any[] = [];
  (prisma.employee as any).findUnique = async () => null;
  (prisma.companySetting as any).findFirst = async () => null;
  (prisma.employee as any).findMany = async ({ where }: any) => {
    scopes.push(where);
    return employees.filter((employee) => !where || employee.companyId === where.companyId);
  };
  const user = { id: "admin", email: "admin@example.com", role: Role.SUPER_ADMIN, companyId: "second-tales" };
  try {
    assert.deepEqual(await employeeService.listForUser(user), employees);
    assert.equal(scopes[0], undefined);
    assert.deepEqual(await employeeService.listForUser(user, "medbiomate"), [employees[1]]);
    assert.deepEqual(scopes[1], { companyId: "medbiomate" });
    assert.deepEqual(await employeeService.listForUser({ ...user, role: Role.HR_ADMIN }), [employees[0]]);
    assert.deepEqual(scopes[2], { companyId: "second-tales" });
    assert.deepEqual(await employeeService.listForUser({ ...user, companyId: null }), employees);
  } finally {
    prisma.employee.findUnique = originalFindUnique;
    prisma.employee.findMany = originalFindMany;
    prisma.companySetting.findFirst = originalFindSetting;
    await prisma.$disconnect();
  }
});
