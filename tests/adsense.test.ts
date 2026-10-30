import { test } from "node:test";
import assert from "node:assert/strict";
import { day, range, reportQuery, parseReport, encrypt, decrypt, snapshotHour, compareSnapshots, comparisonMonths, summarizeViews } from "../src/modules/adsense/adsense.domain.js";
import { begin, callback, sync, report, disconnect, CONNECTION } from "../src/modules/adsense/adsense.service.js";
import { prisma } from "../src/lib/prisma.js";
import { Role } from "@prisma/client";
process.env.ADSENSE_TOKEN_KEY = "ab".repeat(32);
process.env.ADSENSE_GOOGLE_CLIENT_ID = "test-client";
process.env.ADSENSE_GOOGLE_CLIENT_SECRET = "test-secret";
process.env.ADSENSE_GOOGLE_REDIRECT_URI = "https://api.example.test/api/adsense/google/callback";
test("AdSense only requests date and page views with an exact owned-site filter", () => {
  const q = reportQuery("site-123", "2026-10-01", "2026-10-30");
  assert.deepEqual(q.getAll("dimensions"), ["DATE"]);
  assert.deepEqual(q.getAll("metrics"), ["PAGE_VIEWS"]);
  assert.equal(q.get("filters"), "OWNED_SITE_ID==site-123");
  assert.equal(q.get("reportingTimeZone"), "ACCOUNT_TIME_ZONE");
  assert.throws(() => range("2026-02-30", "2026-03-01"));
  assert.throws(() => range("2026-10-30", "2026-10-01"));
  assert.equal(day("America/Los_Angeles", new Date("2026-10-30T02:00:00Z")), "2026-10-29");
  const result = parseReport({ headers: [{ name: "DATE" }, { name: "PAGE_VIEWS" }], rows: [{ cells: [{ value: "2026-10-01" }, { value: "15" }] }], totalMatchedRows: "1" }, "2026-10-01", "2026-10-02");
  assert.deepEqual(result, [{ date: "2026-10-01", pageViews: 15 }, { date: "2026-10-02", pageViews: 0 }]);
  assert.throws(() => parseReport({ headers: [{ name: "DATE" }, { name: "EARNINGS" }] }, "2026-10-01", "2026-10-02"));
  assert.throws(() => parseReport({ warnings: ["truncated"] }, "2026-10-01", "2026-10-02"));
  const sealed = encrypt("secret-refresh-token"); assert.equal(decrypt(sealed), "secret-refresh-token"); assert.ok(!sealed.includes("secret"));
  const parts = sealed.split("."); parts[1] = Buffer.alloc(16).toString("base64url"); assert.throws(() => decrypt(parts.join(".")));
});
test("OAuth replay protection, encrypted refresh, site isolation, revised upserts and disconnect", async () => {
  const originals = { unique: prisma.companySetting.findUnique, first: prisma.companySetting.findFirst, many: prisma.companySetting.findMany, upsert: prisma.companySetting.upsert, create: prisma.companySetting.create, update: prisma.companySetting.update, deleteMany: prisma.companySetting.deleteMany, user: prisma.user.findUnique, transaction: prisma.$transaction, fetch: globalThis.fetch };
  const database = new Map<string, any>(); let count = 40, refreshed = 0, siteAccess = true; const reportCalls: URL[] = [];
  const key = (companyId: string, key: string) => `${companyId}:${key}`;
  const db: any = prisma.companySetting;
  db.findUnique = async ({ where }: any) => database.get(key(where.companyId_key.companyId, where.companyId_key.key)) || null;
  db.findFirst = async ({ where }: any) => [...database.values()].find(row => row.key === where.key) || null;
  db.findMany = async ({ where }: any) => [...database.values()].filter(row => row.companyId === where.companyId && where.key.in.includes(row.key));
  db.upsert = async ({ where, create, update }: any) => { const k = key(where.companyId_key.companyId, where.companyId_key.key); const old = database.get(k); const next = old ? { ...old, ...update } : { ...create, id: k, updatedAt: new Date() }; database.set(k, next); return next; };
  db.create = async ({ data }: any) => { const k = key(data.companyId, data.key); if (database.has(k)) throw Object.assign(new Error("duplicate"), { code: "P2002" }); const row = { ...data, id: k, updatedAt: new Date() }; database.set(k, row); return row; };
  db.update = async ({ where, data }: any) => { const row = [...database.values()].find(row => row.id === where.id); const next = { ...row, ...data }; database.set(row.id, next); return next; };
  db.deleteMany = async ({ where }: any) => { let count = 0; for (const [k, row] of database) if ((where.id ? row.id === where.id : row.companyId === where.companyId && row.key === where.key) && (!where.updatedAt || row.updatedAt < where.updatedAt.lt)) { database.delete(k); count++; } return { count }; };
  (prisma.user as any).findUnique = async () => ({ id: "admin", isActive: true, companyId: "tenant", role: Role.SUPER_ADMIN });
  (prisma as any).$transaction = async (fn: any) => fn(prisma);
  globalThis.fetch = (async (input: any, options: any) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com") { if (options.body.get("grant_type") === "refresh_token") refreshed++; return Response.json({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600, scope: "https://www.googleapis.com/auth/adsense.readonly" }); }
    if (url.pathname === "/v2/accounts") return Response.json({ accounts: [{ name: "accounts/pub-123", timeZone: { id: "Asia/Kolkata" } }] });
    if (url.pathname.endsWith("/sites")) return Response.json({ sites: siteAccess ? [{ domain: "trikonet.com", reportingDimensionId: "trikonet-id" }, { domain: "medbiomate.com", reportingDimensionId: "medbiomate-id" }, { domain: "private.example", reportingDimensionId: "hidden" }] : [] });
    reportCalls.push(url); assert.equal(url.searchParams.get("metrics"), "PAGE_VIEWS"); assert.equal(url.searchParams.get("dimensions"), "DATE"); assert.ok(!url.toString().includes("hidden"));
    const today = day("Asia/Kolkata"); return Response.json({ headers: [{ name: "DATE" }, { name: "PAGE_VIEWS" }], totalMatchedRows: "1", rows: [{ cells: [{ value: today }, { value: String(count) }] }] });
  }) as any;
  try {
    const u = { id: "admin", role: Role.SUPER_ADMIN, companyId: "tenant", email: "admin@example.test" };
    const url = new URL((await begin(u)).url); assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/adsense.readonly"); assert.ok(url.searchParams.get("code_challenge"));
    await callback(url.searchParams.get("state")!, "auth-code");
    await assert.rejects(callback(url.searchParams.get("state")!, "auth-code"), /expired/);
    assert.equal((await report("tenant", "medbiomate.com")).connected, false);
    const originalTrikonetGeneration = database.get(key("tenant", CONNECTION + ":trikonet.com")).value.generation;
    const secondUrl = new URL((await begin(u, "medbiomate.com")).url);
    assert.equal(secondUrl.searchParams.get("prompt"), "consent select_account");
    await callback(secondUrl.searchParams.get("state")!, "second-auth-code");
    assert.equal(database.get(key("tenant", CONNECTION + ":trikonet.com")).value.generation, originalTrikonetGeneration, "Connecting Medbiomate must not replace Trikonet");
    const saved = database.get(key("tenant", CONNECTION + ":trikonet.com")); assert.notEqual(saved.value.refresh, "test-refresh"); saved.value.expires = 0;
    await sync("tenant"); assert.equal(refreshed, 1); assert.equal(reportCalls.length, 2);
    const initial = await report("tenant", "trikonet.com"); assert.equal(initial.todayViews, 40); assert.ok(initial.lastSyncAt); assert.equal(initial.rows.length, 30);
    const serialized = JSON.stringify(initial); for (const secret of ["test-access", "test-refresh", "accounts/pub-123", "private.example", "siteId"]) assert.ok(!serialized.includes(secret));
    const size = database.size; count = 82; await sync("tenant"); assert.equal(database.size, size); assert.equal((await report("tenant", "trikonet.com")).todayViews, 82);
    assert.equal((await report("other-tenant", "trikonet.com")).connected, false);
    siteAccess = false; await assert.rejects(sync("tenant"), /Neither/); assert.equal((await report("tenant", "trikonet.com")).todayViews, 82);
    const existingTrikonet = database.get(key("tenant", CONNECTION + ":trikonet.com"));
    database.set(key("tenant", CONNECTION), { ...existingTrikonet, id: key("tenant", CONNECTION), key: CONNECTION });
    database.delete(key("tenant", CONNECTION + ":trikonet.com"));
    assert.equal((await report("tenant", "trikonet.com")).todayViews, 82, "Existing shared connections and historical rows must remain readable");
    await disconnect("tenant", "trikonet.com");
    assert.equal((await report("tenant", "medbiomate.com")).connected, true, "Disconnecting Trikonet must preserve Medbiomate");
    assert.equal((await report("tenant", "medbiomate.com")).todayViews, 82);
    await disconnect("tenant", "medbiomate.com"); assert.equal((await report("tenant", "trikonet.com")).todayViews, null); await assert.rejects(sync("tenant"), /Connect/);
  } finally { Object.assign(db, { findUnique: originals.unique, findFirst: originals.first, findMany: originals.many, upsert: originals.upsert, create: originals.create, update: originals.update, deleteMany: originals.deleteMany }); prisma.user.findUnique = originals.user; prisma.$transaction = originals.transaction; globalThis.fetch = originals.fetch; await prisma.$disconnect(); }
});

test("snapshot checkpoints respect local time, missing history and highest two-hour increase", () => {
  assert.equal(snapshotHour("Asia/Kolkata", new Date("2026-10-30T04:30:00Z")), 10);
  assert.equal(snapshotHour("Asia/Kolkata", new Date("2026-10-30T04:59:59Z")), 10);
  assert.equal(snapshotHour("Asia/Kolkata", new Date("2026-10-30T05:00:00Z")), null);
  assert.equal(snapshotHour("Asia/Kolkata", new Date("2026-10-30T03:30:00Z")), null);
  const row = (date: string, hour: number, pageViews: number) => ({date, hour, pageViews, capturedAt: date + "T10:00:00Z"});
  const result = compareSnapshots("2026-10-30", [row("2026-10-30",10,100), row("2026-10-30",12,160), row("2026-10-30",14,300), row("2026-10-29",10,80), row("2026-10-29",12,0)]);
  assert.equal(result[0].difference,20); assert.equal(result[0].percent,25);
  assert.equal(result[1].percent,null); assert.equal(result[1].increase,60);
  assert.equal(result[2].highest,true); assert.equal(result[2].increase,140);
  assert.equal(result[2].difference,null); assert.equal(result[3].increase,null);
  assert.equal(compareSnapshots("2026-10-30", []).some(r=>r.highest),false);
});

test("month comparisons match elapsed days and do not treat missing records as zero", () => {
  assert.deepEqual(comparisonMonths("2026-10-01", "2026-10-15"), { start: "2026-10-01", end: "2026-10-15", previousStart: "2026-09-01", previousEnd: "2026-09-15" });
  assert.equal(comparisonMonths("2024-03-01", "2024-03-31").previousEnd, "2024-02-29");
  assert.equal(comparisonMonths("2026-01-01", "2026-10-30").previousStart, "2025-12-01");
  const values = new Map([["2026-10-01", 10], ["2026-10-02", 20]]);
  assert.equal(summarizeViews("2026-10-01", "2026-10-03", values).total, null);
  const complete = summarizeViews("2026-10-01", "2026-10-02", values);
  assert.equal(complete.total, 30); assert.deepEqual(complete.highestDates, ["2026-10-02"]);
});
