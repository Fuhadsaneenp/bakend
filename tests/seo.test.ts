import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  seal,
  unseal,
  transition,
  period,
  keywordIdentity,
} from "../src/modules/seo/seo.domain.js";
import { publicIPv4, findBacklink } from "../src/modules/seo/seo.backlinks.js";
test("SEO credentials are authenticated ciphertext, including tamper rejection", () => {
  process.env.SEO_TOKEN_KEY = "ab".repeat(32);
  const secret = "offline-refresh-token";
  const encrypted = seal(secret);
  assert.equal(unseal(encrypted), secret);
  assert.ok(!encrypted.includes(secret));
  const [iv, tag, data] = encrypted.split(".");
  assert.throws(() =>
    unseal([iv, tag, Buffer.from("tampered").toString("base64url")].join(".")),
  );
});
test("SEO aggregates weighted positions and derives CTR from site totals", () => {
  assert.deepEqual(
    aggregate([
      { clicks: 10, impressions: 100, position: 10 },
      { clicks: 9, impressions: 900, position: 20 },
    ]),
    { clicks: 19, impressions: 1000, ctr: 0.019, position: 19 },
  );
  assert.deepEqual(aggregate([]), {
    clicks: 0,
    impressions: 0,
    ctr: null,
    position: null,
  });
});
test("Review workflow and date validation reject invalid transitions and impossible dates", () => {
  transition("SUBMITTED", "APPROVED", true);
  assert.throws(() => transition("SUBMITTED", "APPROVED", false));
  assert.throws(() => transition("APPROVED", "APPROVED", true));
  transition("REJECTED", "IN_PROGRESS", false);
  assert.throws(() => period("2026-02-30", "2026-03-01"));
  assert.throws(() => period("2026-10-22", "2026-01-01"));
  assert.equal(
    keywordIdentity(" Keyword ", "https://example.com", "usa", "mobile"),
    keywordIdentity("keyword", "https://example.com", "USA", "MOBILE"),
  );
});
test("Backlink verifier blocks private, local, metadata and IPv6 endpoints", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.0.1",
    "172.16.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicIPv4(ip), false, ip);
  assert.equal(publicIPv4("8.8.8.8"), true);
});

test("HTML verifier detects real anchors, not comments, scripts or data-href", () => {
  const source = "https://example.com/article",
    target = "https://target.example/page";
  assert.equal(
    findBacklink(
      `<a href="${target}" rel="nofollow sponsored">Link</a>`,
      source,
      target,
    ).result,
    "PRESENT",
  );
  assert.deepEqual(
    findBacklink(
      `<a href="${target}" rel="nofollow sponsored">Link</a>`,
      source,
      target,
    ).attributes,
    ["nofollow", "sponsored"],
  );
  assert.equal(
    findBacklink(
      `<!-- <a href="${target}"> --> <script>const x='<a href="${target}">'</script><div data-href="${target}">`,
      source,
      target,
    ).result,
    "INCONCLUSIVE",
  );
});
