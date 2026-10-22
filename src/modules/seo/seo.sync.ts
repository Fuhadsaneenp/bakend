import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { google } from "./seo.google.js";
import { day, dateValue, hash } from "./seo.domain.js";
// Bounded per-property jobs: five independent dimensions, at most 50k rows each.
// Query/page tables are top-row samples, never authoritative site totals.
export async function sync(
  workspaceId: string,
  manual = false,
  onStarted?: () => void,
) {
  const now = new Date();
  const claimed = await prisma.seoWorkspace.updateMany({
    where: {
      id: workspaceId,
      propertyId: { not: null },
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        ...(manual
          ? [
              {
                OR: [
                  { lastSyncAttemptAt: null },
                  { lastSyncAttemptAt: { lt: new Date(+now - 15 * 60000) } },
                ],
              },
            ]
          : [{ nextSyncAt: { lte: now } }]),
      ],
    },
    data: {
      lastSyncAttemptAt: now,
      leaseUntil: new Date(+now + 30 * 60000),
      nextSyncAt: new Date(+now + 86400000),
    },
  });
  if (!claimed.count)
    throw new ApiError(
      429,
      "Synchronization already running, not due, or rate limited",
    );
  const w = await prisma.seoWorkspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: { property: true },
  });
  const log = await prisma.seoSyncLog.create({
    data: { workspaceId, status: "RUNNING" },
  });
  onStarted?.();
  let rowsSaved = 0;
  try {
    // First import covers 90 days; daily runs re-fetch 10 days to refresh revisions.
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (w.lastSyncAt ? 9 : 89));
    const site = `/sites/${encodeURIComponent(w.property!.siteUrl)}`;
    const notes: string[] = [];
    for (const dimension of ["total", "query", "page", "country", "device"]) {
      const rows: any[] = [];
      let incomplete: string | undefined;
      for (let offset = 0; offset < 50000; offset += 25000) {
        const result = await google(
          w.property!.connectionId,
          `${site}/searchAnalytics/query`,
          {
            startDate: day(start),
            endDate: day(end),
            dimensions: dimension === "total" ? ["date"] : ["date", dimension],
            type: "web",
            dataState: "all",
            rowLimit: 25000,
            startRow: offset,
          },
        );
        incomplete = result.metadata?.first_incomplete_date || incomplete;
        const batch = result.rows || [];
        rows.push(...batch);
        if (batch.length < 25000) break;
        if (offset === 25000)
          notes.push(`${dimension}: 50,000-row import cap reached`);
      }
      // Atomic replacement removes stale query rows when Google changes privacy filters.
      await prisma.$transaction(
        async (tx) => {
          await tx.seoMetric.deleteMany({
            where: {
              workspaceId,
              dimension,
              date: { gte: dateValue(day(start)), lte: dateValue(day(end)) },
            },
          });
          for (let i = 0; i < rows.length; i += 250)
            await tx.seoMetric.createMany({
              data: rows.slice(i, i + 250).map((r) => ({
                workspaceId,
                date: dateValue(r.keys[0]),
                dimension,
                label: r.keys[1] || "",
                keyHash: hash(r.keys[1] || ""),
                clicks: r.clicks,
                impressions: r.impressions,
                ctr: r.ctr,
                position: r.position,
                preliminary: !!incomplete && r.keys[0] >= incomplete,
              })),
            });
        },
        { timeout: 120000 },
      );
      rowsSaved += rows.length;
    }
    // Query averages cannot supply country/device-specific exact keyword ranks.
    const keywords = await prisma.seoKeyword.findMany({
      where: { workspaceId, country: "", device: "" },
    });
    for (const keyword of keywords) {
      const metrics = await prisma.seoMetric.findMany({
        where: {
          workspaceId,
          dimension: "query",
          label: keyword.keyword,
          date: { gte: dateValue(day(start)) },
        },
        orderBy: { date: "asc" },
      });
      for (const metric of metrics)
        await prisma.seoRanking.upsert({
          where: {
            keywordId_date_source: {
              keywordId: keyword.id,
              date: metric.date,
              source: "GSC_AVERAGE",
            },
          },
          create: {
            keywordId: keyword.id,
            date: metric.date,
            source: "GSC_AVERAGE",
            position: metric.position,
            clicks: metric.clicks,
            impressions: metric.impressions,
            ctr: metric.ctr,
          },
          update: {
            position: metric.position,
            clicks: metric.clicks,
            impressions: metric.impressions,
            ctr: metric.ctr,
          },
        });
    }
    await prisma.seoWorkspace.update({
      where: { id: workspaceId },
      data: { lastSyncAt: new Date() },
    });
    await prisma.seoSyncLog.update({
      where: { id: log.id },
      data: {
        status: "SUCCESS",
        rows: rowsSaved,
        finishedAt: new Date(),
        details:
          notes.join("; ") ||
          "Search Console may omit anonymized queries and lower-volume rows. Recent data may be preliminary.",
      },
    });
  } catch (error) {
    await prisma.seoSyncLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        rows: rowsSaved,
        finishedAt: new Date(),
        details:
          error instanceof ApiError
            ? error.message
            : "Synchronization failed; retry scheduled",
      },
    });
    await prisma.seoWorkspace.update({
      where: { id: workspaceId },
      data: { nextSyncAt: new Date(Date.now() + 3600000) },
    });
    throw error;
  } finally {
    await prisma.seoWorkspace.update({
      where: { id: workspaceId },
      data: { leaseUntil: null },
    });
  }
}
export async function runSeoJobs() {
  await prisma.seoOAuthState.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  const workspaces = await prisma.seoWorkspace.findMany({
    where: {
      property: { connection: { status: "CONNECTED" } },
      nextSyncAt: { lte: new Date() },
    },
    select: { id: true },
    take: 20,
  });
  for (const w of workspaces)
    try {
      await sync(w.id);
    } catch {
      /* Each failure is recorded; other clients continue. */
    }
}
