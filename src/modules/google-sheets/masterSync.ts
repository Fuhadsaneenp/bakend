import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { workTrackService } from "../work-track/work-track.service.js";
import { authorize, google, read, write } from "./sheets.service.js";
const MASTER = "__COMPANY_MASTER_SHEET_ENTRIES__",
  BASE = "google_sheets_master_baseline_v1";
const HEADER = [
  "Date",
  "Source URL",
  "Platform",
  "Assigned To",
  "Assignment Status",
  "Upload Status",
  "Task ID",
  "Updated At",
];
const running = new Set<string>();
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function dateKey(value: string, fallback: string) {
  if (!value) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  throw new ApiError(409, "Use YYYY-MM-DD or DD/MM/YYYY in the Date column");
}
/** Three-way merge: independent field edits merge; conflicting fields retain STEMS values. */
export function mergeCells(app: string[], sheet: string[], before?: string[]) {
  return app.map((value, i) =>
    !before
      ? (sheet[i] ?? value)
      : sheet[i] !== before[i] && value === before[i]
        ? sheet[i]
        : value,
  );
}
export async function enableMasterSync(user: AuthUser) {
  const cid = authorize(user),
    c = await read(cid);
  if (!c?.spreadsheetId || !c.worksheetTitle)
    throw new ApiError(409, "Select a spreadsheet first");
  await syncMaster(cid, true);
  const latest = await read(cid);
  await write(cid, {
    ...latest!,
    direction: "two-way",
    syncEnabled: true,
    syncError: undefined,
  });
  return { enabled: true };
}
export async function syncMaster(cid: string, initial = false) {
  if (running.has(cid)) throw new ApiError(409, "Sync is already running");
  running.add(cid);
  const leaseKey = "google_sheets_master_sync_lease_v1",
    expires = new Date(Date.now() + 180000);
  let leased = false;
  try {
    await prisma.companySetting.createMany({
      data: [
        { companyId: cid, key: leaseKey, value: {}, updatedAt: new Date(0) },
      ],
      skipDuplicates: true,
    });
    leased =
      (
        await prisma.companySetting.updateMany({
          where: {
            companyId: cid,
            key: leaseKey,
            updatedAt: { lt: new Date() },
          },
          data: { updatedAt: expires },
        })
      ).count === 1;
    if (!leased)
      throw new ApiError(409, "Sync is already running on another worker");
    const c = await read(cid);
    if (!c?.spreadsheetId || !c.worksheetTitle || (!initial && !c.syncEnabled))
      return;
    const scope = `${c.spreadsheetId}:${c.worksheetId}`;
    const range = `'${c.worksheetTitle.replace(/'/g, "''")}'!A2:H`;
    const get = async () =>
      (await google(
        cid,
        `${c.spreadsheetId}/values/${encodeURIComponent(range)}`,
      )) as { values?: string[][] };
    const response = await get(),
      grid = response.values || [];
    if (!HEADER.every((h, i) => grid[0]?.[i] === h))
      throw new ApiError(
        409,
        "Master worksheet needs Date, Source URL, Platform, Assigned To, Assignment Status, Upload Status, Task ID, Updated At in row 2",
      );
    if (grid.length >= 9999)
      throw new ApiError(409, "Master Sheet exceeds the sync row limit");
    const originalHash = digest(grid),
      now = new Date().toISOString(),
      today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
    const saved = await prisma.companySetting.findUnique({
      where: { companyId_key: { companyId: cid, key: BASE } },
    });
    const state = saved?.value as any;
    const baseline: Record<string, string[]> =
      state?.scope === scope ? state.rows : {};
    const all = await workTrackService.getDataEntrySheets(cid, true),
      appRows = all[MASTER] || [];
    const employees = await prisma.employee.findMany({
      where: { companyId: cid },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        displayName: true,
      },
    });
    const resolveEmployee = (name: string) => {
      if (!name) return "";
      const matches = employees.filter((e) =>
        [
          e.id,
          e.displayName,
          [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" "),
        ].some((v) => v?.trim().toLowerCase() === name.trim().toLowerCase()),
      );
      if (matches.length !== 1)
        throw new ApiError(409, `Assigned To must match one employee: ${name}`);
      return matches[0].id;
    };
    const canonical = (cells: string[]) => [
      dateKey(cells[0] || "", today),
      cells[1]?.trim() || "",
      cells[2] || "Medbiomate",
      resolveEmployee(cells[3] || ""),
      cells[4] || "Not Assigned",
      cells[5] || "Not Uploaded",
    ];
    const fromApp = (r: any) => [
      r.date || today,
      r.sourceUrl || "",
      r.category || "Medbiomate",
      r.companyName || "",
      r.status || "Not Assigned",
      r.uploadStatus || "Not Uploaded",
    ];
    const byId = new Map(
      appRows.filter((r: any) => r.notes).map((r: any) => [r.notes, r]),
    );
    const seen = new Set<string>(),
      changes: any[] = [],
      updates: any[] = [],
      nextBaseline = { ...baseline };
    const deleted = new Set(
      (all.__DELETED_MASTER_SHEET_ENTRIES__ || []).map((r: any) => r.notes),
    );
    let appended = grid.length + 2;
    const stage = (
      id: string,
      cells: string[],
      sheetRow: number,
      old: any,
      raw?: string[],
    ) => {
      if (
        !["Medbiomate", "Trikonet", "Mediyox"].includes(cells[2]) ||
        !["Assigned", "Not Assigned"].includes(cells[4]) ||
        !["Uploaded", "Not Uploaded"].includes(cells[5])
      )
        throw new ApiError(
          409,
          `Invalid platform or status at sheet row ${sheetRow}`,
        );
      if (cells[4] === "Assigned" && !cells[3])
        throw new ApiError(
          409,
          `Select an employee for assigned row ${sheetRow}`,
        );
      const changed = !old || digest(fromApp(old)) !== digest(cells);
      const stamp = changed ? now : old.updatedAt || now;
      if (changed)
        changes.push({
          ...old,
          count: 1,
          date: cells[0],
          sourceUrl: cells[1],
          category: cells[2],
          companyName: cells[3],
          employeeName:
            employees.find((e) => e.id === cells[3])?.displayName ||
            employees
              .filter((e) => e.id === cells[3])
              .map((e) =>
                [e.firstName, e.middleName, e.lastName]
                  .filter(Boolean)
                  .join(" "),
              )[0] ||
            "",
          status: cells[4],
          uploadStatus: cells[5],
          notes: id,
          updatedAt: stamp,
        });
      const display = [
        Date.parse(cells[0] + "T00:00:00Z") / 86400000 + 25569,
        cells[1],
        cells[2],
        cells[3]
          ? employees.find((e) => e.id === cells[3])?.displayName ||
            employees
              .filter((e) => e.id === cells[3])
              .map((e) =>
                [e.firstName, e.middleName, e.lastName]
                  .filter(Boolean)
                  .join(" "),
              )[0]
          : "",
        cells[4],
        cells[5],
        id,
        stamp,
      ];
      if (
        !raw ||
        digest([...canonical(raw), raw[6], raw[7]]) !==
          digest([...cells, id, stamp])
      )
        updates.push({
          range: `'${c.worksheetTitle!.replace(/'/g, "''")}'!A${sheetRow}:H${sheetRow}`,
          values: [display],
        });
      nextBaseline[id] = cells;
    };
    for (let i = 1; i < grid.length; i++) {
      const raw = Array.from({ length: 8 }, (_, j) => String(grid[i][j] ?? ""));
      if (!raw[1].trim()) continue;
      const id = raw[6] || "google-master:" + randomUUID();
      if (seen.has(id))
        throw new ApiError(409, `Duplicate Task ID at row ${i + 2}`);
      seen.add(id);
      if (deleted.has(id)) continue;
      const cells = canonical(raw),
        old = byId.get(id);
      stage(
        id,
        old ? mergeCells(fromApp(old), cells, baseline[id]) : cells,
        i + 2,
        old,
        raw,
      );
    }
    for (const [id, row] of byId)
      if (!seen.has(id) && row.sourceUrl?.trim())
        stage(id, fromApp(row), appended++, row);
    const currentConnection = await read(cid);
    if (
      currentConnection?.spreadsheetId !== c.spreadsheetId ||
      currentConnection?.worksheetId !== c.worksheetId
    )
      throw new ApiError(409, "Google connection changed during sync");
    if (digest((await get()).values || []) !== originalHash)
      throw new ApiError(
        409,
        "Google Sheet changed during sync; retrying next cycle",
      );
    // Write only managed row cells; preserve the date selector, headers and other worksheets.
    if (updates.length)
      await google(cid, `${c.spreadsheetId}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data: updates }),
      });
    if (changes.length)
      await workTrackService.upsertDataEntrySheets(cid, { [MASTER]: changes });
    await prisma.companySetting.upsert({
      where: { companyId_key: { companyId: cid, key: BASE } },
      create: {
        companyId: cid,
        key: BASE,
        value: { scope, rows: nextBaseline },
      },
      update: { value: { scope, rows: nextBaseline } },
    });
    const latest = await read(cid);
    if (latest?.spreadsheetId === c.spreadsheetId)
      await write(cid, { ...latest, lastSyncAt: now, syncError: undefined });
  } catch (error) {
    const c = await read(cid);
    if (c)
      await write(cid, {
        ...c,
        syncError:
          error instanceof Error ? error.message : "Google sync failed",
      });
    throw error;
  } finally {
    if (leased)
      await prisma.companySetting.updateMany({
        where: { companyId: cid, key: leaseKey, updatedAt: expires },
        data: { updatedAt: new Date(0) },
      });
    running.delete(cid);
  }
}
export function startMasterSheetSync() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const connections = await prisma.companySetting.findMany({
        where: { key: "google_sheets_connection_v1" },
        select: { companyId: true, value: true },
      });
      for (const c of connections)
        if ((c.value as any)?.syncEnabled)
          await syncMaster(c.companyId).catch(() => {});
    } finally {
      busy = false;
    }
  };
  setInterval(() => void tick().catch(() => {}), 30000).unref();
  void tick().catch(() => {});
}
