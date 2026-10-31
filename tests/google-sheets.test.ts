import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import { seal } from "../src/modules/seo/seo.domain.js";
import * as sheets from "../src/modules/google-sheets/sheets.service.js";
const user = {
  id: "admin",
  companyId: "one",
  role: "SUPER_ADMIN",
  email: "admin@example.test",
} as any;
test("spreadsheet URL validation accepts Google files and blocks arbitrary destinations", () => {
  const id = "1234567890abcdefghijklmnop";
  assert.equal(
    sheets.spreadsheetId(
      "https://docs.google.com/spreadsheets/d/" + id + "/edit#gid=0",
    ),
    id,
  );
  assert.equal(sheets.spreadsheetId(id), id);
  for (const url of [
    "https://evil.example/spreadsheets/d/" + id,
    "http://docs.google.com/spreadsheets/d/" + id,
    "https://docs.google.com.evil.test/spreadsheets/d/" + id,
    "file:///etc/passwd",
  ])
    assert.throws(() => sheets.spreadsheetId(url));
  assert.throws(
    () => sheets.authorize({ ...user, role: "EMPLOYEE" }),
    /administrator/,
  );
  assert.throws(
    () => sheets.authorize({ ...user, impersonatedBy: { id: "other" } }),
    /administrator/,
  );
});
test("OAuth is scoped, one-use, encrypted; metadata and selection stay tenant bound without enabling sync", async () => {
  process.env.SEO_GOOGLE_CLIENT_ID = "test-client";
  process.env.SEO_GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.SEO_GOOGLE_REDIRECT_URI =
    "https://api.example.test/api/seo/google/callback";
  process.env.SEO_TOKEN_KEY = "ab".repeat(32);
  const setting = prisma.companySetting as any,
    userModel = prisma.user as any;
  const originals = {
    findUnique: setting.findUnique,
    findFirst: setting.findFirst,
    create: setting.create,
    upsert: setting.upsert,
    deleteMany: setting.deleteMany,
    userFind: userModel.findUnique,
    fetch: global.fetch,
  };
  const data = new Map<string, any>();
  let writes = 0;
  setting.create = async ({ data: d }: any) => {
    const record = { ...d, id: d.key };
    data.set(d.companyId + ":" + d.key, record);
    return record;
  };
  setting.findUnique = async ({ where }: any) =>
    data.get(where.companyId_key.companyId + ":" + where.companyId_key.key) ||
    null;
  setting.findFirst = async ({ where }: any) =>
    [...data.values()].find((r) => r.key === where.key) || null;
  setting.deleteMany = async ({ where }: any) => {
    let count = 0;
    for (const [key, record] of data) {
      if (
        where.id
          ? record.id === where.id
          : record.companyId === where.companyId && record.key === where.key
      ) {
        data.delete(key);
        count++;
      }
    }
    return { count };
  };
  setting.upsert = async ({ where, create, update }: any) => {
    const key = where.companyId_key.companyId + ":" + where.companyId_key.key;
    data.set(key, { ...(data.get(key) || create), ...update });
    return data.get(key);
  };
  userModel.findUnique = async () => ({ ...user, isActive: true });
  global.fetch = async (input: any, options: any) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token")
      return new Response(
        JSON.stringify({
          access_token: "google-access",
          refresh_token: "google-refresh",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/spreadsheets",
        }),
      );
    assert.ok(url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/"));
    assert.equal(options.headers.Authorization, "Bearer google-access");
    if (options.method && options.method !== "GET") writes++;
    return new Response(
      JSON.stringify({
        properties: { title: "Data Entry" },
        sheets: [{ properties: { sheetId: 0, title: "Jobs" } }],
      }),
    );
  };
  try {
    const auth = await sheets.begin(user);
    const url = new URL(auth.url);
    assert.equal(
      url.searchParams.get("scope"),
      "https://www.googleapis.com/auth/spreadsheets",
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const state = url.searchParams.get("state")!;
    await sheets.callback(state, "code");
    await assert.rejects(sheets.callback(state, "code"), /expired/);
    const status = await sheets.status(user);
    assert.ok(status.connected);
    assert.equal(status.syncEnabled, false);
    assert.ok(!JSON.stringify(status).includes("google-refresh"));
    assert.ok(!JSON.stringify(status).includes("google-access"));
    assert.equal(
      (await sheets.status({ ...user, companyId: "two" })).connected,
      false,
    );
    const metadata = await sheets.inspect(user, "1234567890abcdefghijklmnop");
    assert.equal(metadata.worksheets[0].id, 0);
    await assert.rejects(
      sheets.select(user, metadata.spreadsheetId, 7, "two-way"),
      /Choose a worksheet/,
    );
    const selected = await sheets.select(
      user,
      metadata.spreadsheetId,
      0,
      "two-way",
    );
    assert.equal(selected.worksheetTitle, "Jobs");
    assert.equal(selected.syncEnabled, false);
    assert.equal(writes, 0);
    const stored = data.get("one:google_sheets_connection_v1").value;
    assert.notEqual(stored.refreshCipher, "google-refresh");
    await sheets.disconnect(user);
    assert.equal((await sheets.status(user)).connected, false);
  } finally {
    Object.assign(setting, {
      findUnique: originals.findUnique,
      findFirst: originals.findFirst,
      create: originals.create,
      upsert: originals.upsert,
      deleteMany: originals.deleteMany,
    });
    userModel.findUnique = originals.userFind;
    global.fetch = originals.fetch;
    await prisma.$disconnect();
  }
});
