import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { ensureShiftSchema } from "./lib/ensureShiftSchema.js";

async function start() {
  await ensureShiftSchema();
  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`HR SaaS API listening on http://localhost:${env.PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
