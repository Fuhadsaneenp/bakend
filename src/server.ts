import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { ensureBiometricSyncSchema } from "./lib/biometricDeviceSync.js";
import { ensureShiftSchema } from "./lib/ensureShiftSchema.js";

async function start() {
  const app = createApp();

  if (typeof env.PORT === "number" || (typeof env.PORT === "string" && /^\d+$/.test(env.PORT))) {
    app.listen(Number(env.PORT), "0.0.0.0", () => {
      console.log(`HR SaaS API listening on port ${env.PORT}`);
    });
  } else {
    app.listen(env.PORT, () => {
      console.log(`HR SaaS API listening on socket ${env.PORT}`);
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
