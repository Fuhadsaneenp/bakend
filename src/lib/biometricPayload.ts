type BiometricBody = { method?: string; rawBody?: string; body?: unknown };

/** Return original device data, never a synthetic empty body from Express. */
export function getBiometricDataPayload(req: BiometricBody): string {
  if (req.method === "GET" || req.method === "HEAD") return "";
  let payload = "";
  if (typeof req.rawBody === "string") payload = req.rawBody;
  else if (Buffer.isBuffer(req.body)) payload = req.body.toString("utf8");
  else if (typeof req.body === "string") payload = req.body;
  else if (req.body && typeof req.body === "object") {
    try { payload = JSON.stringify(req.body); } catch { return ""; }
  }
  const content = payload.trim();
  if (!content || /^(?:\{\s*\}|\[\s*\]|null)$/.test(content)) return "";
  // Preserve even malformed non-empty uploads for diagnosis and retry.
  return payload;
}
