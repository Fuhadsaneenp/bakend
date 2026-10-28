import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import { authService } from "../src/modules/auth/auth.service.js";

test("company alias lookup avoids LIKE and rejects ambiguous aliases", async () => {
  const first = prisma.user.findFirst;
  const many = prisma.user.findMany;
  let found = false;
  let candidates: any[] = [{ id: "shameena", email: "shameenasemi66@example.test", isActive: true, employee: { firstName: "Shameena", status: "TERMINATED" } }];
  (prisma.user as any).findFirst = async () => null;
  (prisma.user as any).findMany = async (args: any) => {
    assert.equal(args.where, undefined);
    found = true;
    return candidates;
  };
  try {
    await assert.rejects(authService.login("shameena@secondtales.com", "invalid"), /offboarded/);
    assert.equal(found, true);
    candidates = [...candidates, { ...candidates[0], id: "other" }];
    await assert.rejects(authService.login("shameena@secondtales.com", "invalid"), /Invalid credentials/);
  } finally {
    prisma.user.findFirst = first;
    prisma.user.findMany = many;
    await prisma.$disconnect();
  }
});
