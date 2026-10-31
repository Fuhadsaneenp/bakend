import test from "node:test";
import assert from "node:assert/strict";
import {
  dateKey,
  mergeCells,
} from "../src/modules/google-sheets/masterSync.js";
test("Google dates normalize; missing date gets current work date", () => {
  assert.equal(dateKey("31/10/2026", "2026-10-30"), "2026-10-31");
  assert.equal(dateKey("", "2026-10-31"), "2026-10-31");
  assert.throws(() => dateKey("bad", "2026-10-31"));
});
test("three-way sync merges independent edits and retains current app conflicts", () => {
  assert.deepEqual(
    mergeCells(["new app", "old"], ["old", "new google"], ["old", "old"]),
    ["new app", "new google"],
  );
  assert.deepEqual(mergeCells(["app"], ["google"], ["before"]), ["app"]);
  assert.deepEqual(mergeCells(["app"], ["google"]), ["google"]);
});
import { prisma } from "../src/lib/prisma.js";
import { seal } from "../src/modules/seo/seo.domain.js";
import { workTrackService } from "../src/modules/work-track/work-track.service.js";
import { syncMaster } from "../src/modules/google-sheets/masterSync.js";
test("sync imports, exports, preserves independent edits, skips unchanged writes and refuses moved rows", async () => {
  process.env.SEO_TOKEN_KEY = "ab".repeat(32);
  const settings: any = prisma.companySetting,
    employee: any = prisma.employee;
  const originals = {
    findUnique: settings.findUnique,
    createMany: settings.createMany,
    updateMany: settings.updateMany,
    upsert: settings.upsert,
    employees: employee.findMany,
    get: workTrackService.getDataEntrySheets,
    save: workTrackService.upsertDataEntrySheets,
    fetch: global.fetch,
  };
  const db = new Map<string, any>();
  db.set("google_sheets_connection_v1", {
    spreadsheetId: "document",
    worksheetId: 1,
    worksheetTitle: "Company Master Sheet",
    syncEnabled: true,
    accessCipher: seal("token"),
    expiresAt: Date.now() + 3600000,
  });
  let grid: any[][] = [
    [
      "Date",
      "Source URL",
      "Platform",
      "Assigned To",
      "Assignment Status",
      "Upload Status",
      "Task ID",
      "Updated At",
    ],
    [
      "31/10/2026",
      "https://google.test",
      "Medbiomate",
      "",
      "Not Assigned",
      "Not Uploaded",
      "",
      "",
    ],
  ];
  let app: any[] = [
    {
      count: 1,
      sourceUrl: "https://app.test",
      category: "Trikonet",
      status: "Not Assigned",
      date: "2026-10-31",
      notes: "app-id",
      updatedAt: "2026-10-31T00:00:00Z",
    },
  ];
  let writes = 0,
    moved = false,
    reads = 0;
  settings.findUnique = async (q: any) => ({
    value: db.get(q.where.companyId_key.key),
  });
  settings.createMany = async () => ({ count: 0 });
  settings.updateMany = async () => ({ count: 1 });
  settings.upsert = async (q: any) => {
    db.set(q.where.companyId_key.key, q.update.value);
    return {};
  };
  employee.findMany = async (query: any) => {
    assert.ok(
      query.where.OR.some((scope: any) => scope.companyId === "company"),
    );
    assert.ok(Array.isArray(query.where.OR[1].id.in));
    return [];
  };
  workTrackService.getDataEntrySheets = async () => ({
    __COMPANY_MASTER_SHEET_ENTRIES__: app,
  });
  workTrackService.upsertDataEntrySheets = async (_cid: any, s: any) => {
    for (const r of s.__COMPANY_MASTER_SHEET_ENTRIES__) {
      const i = app.findIndex((x) => x.notes === r.notes);
      if (i < 0) app.push(r);
      else app[i] = r;
    }
    return s;
  };
  global.fetch = async (_url: any, init: any) => {
    if (init?.method === "POST") {
      writes++;
      const data = JSON.parse(init.body).data;
      for (const d of data) {
        assert.match(d.range, /!A\d+:H\d+$/);
        const n = Number(d.range.match(/!A(\d+)/)[1]) - 2;
        const row = [...d.values[0]];
        row[0] = "31/10/2026";
        grid[n] = row;
      }
      return new Response("{}");
    }
    reads++;
    if (moved && reads % 2 === 0) grid[1][1] = "https://moved.test";
    return new Response(JSON.stringify({ values: grid }));
  };
  try {
    await syncMaster("company");
    assert.equal(app.length, 2);
    assert.equal(grid.length, 3);
    assert.ok(grid[1][6].startsWith("google-master:"));
    assert.equal(grid[2][6], "app-id");
    const before = writes;
    await syncMaster("company");
    assert.equal(writes, before, "Unchanged rows must not be rewritten");
    grid[1][1] = "https://new-google.test";
    app[1].uploadStatus = "Uploaded";
    await syncMaster("company");
    assert.equal(app[1].sourceUrl, "https://new-google.test");
    assert.equal(app[1].uploadStatus, "Uploaded");
    assert.equal(grid[1][5], "Uploaded");
    moved = true;
    reads = 0;
    await assert.rejects(syncMaster("company"), /changed during sync/);
    assert.match(
      db.get("google_sheets_connection_v1").syncError,
      /changed during sync/,
    );
    moved = false;
    reads = 0;
    db.set("google_sheets_connection_v1", {
      ...db.get("google_sheets_connection_v1"),
      workerSheets: { Worker: "person" },
    });
    grid = [
      grid[0],
      [
        "31/10/2026",
        "https://personal-google.test",
        "Medbiomate",
        "",
        "Not Assigned",
        "Not Uploaded",
        "",
        "",
      ],
    ];
    const assigned = {
      ...app[0],
      companyName: "person",
      notes: "assigned-task",
      status: "Assigned",
    };
    const personal = {
      ...app[0],
      companyName: "person",
      notes: "personal-task",
      sourceUrl: "https://personal-app.test",
    };
    const unrelated = {
      ...app[0],
      companyName: "other",
      notes: "other-task",
      status: "Assigned",
    };
    workTrackService.getDataEntrySheets = async () => ({
      __COMPANY_MASTER_SHEET_ENTRIES__: [assigned, unrelated],
      "__INDIVIDUAL_SHEET_ENTRIES__:2026-10-31:person": [personal],
    });
    let workerTargets: any;
    workTrackService.upsertDataEntrySheets = async (
      _cid: any,
      targets: any,
    ) => {
      workerTargets = targets;
      return targets;
    };
    await syncMaster("company", true, {
      title: "Worker",
      employeeId: "person",
    });
    assert.deepEqual(Object.keys(workerTargets), [
      "__INDIVIDUAL_SHEET_ENTRIES__:2026-10-31:person",
    ]);
    assert.equal(
      workerTargets["__INDIVIDUAL_SHEET_ENTRIES__:2026-10-31:person"][0]
        .companyName,
      "person",
    );
    assert.equal(grid.length, 4);
    assert.ok(grid.some((r) => r[6] === "assigned-task"));
    assert.ok(grid.some((r) => r[6] === "personal-task"));
    assert.ok(!grid.some((r) => r[6] === "other-task"));
  } finally {
    Object.assign(settings, {
      findUnique: originals.findUnique,
      createMany: originals.createMany,
      updateMany: originals.updateMany,
      upsert: originals.upsert,
    });
    employee.findMany = originals.employees;
    workTrackService.getDataEntrySheets = originals.get;
    workTrackService.upsertDataEntrySheets = originals.save;
    global.fetch = originals.fetch;
    await prisma.$disconnect();
  }
});
