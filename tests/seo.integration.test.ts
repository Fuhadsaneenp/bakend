import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { writeFile } from "node:fs/promises";
import { begin, callback, google } from "../src/modules/seo/seo.google.js";
import { seoRouter, generateReport } from "../src/modules/seo/seo.routes.js";
import { permissionService } from "../src/modules/authority/permission.service.js";
import { scope } from "../src/modules/seo/seo.access.js";
import { sync } from "../src/modules/seo/seo.sync.js";
import { seal } from "../src/modules/seo/seo.domain.js";
import { env } from "../src/config/env.js";
import { workTrackService } from "../src/modules/work-track/work-track.service.js";
const enabled = process.env.SEO_INTEGRATION_TEST === "true";
test(
  "SEO tenant isolation, review, points idempotency, OAuth secrets and synchronization",
  { skip: !enabled },
  async () => {
    assert.match(
      process.env.DATABASE_URL || "",
      /@127\.0\.0\.1:33317\/stems_seo_test$/,
      "Integration tests must use the disposable local database",
    );
    const company = await prisma.company.create({
      data: { name: "SEO test " + randomUUID() },
    });
    const other = await prisma.company.create({
      data: { name: "Other tenant " + randomUUID() },
    });
    async function user(
      role: "SUPER_ADMIN" | "EMPLOYEE" | "MANAGER",
      suffix: string,
    ) {
      const u = await prisma.user.create({
        data: {
          companyId: company.id,
          email: `${randomUUID()}@example.test`,
          passwordHash: "test-not-a-real-hash",
          role,
        },
      });
      const employee = await prisma.employee.create({
        data: {
          companyId: company.id,
          userId: u.id,
          employeeCode: randomUUID(),
          firstName: suffix,
          lastName: "Test",
          dateOfJoining: new Date(),
        },
      });
      return { ...u, employee };
    }
    const admin = await user("SUPER_ADMIN", "Admin"),
      employee = await user("EMPLOYEE", "SEO"),
      head = await user("MANAGER", "Head"),
      outsider = await user("EMPLOYEE", "Unassigned");
    const client = await prisma.client.create({
      data: { companyId: company.id, name: "Real test client" },
    });
    await prisma.companySetting.create({data: {companyId: company.id, key: "crm_shared_workspace_data_v1", value: {clients: [{company: client.name, services: ["SEO"]}, {company: "Non SEO", services: ["Design"]}]}}});
    const second = await prisma.client.create({
      data: { companyId: other.id, name: "Other tenant client" },
    });
    const w = await prisma.seoWorkspace.create({
      data: {
        companyId: company.id,
        clientId: client.id,
        members: {
          create: [
            { employeeId: employee.employee.id },
            { employeeId: head.employee.id, role: "HEAD" },
          ],
        },
      },
    });
    const w2 = await prisma.seoWorkspace.create({
      data: { companyId: other.id, clientId: second.id },
    });
    const original = permissionService.requirePermission;
    let deny = false;
    permissionService.requirePermission = async () => {
      if (deny)
        throw Object.assign(new Error("Denied by existing grants"), {
          statusCode: 403,
        });
    };
    const app = express();
    app.use(express.json());
    app.use("/api/seo", seoRouter);
    app.use((e: any, _req: any, res: any, _next: any) =>
      res.status(e.statusCode || 400).json({ message: e.message }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as any).port;
    const realFetch = globalThis.fetch;
    const request = async (
      u: typeof admin,
      path: string,
      method = "GET",
      body?: unknown,
    ) => {
      const response = await realFetch(
        `http://127.0.0.1:${port}/api/seo${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${jwt.sign({ id: u.id }, env.JWT_ACCESS_SECRET)}`,
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      return { status: response.status, body: await response.json() };
    };
    try {
      assert.equal(
        (
          await request(
            employee as typeof admin,
            `/workspaces/${w2.id}/dashboard`,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            outsider as typeof admin,
            `/workspaces/${w.id}/dashboard`,
          )
        ).status,
        403,
      );
      deny = true;
      assert.equal(
        (
          await request(
            employee as typeof admin,
            `/workspaces/${w.id}/dashboard`,
          )
        ).status,
        403,
      );
      deny = false;
      const created = await request(
        head as typeof admin,
        `/workspaces/${w.id}/tasks`,
        "POST",
        {
          employeeId: employee.employee.id,
          category: "Keyword research",
          title: "Research terms",
          description: "Research ten qualified terms",
          targetQuantity: 10,
          project: "Q4",
          dueDate: new Date(Date.now() + 86400000).toISOString(),
        },
      );
      assert.equal(created.status, 200);
      const task = created.body;
      const taskPath = `/workspaces/${w.id}/tasks/${task.id}`;
      assert.equal(
        (
          await request(employee as typeof admin, taskPath, "PATCH", {
            status: "APPROVED",
            quality: 5,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(employee as typeof admin, taskPath, "PATCH", {
            status: "IN_PROGRESS",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(employee as typeof admin, taskPath, "PATCH", {
            status: "SUBMITTED",
            completedQuantity: 10,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(employee as typeof admin, taskPath, "PATCH", {
            status: "SUBMITTED",
            completedQuantity: 10,
            evidence: [
              { url: "https://example.test/research", name: "Evidence" },
            ],
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request(head as typeof admin, taskPath, "PATCH", {
            status: "REJECTED",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(head as typeof admin, taskPath, "PATCH", {
            status: "REJECTED",
            feedback: "Explain search intent",
          })
        ).status,
        200,
      );
      const rejected = await request(
        employee as typeof admin,
        `/workspaces/${w.id}/tasks`,
      );
      assert.equal(rejected.body[0].feedback, "Explain search intent");
      await request(employee as typeof admin, taskPath, "PATCH", {
        status: "IN_PROGRESS",
      });
      await request(employee as typeof admin, taskPath, "PATCH", {
        status: "SUBMITTED",
        completedQuantity: 10,
      });
      const reviews = await Promise.all([
        request(head as typeof admin, taskPath, "PATCH", {
          status: "APPROVED",
          quality: 4,
          feedback: "Verified",
        }),
        request(head as typeof admin, taskPath, "PATCH", {
          status: "APPROVED",
          quality: 4,
          feedback: "Verified",
        }),
      ]);
      assert.equal(reviews.filter((r) => r.status === 200).length, 1);
      const attachmentTask = await request(
        head as typeof admin,
        `/workspaces/${w.id}/tasks`,
        "POST",
        {
          employeeId: employee.employee.id,
          category: "Content optimization",
          title: "Attachment privacy",
          description: "Verify private work evidence",
          targetQuantity: 1,
          project: "Q4",
          dueDate: new Date(Date.now() + 86400000).toISOString(),
        },
      );
      await request(
        employee as typeof admin,
        `/workspaces/${w.id}/tasks/${attachmentTask.body.id}`,
        "PATCH",
        { status: "IN_PROGRESS" },
      );
      const upload = new FormData();
      upload.append(
        "file",
        new Blob(["private test attachment"], { type: "application/pdf" }),
        "test.pdf",
      );
      const uploaded = await realFetch(
        `http://127.0.0.1:${port}/api/seo/workspaces/${w.id}/tasks/${attachmentTask.body.id}/evidence`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt.sign({ id: employee.id }, env.JWT_ACCESS_SECRET)}`,
          },
          body: upload,
        },
      );
      assert.equal(uploaded.status, 200);
      const attachment = (await uploaded.json()) as any;
      const fileUrl = `http://127.0.0.1:${port}${attachment.url}`;
      assert.equal((await realFetch(fileUrl)).status, 401);
      assert.equal(
        (
          await realFetch(fileUrl, {
            headers: {
              Authorization: `Bearer ${jwt.sign({ id: outsider.id }, env.JWT_ACCESS_SECRET)}`,
            },
          })
        ).status,
        403,
      );
      const downloaded = await realFetch(fileUrl, {
        headers: {
          Authorization: `Bearer ${jwt.sign({ id: head.id }, env.JWT_ACCESS_SECRET)}`,
        },
      });
      assert.equal(await downloaded.text(), "private test attachment");
      const ledgers = await prisma.pointsLedger.findMany({
        where: { workCardId: task.workCardId },
      });
      assert.equal(ledgers.length, 1);
      assert.equal(ledgers[0].points, 1);
      await assert.rejects(() =>
        workTrackService.updateWorkCardStatus(
          company.id,
          task.workCardId,
          head.id,
          { status: "APPROVED" },
        ),
      );
      await assert.rejects(() =>
        workTrackService.deleteWorkCard(company.id, admin.id, task.workCardId),
      );
      await assert.rejects(() =>
        workTrackService.awardEmployeePoints(company.id, admin.id, {
          employeeId: employee.employee.id,
          points: 99,
          description: "Duplicate",
          workCardId: task.workCardId,
        }),
      );
      const issue = await request(
        head as typeof admin,
        `/workspaces/${w.id}/activities`,
        "POST",
        {
          kind: "TECHNICAL",
          employeeId: employee.employee.id,
          url: "https://example.test/broken",
          data: {
            category: "404 errors",
            severity: "high",
            evidence: "https://example.test/audit",
          },
        },
      );
      assert.equal(issue.status, 200);
      assert.equal(
        (
          await request(
            employee as typeof admin,
            `/workspaces/${w.id}/activities/${issue.body.id}`,
            "PATCH",
            { status: "RESOLVED", reason: "Fixed routing" },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            employee as typeof admin,
            `/workspaces/${w.id}/activities/${issue.body.id}`,
            "PATCH",
            { verification: "APPROVED", reason: "Self approval" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            head as typeof admin,
            `/workspaces/${w.id}/activities/${issue.body.id}`,
            "PATCH",
            { verification: "APPROVED", reason: "Verified response" },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            head as typeof admin,
            `/workspaces/${w.id}/activities`,
            "POST",
            {
              kind: "TECHNICAL",
              employeeId: employee.employee.id,
              url: "https://example.test/issue",
              data: { category: "404 errors", severity: "invented" },
            },
          )
        ).status,
        400,
      );
      await prisma.workTrackSetting.create({
        data: {
          id: randomUUID(),
          companyId: company.id,
          pointValues: "{}",
          slaTimes: "{}",
          categories: "[]",
          reworkReasons: "[]",
          promotionRules: "{}",
        },
      });
      const current = new Date();
      const privateAnalytics = await workTrackService.getAnalytics(
        company.id,
        current.getMonth() + 1,
        current.getFullYear(),
        outsider.id,
      );
      assert.equal(
        privateAnalytics.topNumbers.total,
        0,
        "Legacy analytics must not expose assigned SEO cards to an outsider",
      );
      const adminAnalytics = await workTrackService.getAnalytics(
        company.id,
        current.getMonth() + 1,
        current.getFullYear(),
        admin.id,
      );
      assert.equal(
        adminAnalytics.topNumbers.total,
        2,
        "Administrators retain integrated SEO performance totals",
      );
      const imported = await request(
        employee as typeof admin,
        `/workspaces/${w.id}/keywords/import`,
        "POST",
        {
          keywords: [
            {
              keyword: "test query",
              targetUrl: "https://example.test/landing",
            },
          ],
        },
      );
      assert.equal(imported.status, 200);
      await request(
        employee as typeof admin,
        `/workspaces/${w.id}/keywords/import`,
        "POST",
        {
          keywords: [
            {
              keyword: "test query",
              targetUrl: "https://example.test/landing",
            },
          ],
        },
      );
      assert.equal(
        await prisma.seoKeyword.count({ where: { workspaceId: w.id } }),
        1,
      );
      process.env.SEO_TOKEN_KEY = "cd".repeat(32);
      const c = await prisma.seoConnection.create({
        data: {
          companyId: company.id,
          ownerUserId: admin.id,
          refreshCipher: seal("private-refresh"),
          accessCipher: seal("private-access"),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const p = await prisma.seoProperty.create({
        data: {
          connectionId: c.id,
          siteUrl: "sc-domain:example.test",
          permissionLevel: "siteOwner",
        },
      });
      await prisma.seoWorkspace.update({
        where: { id: w.id },
        data: {
          propertyId: p.id,
          sourceSiteUrl: p.siteUrl,
          nextSyncAt: new Date(0),
        },
      });
      const connections = await request(admin, "/google/connections");
      assert.ok(!JSON.stringify(connections.body).includes("Cipher"));
      assert.equal(
        (await request(employee as typeof admin, "/google/connections")).status,
        403,
      );
      let version = 1,
        googleCalls = 0;
      globalThis.fetch = async (input, options) => {
        googleCalls++;
        assert.ok(
          String(input).startsWith(
            "https://www.googleapis.com/webmasters/v3/sites/",
          ),
        );
        assert.equal(
          (options?.headers as any).Authorization,
          "Bearer private-access",
        );
        const body = JSON.parse(options!.body as string);
        const dimension = body.dimensions[1];
        return new Response(
          JSON.stringify({
            rows: [
              {
                keys: dimension
                  ? [
                      body.endDate,
                      dimension === "query"
                        ? "test query"
                        : dimension === "page"
                          ? "https://example.test/landing"
                          : "mobile",
                    ]
                  : [body.endDate],
                clicks: version,
                impressions: 100,
                ctr: version / 100,
                position: 12,
              },
            ],
            metadata: { first_incomplete_date: body.endDate },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };
      await sync(w.id, true);
      assert.equal(googleCalls, 5);
      assert.equal(
        await prisma.seoMetric.count({ where: { workspaceId: w.id } }),
        5,
      );
      await assert.rejects(() => sync(w.id, true));
      assert.equal(
        (
          await request(
            head as typeof admin,
            `/workspaces/${w.id}/sync`,
            "POST",
          )
        ).status,
        429,
      );
      const dashboard = await request(
        employee as typeof admin,
        `/workspaces/${w.id}/dashboard`,
      );
      assert.equal(dashboard.body.totals.clicks, 1);
      assert.equal(googleCalls, 5, "Opening dashboard must not call Google");
      await prisma.seoWorkspace.update({
        where: { id: w.id },
        data: { lastSyncAttemptAt: new Date(0) },
      });
      version = 2;
      await sync(w.id, true);
      assert.equal(
        await prisma.seoMetric.count({ where: { workspaceId: w.id } }),
        5,
      );
      assert.equal(
        (
          await prisma.seoMetric.findFirstOrThrow({
            where: { workspaceId: w.id, dimension: "total" },
          })
        ).clicks,
        2,
      );
      const history = await prisma.seoRanking.findMany({
        where: { keyword: { workspaceId: w.id } },
      });
      assert.equal(history.length, 1);
      assert.equal(history[0].source, "GSC_AVERAGE");
      await prisma.seoWorkspace.update({
        where: { id: w.id },
        data: { lastSyncAttemptAt: new Date(0) },
      });
      globalThis.fetch = async () => new Response("Denied", { status: 403 });
      await assert.rejects(() => sync(w.id, true));
      assert.equal(
        await prisma.seoMetric.count({ where: { workspaceId: w.id } }),
        5,
      );
      assert.equal(
        await prisma.seoSyncLog.count({
          where: { workspaceId: w.id, status: "FAILED" },
        }),
        1,
      );
      assert.equal(
        (await prisma.seoWorkspace.findUniqueOrThrow({ where: { id: w.id } }))
          .leaseUntil,
        null,
      );
      globalThis.fetch = realFetch;
      const report = await generateReport(w.id, "2026-09", admin.id);
      assert.equal(report.month, "2026-09");
      const pdf = await realFetch(
        `http://127.0.0.1:${port}/api/seo/workspaces/${w.id}/reports/${report.id}/pdf`,
        {
          headers: {
            Authorization: `Bearer ${jwt.sign({ id: admin.id }, env.JWT_ACCESS_SECRET)}`,
          },
        },
      );
      assert.equal(pdf.status, 200);
      assert.match(pdf.headers.get("content-type") || "", /application\/pdf/);
      const bytes = Buffer.from(await pdf.arrayBuffer());
      assert.ok(bytes.length > 1000);
      await writeFile("/tmp/stems-seo-report-qa.pdf", bytes);
      process.env.SEO_GOOGLE_CLIENT_ID = "local-test-client";
      process.env.SEO_GOOGLE_CLIENT_SECRET = "local-test-secret";
      process.env.SEO_GOOGLE_REDIRECT_URI =
        "http://localhost:4000/api/seo/google/callback";
      const started = await begin(admin as any);
      const authorize = new URL(started.url);
      assert.equal(
        authorize.searchParams.get("scope"),
        "https://www.googleapis.com/auth/webmasters.readonly",
      );
      assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
      assert.ok(!started.url.includes("local-test-secret"));
      globalThis.fetch = async (input) =>
        String(input).includes("oauth2.googleapis.com/token")
          ? new Response(
              JSON.stringify({
                access_token: "google-access-test",
                refresh_token: "google-offline-test",
                expires_in: 3600,
              }),
              { status: 200 },
            )
          : new Response(
              JSON.stringify({
                siteEntry: [
                  {
                    siteUrl: "sc-domain:oauth.example",
                    permissionLevel: "siteOwner",
                  },
                  {
                    siteUrl: "https://oauth.example/",
                    permissionLevel: "siteOwner",
                  },
                ],
              }),
              { status: 200 },
            );
      await callback(authorize.searchParams.get("state")!, "code-test");
      await assert.rejects(() =>
        callback(authorize.searchParams.get("state")!, "code-test"),
      );
      const oauth = await prisma.seoConnection.findFirstOrThrow({
        where: { companyId: company.id, id: { not: c.id } },
        orderBy: { createdAt: "desc" },
        include: { properties: true },
      });
      assert.equal(oauth.properties.length, 2);
      assert.ok(!oauth.refreshCipher.includes("google-offline-test"));
      await prisma.seoConnection.update({
        where: { id: oauth.id },
        data: { expiresAt: new Date(0) },
      });
      let refreshCount = 0;
      globalThis.fetch = async (input) => {
        if (String(input).includes("oauth2.googleapis.com/token")) {
          refreshCount++;
          return new Response(
            JSON.stringify({ access_token: "renewed-test", expires_in: 3600 }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ siteEntry: [] }), { status: 200 });
      };
      await Promise.all([
        google(oauth.id, "/sites"),
        google(oauth.id, "/sites"),
      ]);
      assert.equal(refreshCount, 1);
      const legacy = {
        sheetKey: `${client.id}-September 2026`,
        month: "2026-09",
        rankings: [
          {
            keyword: "historic",
            currentRank: "7",
            rankingUrl: "https://example.test/old",
          },
          { keyword: "incomplete", currentRank: "unknown", rankingUrl: "" },
        ],
        backlinks: [
          { backlink: "https://source.example/article", status: "Active" },
        ],
      };
      assert.equal(
        (
          await request(
            admin,
            `/workspaces/${w.id}/legacy-import`,
            "POST",
            legacy,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            admin,
            `/workspaces/${w.id}/legacy-import`,
            "POST",
            legacy,
          )
        ).status,
        200,
      );
      assert.equal(
        await prisma.seoLegacySheet.count({ where: { workspaceId: w.id } }),
        1,
      );
      assert.equal(
        await prisma.seoActivity.count({
          where: { workspaceId: w.id, kind: "BACKLINK" },
        }),
        1,
      );
      const scoped = await scope(employee as any, w.id);
      assert.equal(scoped.manager, false);
    } finally {
      permissionService.requirePermission = original;
      globalThis.fetch = realFetch;
      await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
      await prisma.$disconnect();
    }
  },
);
