import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { ZodError } from "zod";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { productivityIncentiveRouter } from "../src/modules/productivity-incentive/routes.js";

test("incentive routes deny unassigned companies, cross-employee reads and employee administration", async () => {
  const originals = { user: prisma.user.findUnique, employee: prisma.employee.findUnique, setting: prisma.companySetting.findFirst, company: prisma.company.findMany };
  let companyId = "med", role = "EMPLOYEE";
  (prisma.user as any).findUnique = async () => ({ id: "employee-user", companyId, role, email: "test@example.test", isActive: true, employee: null });
  (prisma.employee as any).findUnique = async () => ({ id: "employee", companyId });
  (prisma.companySetting as any).findFirst = async () => null;
  (prisma.company as any).findMany = async ({ where }: any) => where.id.in.includes("med") ? [{ id: "med", name: "Medbiomate" }] : [];
  const app = express(); app.use(express.json()); app.use("/incentives", productivityIncentiveRouter); app.use((e: any, _req: any, res: any, _next: any) => res.status(e instanceof ZodError ? 422 : e.statusCode || 500).json({ message: e.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/incentives`;
  const headers = { Authorization: `Bearer ${jwt.sign({ id: "employee-user" }, env.JWT_ACCESS_SECRET, { expiresIn: "1m" })}`, "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/report?month=2026-11`)).status, 401);
    assert.equal((await fetch(`${base}/report?month=2026-11&employeeId=someone-else`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/report?month=2026-02&day=2026-02-30`, { headers })).status, 422);
    for (const path of ["policies", "credits/other/verify", "credits/other/review"]) assert.equal((await fetch(`${base}/${path}`, { method: "POST", headers, body: "{}" })).status, 403);
    assert.equal((await fetch(`${base}/sync`, { method: "POST", headers, body: JSON.stringify({ month: "2026-11", recalculate: true, reason: "unauthorized" }) })).status, 403);
    companyId = "second";
    assert.equal((await fetch(`${base}/report?month=2026-11`, { headers })).status, 403);
    role = "HR_ADMIN";
    assert.equal((await fetch(`${base}/policies`, { method: "POST", headers, body: "{}" })).status, 403, "admin role alone cannot bypass company assignments");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    prisma.user.findUnique = originals.user; prisma.employee.findUnique = originals.employee; prisma.companySetting.findFirst = originals.setting; prisma.company.findMany = originals.company;
    await prisma.$disconnect();
  }
});
