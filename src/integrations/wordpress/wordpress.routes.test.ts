import test from "node:test";
import assert from "node:assert/strict";
import { wordpressRouter } from "./wordpress.routes.js";
import { prisma } from "../../lib/prisma.js";

test("WordPress authentication, attribution, tenant binding and stable upload identity", async () => {
  const originalSites = process.env.WORDPRESS_SYNC_SITES;
  const originalFind = prisma.user.findFirst;
  const originalUpsert = prisma.companySetting.upsert;
  const secret = "test-secret-32-characters-long-enough";
  process.env.WORDPRESS_SYNC_SITES = JSON.stringify({ med: { secret, companyId: "tenant-a", brand: "Medbiomate", url: "https://jobs.example.com" } });
  const writes: any[] = [];
  let matched = true;
  (prisma.user as any).findFirst = async (query: any) => {
    assert.equal(query.where.companyId, "tenant-a");
    assert.equal(query.where.email, "staff@example.com");
    return matched ? { employee: { id: "employee-a", companyId: "tenant-a", firstName: "Staff", lastName: "Member" } } : null;
  };
  (prisma.companySetting as any).upsert = async (query: any) => { writes.push(query); return query.create; };
  const layer = wordpressRouter.stack.find((item: any) => item.route?.path === "/:site/uploads");
  assert.ok(layer?.route);
  const handler = layer.route.stack[0].handle as (...args: any[]) => Promise<void>;
  const payload = { postId: 42, type: "job", uploaderEmail: "STAFF@example.com", uploaderId: 7,
    title: "Nurse", url: "https://jobs.example.com/job/nurse", companyName: "Hospital", companyUrl: "",
    categories: ["Nursing"], location: "Kochi", status: "publish", uploadedAt: "2026-09-12T07:00:00Z", updatedAt: "2026-09-12T07:00:00Z" };
  const send = async (token = secret, body = payload) => {
    let error: any; let result: any;
    await handler({ params: { site: "med" }, body, get: () => `Bearer ${token}` }, { json: (value: any) => { result = value; } }, (value: any) => { error = value; });
    return { error, result };
  };
  try {
    assert.ok((await send("wrong")).error);
    assert.equal(writes.length, 0);
    assert.ok((await send(secret, { ...payload, url: "https://other.example/job" })).error);
    matched = false;
    assert.ok((await send()).error);
    assert.equal(writes.length, 0);
    matched = true;
    assert.deepEqual((await send()).result, { synced: true });
    await send(secret, { ...payload, title: "Updated nurse" });
    assert.equal(writes[0].where.companyId_key.key, writes[1].where.companyId_key.key);
    assert.equal(writes[0].create.companyId, "tenant-a");
    assert.equal(writes[0].create.value.employeeId, "employee-a");
    assert.equal(writes[1].update.value.title, "Updated nurse");
  } finally {
    prisma.user.findFirst = originalFind;
    prisma.companySetting.upsert = originalUpsert;
    if (originalSites === undefined) delete process.env.WORDPRESS_SYNC_SITES;
    else process.env.WORDPRESS_SYNC_SITES = originalSites;
  }
});
