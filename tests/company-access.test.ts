import { test } from "node:test";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { allowedCompanyIds, assertCompanyAccess, saveCompanyAccess } from "../src/modules/org/company-access.service.js";

// Database methods are stubbed; these tests never access a live database.
test("company assignments restrict access independently of admin role", async () => {
  const findFirst = prisma.companySetting.findFirst;
  const findMany = prisma.company.findMany;
  const findUser = prisma.user.findUnique;
  const upsert = prisma.companySetting.upsert;
  let assignment: string[] | null = null;
  let persisted: any;
  (prisma.companySetting as any).findFirst = async () => assignment ? { companyId: "a", value: assignment } : null;
  (prisma.company as any).findMany = async () => [{ id: "a" }, { id: "b" }];
  (prisma.user as any).findUnique = async () => ({ id: "employee", role: Role.EMPLOYEE, companyId: "a" });
  (prisma.companySetting as any).upsert = async (args: any) => { persisted = args; return args; };
  const user = { id: "employee", role: Role.EMPLOYEE, companyId: "a" };
  try {
    assert.deepEqual(await allowedCompanyIds(user), ["a"]);
    await assert.rejects(assertCompanyAccess(user, "b"), /do not have access/);
    assignment = ["a", "b"];
    assert.deepEqual(await allowedCompanyIds(user), ["a", "b"]);
    await assertCompanyAccess(user, "b");
    assignment = ["b"];
    await assert.rejects(assertCompanyAccess(user, "a"), /do not have access/);
    assert.deepEqual(await allowedCompanyIds({ ...user, role: Role.HR_ADMIN }), ["b"]);
    assert.deepEqual(await allowedCompanyIds({ ...user, role: Role.SUPER_ADMIN }), ["a", "b"]);
    await saveCompanyAccess("employee", ["a", "b", "a"]);
    assert.deepEqual(persisted.update.value, ["a", "b"]);
    await assert.rejects(saveCompanyAccess("employee", []), /at least one valid company/);
    await assert.rejects(saveCompanyAccess("employee", ["unknown"]), /at least one valid company/);
  } finally {
    prisma.companySetting.findFirst = findFirst;
    prisma.company.findMany = findMany;
    prisma.user.findUnique = findUser;
    prisma.companySetting.upsert = upsert;
    await prisma.$disconnect();
  }
});
