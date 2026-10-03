import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateJobActivity } from './jobActivityIdentity.js';
const base = { jobTitle: 'Physical Therapist Assistant', companyName: 'Alumus Healthcare', uploadedBy: 'Safna C', uploadedAt: '2026-10-02T12:47:18Z' };
test('changed permalink, query URL and legacy alias resolve to one post', () => {
  const rows = [
    { ...base, sourceUrl: 'https://www.mediyox.com/jobs/assistant-60' },
    { ...base, postId: 19258, sourceUrl: 'https://www.mediyox.com/?post_type=jobs&p=19258' },
    { ...base, postId: 19258, sourceUrl: 'https://www.mediyox.com/jobs/assistant-6', updatedAt: '2026-10-02T12:48:36Z' },
  ];
  const result = deduplicateJobActivity(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceUrl, rows[2].sourceUrl);
});
test('different posts, hosts and ambiguous legacy records stay separate', () => {
  const rows = [
    {...base, postId: 1, sourceUrl: 'https://www.mediyox.com/jobs/one'},
    {...base, postId: 2, sourceUrl: 'https://www.mediyox.com/jobs/two'},
    {...base, sourceUrl: 'https://www.mediyox.com/jobs/unknown'},
    {...base, postId: 1, sourceUrl: 'https://www.trikonet.com/jobs/one'},
    {sourceUrl: 'https://careers.example.com/one'},
    {sourceUrl: 'https://careers.example.com/two'},
  ];
  assert.equal(deduplicateJobActivity(rows).length, 6);
});
