import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAssignmentSheetRows } from './assignmentSheetRows.js';
const row = (id: string, sourceUrl: string, updatedAt = '2026-10-28T06:00:00Z', status = 'Assigned') => ({ notes: id, sourceUrl, updatedAt, count: 1, status });
test('stale or reordered saves retain other users links and merge by ID', () => {
  const result = mergeAssignmentSheetRows([[row('a', 'a'), row('b', 'b')], [row('b', 'new-b', '2026-10-28T06:01:00Z'), row('c', 'c')]]);
  assert.deepEqual(result.map(r => [r.notes, r.sourceUrl]), [['a', 'a'], ['b', 'new-b'], ['c', 'c']]);
  assert.equal(mergeAssignmentSheetRows([result, [row('b', 'stale')]])[1].sourceUrl, 'new-b');
});
test('personal deletion tombstones survive delayed saves', () => {
  const deleted = row('a', 'a', '2026-10-28T06:01:00Z', 'Deleted');
  assert.equal(mergeAssignmentSheetRows([[deleted], [row('a', 'a')]])[0].status, 'Deleted');
  assert.equal(mergeAssignmentSheetRows([[deleted], [row('a', 'a', deleted.updatedAt)]])[0].status, 'Deleted');
});
