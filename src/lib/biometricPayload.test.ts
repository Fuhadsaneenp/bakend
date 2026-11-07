import assert from "node:assert/strict";
import test from "node:test";
import { getBiometricDataPayload } from "./biometricPayload.js";

test("polling and empty uploads create no data payload", () => {
  for (const request of [
    { method: "GET", body: {} },
    { method: "HEAD", body: "metadata" },
    { method: "POST", rawBody: "", body: { ignoredFallback: true } },
    { method: "POST", body: Buffer.alloc(0) },
    { method: "POST", body: " \r\n\t " },
    { method: "POST", body: {} },
    { method: "POST", body: [] },
    { method: "POST", body: " { \n } " },
    { method: "POST", body: "[ ]" },
    { method: "POST", body: "null" },
  ]) assert.equal(getBiometricDataPayload(request), "");
});

test("device uploads and acknowledgements retain their original contents", () => {
  for (const payload of [
    "123\t2026-10-06 09:00:00\t0\t1\r\n",
    "ID=20&Return=0&CMD=DATA QUERY",
    "USER PIN=123\tName=Example\r\n",
    "{\"punches\":[{\"id\":123}]}",
    "malformed upload requiring review",
  ]) {
    assert.equal(getBiometricDataPayload({ method: "POST", rawBody: payload, body: {} }), payload);
    assert.equal(getBiometricDataPayload({ method: "POST", body: Buffer.from(payload) }), payload);
  }
});
