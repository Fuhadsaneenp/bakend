import { prisma } from "../../lib/prisma.js";
import { runSeoJobs } from "./seo.sync.js";
import { generateReport } from "./seo.routes.js";
import { day } from "./seo.domain.js";
let running = false;
export async function tickSeoJobs() {
  if (running) return;
  running = true;
  try {
    await runSeoJobs();
    const now = new Date();
    // Wait until the fifth day so the previous month's data has time to settle.
    if (now.getUTCDate() < 5) return;
    const month = day(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    ).slice(0, 7);
    const workspaces = await prisma.seoWorkspace.findMany({
      where: { lastSyncAt: { not: null }, reports: { none: { month } } },
      take: 10,
    });
    for (const w of workspaces)
      try {
        await generateReport(w.id, month, "SYSTEM");
      } catch {
        console.error("SEO monthly report generation failed", w.id, month);
      }
  } finally {
    running = false;
  }
}
export function startSeoJobs() {
  if (process.env.SEO_JOBS_ENABLED !== "true") return;
  const run = () =>
    void tickSeoJobs().catch(() =>
      console.error(
        "SEO scheduled jobs failed; check database migration and sync logs",
      ),
    );
  run();
  const timer = setInterval(run, 10 * 60000);
  timer.unref();
}
