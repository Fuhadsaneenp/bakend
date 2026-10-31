import { startMasterSheetSync } from "./modules/google-sheets/masterSync.js";
import { startAdSenseJobs } from "./modules/adsense/adsense.service.js";
import { startSeoJobs } from "./modules/seo/seo.jobs.js";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { ensureBiometricSyncSchema } from "./lib/biometricDeviceSync.js";
import { ensureShiftSchema } from "./lib/ensureShiftSchema.js";

async function start() {
  const app = createApp();
  startSeoJobs();
  startMasterSheetSync();
  startAdSenseJobs();

  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`HR SaaS API listening on http://localhost:${env.PORT}`);
  });

  if (process.env.LOCAL_SCHEMA_AUTOMATION_DISABLED !== "true") void Promise.allSettled([
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
