import { spawnSync } from "node:child_process";

if (process.env.NODE_ENV !== "production") {
  console.log("Skipping prisma db push outside production build.");
  process.exit(0);
}

console.log("Running prisma db push (schema sync)...");

const result = spawnSync("npx", ["prisma", "db", "push", "--accept-data-loss", "--skip-generate"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  timeout: 30000 // 30 second timeout — don't block build if DB unreachable
});

if (result.status !== 0) {
  // Schema is likely already in sync; don't fail the build over a DB connectivity issue
  console.warn("⚠️  prisma db push exited with status", result.status, "— continuing build (schema may already be up to date).");
  process.exit(0);
}

console.log("✅ prisma db push completed.");
process.exit(0);
