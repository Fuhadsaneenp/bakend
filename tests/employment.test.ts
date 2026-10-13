import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasExited, isActiveEmployee, employedDuring, EXIT_REASONS } from '../src/lib/employment.ts';
import * as frontend from '../../frontend/src/lib/employment.ts';

for (const reason of EXIT_REASONS) {
  test(`${reason}: last day inclusive, exit month and prior reports retained`, () => {
    const scheduled = { status: 'ACTIVE', dateOfJoining: '2026-01-10', dateOfExit: '2026-10-13', exitReason: reason };
    assert.equal(isActiveEmployee(scheduled, '2026-10-13'), true);
    assert.equal(isActiveEmployee(scheduled, new Date('2026-10-13T18:30:00Z')), false);
    const exited = { ...scheduled, status: reason === 'Terminated' ? 'TERMINATED' : 'INACTIVE', user: { isActive: false } };
    assert.equal(hasExited(exited, '2026-10-14'), true);
    assert.equal(employedDuring(exited, '2026-09-01', '2026-09-30'), true);
    assert.equal(employedDuring(exited, '2026-10-01', '2026-10-31'), true);
    assert.equal(employedDuring(exited, '2026-11-01', '2026-11-30'), false);
    assert.equal(employedDuring(exited, '2025-12-01', '2025-12-31'), false);
    assert.equal(employedDuring(exited, '2026-10-14', '2026-10-14'), false);
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-14']) {
      assert.equal(frontend.isActiveEmployee(scheduled, day), isActiveEmployee(scheduled, day));
      assert.equal(frontend.hasExited(exited, day), hasExited(exited, day));
    }
  });
}
test('legacy termination and inactivity remain distinct; disabled user does not erase historical employment', () => {
  assert.equal(hasExited({ status: 'TERMINATED' }), true);
  assert.equal(isActiveEmployee({ status: 'INACTIVE' }), false);
  assert.equal(hasExited({ status: 'INACTIVE' }), false);
  assert.equal(employedDuring({ status: 'ACTIVE', user: { isActive: false }, dateOfJoining: '2026-01-01' }, '2026-02-01', '2026-02-28'), true);
});
