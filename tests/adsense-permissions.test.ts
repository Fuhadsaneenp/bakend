import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ZodError } from "zod";
import jwt from "jsonwebtoken";
import { adsenseRouter } from "../src/modules/adsense/adsense.routes.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { permissionService } from "../src/modules/authority/permission.service.js";

test("report and connection routes enforce independent read and admin permissions", async () => {
  const find = prisma.user.findUnique, setting = prisma.companySetting.findUnique, many = prisma.companySetting.findMany, permissions = permissionService.requirePermission;
  let allowed = false;
  (prisma.user as any).findUnique = async () => ({ id: "reader", companyId: "tenant", role: "EMPLOYEE", email: "reader@example.test", isActive: true, employee: null });
  (prisma.companySetting as any).findUnique = async () => null;
  (prisma.companySetting as any).findMany = async () => [];
  permissionService.requirePermission = async (_id: string, code: string) => { assert.equal(code, "adsense.views.view"); if (!allowed) throw Object.assign(new Error("Permission required"), { statusCode: 403 }); };
  const app = express(); app.use(express.json()); app.use("/adsense", adsenseRouter); app.use((error: any, _req: any, res: any, _next: any) => res.status(error instanceof ZodError ? 422 : error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as any).port, base = `http://127.0.0.1:${port}/adsense`;
  const headers = { Authorization: "Bearer " + jwt.sign({ id: "reader" }, env.JWT_ACCESS_SECRET, { expiresIn: "1m" }) };
  try {
    assert.equal((await fetch(base + "/report")).status, 401);
    assert.equal((await fetch(base + "/report", { headers })).status, 403);
    allowed = true;
    const response = await fetch(base + "/report", { headers }); assert.equal(response.status, 200); const report = await response.json() as any; assert.equal(report.canManage, false);
    for (const [path, method] of [["/connect", "POST"], ["/refresh", "POST"], ["/connection", "DELETE"]]) assert.equal((await fetch(base + path, { method, headers })).status, 403);
    assert.equal((await fetch(base + "/report?website=private.example", { headers })).status, 422); // Validation rejected before any data access.
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); prisma.user.findUnique = find; prisma.companySetting.findUnique = setting; prisma.companySetting.findMany = many; permissionService.requirePermission = permissions; await prisma.$disconnect(); }
});
