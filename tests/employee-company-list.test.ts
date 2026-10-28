import { test } from "node:test";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { employeeService } from "../src/modules/employees/employee.service.js";

test("employee management loads all authorized companies and rejects unassigned companies", async () => {
  const originalFindEmployee = prisma.employee.findUnique;
  const originalListEmployees = prisma.employee.findMany;
  const originalSetting = prisma.companySetting.findFirst;
  let assignedCompanies = ["home", "second"];
  let capturedWhere: any;
  const user = { id: "hr-user", email: "hr@example.test", role: Role.MANAGER, companyId: "home" };
  (prisma.employee as any).findUnique = async () => ({ id: "hr-employee", userId: user.id, department: { name: "HR" }, designation: { title: "HR Executive" }, user: { role: Role.MANAGER } });
  (prisma.companySetting as any).findFirst = async ({ where }: any) => typeof where.key === "string" ? { value: assignedCompanies } : null;
  (prisma.employee as any).findMany = async ({ where }: any) => { capturedWhere = where; return []; };
  try {
    await employeeService.listForUser(user);
    assert.deepEqual(capturedWhere, { companyId: { in: ["home", "second"] } });
    await employeeService.listForUser(user, "second");
    assert.deepEqual(capturedWhere, { companyId: "second" });
    await assert.rejects(employeeService.listForUser(user, "unassigned"), /do not have access/);
    assignedCompanies = ["home"];
    await employeeService.listForUser(user);
    assert.deepEqual(capturedWhere, { companyId: { in: ["home"] } });
    await assert.rejects(employeeService.listForUser(user, "second"), /do not have access/);
  } finally {
    prisma.employee.findUnique = originalFindEmployee;
    prisma.employee.findMany = originalListEmployees;
    prisma.companySetting.findFirst = originalSetting;
    await prisma.$disconnect();
  }
});
