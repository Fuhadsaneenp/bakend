import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { ensureBiometricSyncSchema } from "./lib/biometricDeviceSync.js";
import { ensureShiftSchema } from "./lib/ensureShiftSchema.js";

export const app = createApp();

async function start() {
  const port = process.env.PORT || env.PORT || 4000;

  if (typeof port === "number" || (typeof port === "string" && /^\d+$/.test(port))) {
    app.listen(Number(port), "0.0.0.0", () => {
      console.log(`HR SaaS API listening on port ${port}`);
    });
  } else {
    app.listen(port, () => {
      console.log(`HR SaaS API listening on socket ${port}`);
    });
  }

  try {
    void Promise.allSettled([
      ensureBiometricSyncSchema(),
      ensureShiftSchema()
    ]).then((results) => {
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const taskName = index === 0 ? "ensureBiometricSyncSchema" : "ensureShiftSchema";
          console.warn(`${taskName} warning after startup:`, result.reason);
        }
      });
    });
  } catch (err) {
    console.warn("Background schema sync skipped:", err);
  }
}

start().catch((error) => {
  console.error("Server start error:", error);
});
