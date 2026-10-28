import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { workTrackService } from '../src/modules/work-track/work-track.service.js';
test('sheet writes acquire the shared transaction lock before reading and preserve independent rows', async () => {
  const transaction = prisma.$transaction;
  const calls: string[] = [];
  let collection: any = {};
  const settings = new Map<string, any>();
  (prisma as any).$transaction = async (fn: any, options: any) => {
    assert.equal(options.isolationLevel, 'ReadCommitted');
    let locked = false;
    const tx = {
      company: { findFirst: async () => ({ id: 'canonical' }) },
      companySetting: {
        upsert: async ({ where, create, update }: any) => {
          const { companyId, key } = where.companyId_key;
          if (key === 'worktrack_sheet_write_lock_v1') { locked = true; calls.push('lock'); return {}; }
          assert.ok(locked, 'Write must hold shared lock');
          collection = update.value;
          settings.set(companyId, { companyId, value: collection });
          calls.push('write'); return {};
        },
        findMany: async () => {
          assert.ok(locked, 'Snapshot read must occur after shared lock');
          calls.push('read'); return [...settings.values()];
        }
      }
    };
    return fn(tx);
  };
  try {
    const key = '__INDIVIDUAL_SHEET_ENTRIES__:2026-10-28:employee';
    const row = (id: string) => ({ notes: id, sourceUrl: `https://${id}.example`, category: 'Medbiomate', status: 'Assigned', count: 1, updatedAt: '2026-10-28T06:00:00Z' });
    await workTrackService.upsertDataEntrySheets('one', { [key]: [row('first')] });
    // The second user had a stale/empty snapshot and must retain the first link.
    await workTrackService.upsertDataEntrySheets('two', { [key]: [row('second')] }, [], [], {});
    assert.deepEqual(collection[key].map((row: any) => row.notes), ['first', 'second']);
    assert.equal(collection.__COMPANY_MASTER_SHEET_ENTRIES__, undefined);
    assert.equal(calls[0], 'lock');
  } finally {
    prisma.$transaction = transaction;
    await prisma.$disconnect();
  }
});
