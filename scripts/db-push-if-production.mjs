import { spawnSync } from "node:child_process";

if (process.env.NODE_ENV !== "production") {
  console.log("Skipping prisma db push outside production build.");
  process.exit(0);
}

const result = spawnSync("npx", ["prisma", "db", "push"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(result.status ?? 1);
