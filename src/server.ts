import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { ensureBiometricSyncSchema } from "./lib/biometricDeviceSync.js";
import { ensureShiftSchema } from "./lib/ensureShiftSchema.js";

async function start() {
  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`HR SaaS API listening on http://localhost:${env.PORT}`);
  });

  void Promise.allSettled([
    ensureBiometricSyncSchema(),
    ensureShiftSchema()
  ]).then((results) => {
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const taskName = index === 0 ? "ensureBiometricSyncSchema" : "ensureShiftSchema";
        console.error(`${taskName} failed after startup:`, result.reason);
      }
    });
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
