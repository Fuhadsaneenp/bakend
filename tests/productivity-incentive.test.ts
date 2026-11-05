import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, defaultPolicy, localDay, localMinute, actualExtraMinutes, sourceIdentity, canonicalUrl, policySchema, type Verification } from "../src/modules/productivity-incentive/domain.js";
const date = (time: string) => new Date(`2026-11-05T${time}:00+05:30`);
const attendance = { checkInAt: date("09:00"), checkOutAt: date("23:00") };
const verification = (start: string, end: string): Verification => ({ start: date(start).toISOString(), end: date(end).toISOString(), evidence: "Work session evidence", verifiedBy: "hr", verifiedAt: date("23:00").toISOString() });

test("default productivity formula and four IST time bands use credited minutes", () => {
  for (const [start, end, percent] of [["17:30", "18:00", 10], ["18:00", "18:30", 15], ["18:30", "19:30", 20], ["19:30", "20:00", 25]] as const) {
    const job = calculate(defaultPolicy, "job", "2026-11-05", date(end), 120, verification(start, end), attendance);
    assert.equal(job.standardMinutes, 2); assert.equal(job.creditedMinutes, 2); assert.equal(job.weightedPercent, percent); assert.equal(job.estimatedCents, Math.round(400 * percent / 100));
    const employer = calculate(defaultPolicy, "company", "2026-11-05", date(end), 120, verification(start, end), attendance);
    assert.equal(employer.standardMinutes, 7); assert.equal(employer.estimatedCents, Math.round(1400 * percent / 100));
  }
  assert.equal(10 * defaultPolicy.jobMinutes + 2 * defaultPolicy.employerMinutes, 34);
});
test("cross-band work is apportioned; submission time never supplies a work interval", () => {
  const result = calculate(defaultPolicy, "job", "2026-11-05", date("18:10"), 120, verification("17:50", "18:10"), attendance);
  assert.deepEqual(result.allocations, [{ minutes: 1, percent: 10 }, { minutes: 1, percent: 15 }]);
  assert.equal(result.estimatedCents, 50);
  const earlier = calculate(defaultPolicy, "job", "2026-11-05", date("17:35"), 120, verification("17:25", "17:35"), attendance);
  assert.equal(earlier.creditedMinutes, 1); assert.equal(earlier.estimatedCents, 20);
  assert.equal(calculate(defaultPolicy, "job", "2026-11-05", date("20:00"), 120, null, attendance).issue, "VERIFIED_INTERVAL_REQUIRED");
});
test("missing rates, incomplete punches, outside attendance and future intervals never create payable estimates", () => {
  assert.equal(calculate(defaultPolicy, "job", "2026-11-05", date("18:00"), null, verification("17:30", "18:00"), attendance).issue, "HOURLY_RATE_NOT_CONFIGURED");
  assert.equal(calculate(defaultPolicy, "job", "2026-11-05", date("18:00"), 120, verification("17:30", "18:00"), { ...attendance, checkOutAt: null }).estimatedCents, 0);
  assert.equal(calculate(defaultPolicy, "job", "2026-11-05", date("18:00"), 120, verification("08:30", "18:00"), attendance).issue, "INTERVAL_OUTSIDE_ATTENDANCE");
  assert.equal(calculate(defaultPolicy, "job", "2026-11-05", date("18:00"), 120, verification("17:30", "18:01"), attendance).issue, "INVALID_WORK_INTERVAL");
  assert.equal(actualExtraMinutes("2026-11-05", attendance), 330);
  assert.equal(actualExtraMinutes("2026-11-05", { checkInAt: date("18:00"), checkOutAt: date("18:20") }), 20);
  assert.equal(actualExtraMinutes("2026-11-05", { checkInAt: date("09:00"), checkOutAt: null }), null);
  assert.equal(localDay("2026-11-04T20:00:00Z"), "2026-11-05"); assert.equal(localMinute(date("17:30")), 1050);
});
test("all three websites have portal-scoped stable identities and aliases do not multiply credits", () => {
  for (const site of ["medbiomate", "trikonet", "mediyox"]) {
    assert.equal(sourceIdentity({ site, type: "job", postId: 42, url: `https://${site}.com/jobs/a/` }), `${site}:job:42`);
    assert.equal(sourceIdentity({ site, type: "company", postId: 42, url: `https://${site}.com/employer/a/` }), `${site}:company:42`);
  }
  assert.equal(sourceIdentity({ site: "trikonet", type: "job", postId: 42, url: "https://evil.test/job" }), null);
  assert.equal(canonicalUrl("https://www.trikonet.com/jobs/a/?utm_campaign=test#top"), canonicalUrl("http://trikonet.com/jobs/a"));
  assert.notEqual(canonicalUrl("https://mediyox.com/?p=1"), canonicalUrl("https://mediyox.com/?p=2"));
});
test("policies reject overlapping/gapped brackets and invalid salary divisors", () => {
  assert.throws(() => policySchema.parse({ ...defaultPolicy, monthlyHoursDivisor: 0 }));
  assert.throws(() => policySchema.parse({ ...defaultPolicy, bands: [{ start: 1050, end: 1080, percent: 10 }, { start: 1070, end: 1440, percent: 15 }] }));
  assert.throws(() => policySchema.parse({ ...defaultPolicy, bands: [{ start: 1050, end: 1080, percent: 10 }, { start: 1090, end: 1440, percent: 15 }] }));
});
