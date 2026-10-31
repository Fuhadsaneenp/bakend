import { callback as sheetsCallback, destination as sheetsDestination } from "../google-sheets/sheets.service.js";
import { callback as adsenseCallback } from "../adsense/adsense.service.js";
import { adsenseDestination } from "../adsense/adsense.routes.js";
import { seoCrmClients } from "./seo.clients.js";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { renderSeoReport } from "./seo.report.js";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { admin, company, scope, employeeAssigned } from "./seo.access.js";
import { begin, callback, disconnect, discover, google } from "./seo.google.js";
import { sync } from "./seo.sync.js";
import { createTask, updateTask } from "./seo.tasks.js";
import { analytics, insight } from "./seo.analytics.js";
import {
  categories,
  day,
  keywordIdentity,
  dateValue,
  period,
  hash,
} from "./seo.domain.js";
import { permissionService } from "../authority/permission.service.js";
import { verifyBacklink } from "./seo.backlinks.js";
export const seoRouter = Router();
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
const url = z
  .string()
  .url()
  .max(2000)
  .refine((s) => {
    try {
      return ["http:", "https:"].includes(new URL(s).protocol);
    } catch {
      return false;
    }
  }, "HTTP(S) URL required");
const text = z.string().trim().min(1).max(10000);
const limited = rateLimit({
  windowMs: 15 * 60000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
seoRouter.get(
  "/google/callback",
  wrap(async (req, res) => {
    if (typeof req.query.state === "string" && req.query.state.startsWith("sheets.")) {
      res.setHeader("Referrer-Policy", "no-referrer");
      try { await sheetsCallback(req.query.state, z.string().min(1).parse(req.query.code)); res.redirect(sheetsDestination("connected")); }
      catch { res.redirect(sheetsDestination("failed")); }
      return;
    }
    if (typeof req.query.state === "string" && req.query.state.startsWith("adsense.")) {
      res.setHeader("Referrer-Policy", "no-referrer");
      try { const website = await adsenseCallback(req.query.state, z.string().min(1).parse(req.query.code)); res.redirect(adsenseDestination(website) + "&adsense=connected"); }
      catch { res.redirect(adsenseDestination() + "&adsense=failed"); }
      return;
    }
    await callback(
      z.string().min(20).parse(req.query.state),
      z.string().min(1).parse(req.query.code),
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(
      `${process.env.APP_ORIGIN || "https://stems.secondtales.com"}/work-track/seo/search-console`,
    );
  }),
);
seoRouter.use(requireAuth);
seoRouter.get(
  "/workspaces",
  wrap(async (req, res) => {
    const u = req.user!;
    const employee = await prisma.employee.findFirst({
      where: { userId: u.id, companyId: company(u) },
      select: { id: true },
    });
    const eligibleClients = await seoCrmClients(company(u));
    const eligibleIds = new Set(eligibleClients.map(client => client.id));
    const candidates = await prisma.seoWorkspace.findMany({
      where: {
        companyId: company(u),
        ...(!admin(u)
          ? { members: { some: { employeeId: employee?.id || "__none__" } } }
          : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        members: {
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                employeeCode: true,
              },
            },
          },
        },
        property: {
          select: { siteUrl: true, connection: { select: { status: true } } },
        },
      },
    });
    const workspaces = [];
    for (const w of candidates.filter(w => eligibleIds.has(w.clientId)))
      try {
        const a = await scope(u, w.id);
        const permissionScope = {
          companyId: company(u),
          clientId: w.clientId,
          employeeId: employee?.id,
          assignedToEmployeeId: employee?.id,
        };
        const capabilities: Record<string, boolean> = {};
        for (const code of [
          "seo.ranking.view",
          "seo.ranking.edit",
          "seo.backlink.view",
          "seo.backlink.edit",
          "worktrack.task.assign",
          "worktrack.task.status.update",
          "worktrack.review.approve",
          "worktrack.file.upload",
        ])
          capabilities[code] =
            admin(u) ||
            (await permissionService.hasPermission(
              u.id,
              code,
              permissionScope,
            ));
        workspaces.push({ ...w, manager: a.manager, capabilities });
      } catch {}
    const availableClients = admin(u) ? eligibleClients : workspaces.map(w => w.client);
    res.json({
      admin: admin(u),
      googleConfigured: admin(u) ? !!(process.env.SEO_GOOGLE_CLIENT_ID && process.env.SEO_GOOGLE_CLIENT_SECRET && process.env.SEO_GOOGLE_REDIRECT_URI) : undefined,
      employeeId: employee?.id,
      workspaces,
      availableClients,
      categories,
    });
  }),
);
seoRouter.post(
  "/workspaces",
  wrap(async (req, res) => {
    const u = req.user!;
    if (!admin(u)) throw new ApiError(403, "Administrator required");
    const { clientId } = z.object({ clientId: text }).parse(req.body);
    const client = await prisma.client.findFirst({
      where: { id: clientId, companyId: company(u) },
    });
    if (!client) throw new ApiError(404, "Client not found");
    if (!(await seoCrmClients(company(u))).some(candidate => candidate.id === clientId))
      throw new ApiError(403, "Only clients with an SEO service in CRM can use the SEO workspace");
    res.json(
      await prisma.seoWorkspace.upsert({
        where: { clientId },
        create: { clientId, companyId: company(u) },
        update: {},
      }),
    );
  }),
);
seoRouter.put(
  "/workspaces/:id/members",
  wrap(async (req, res) => {
    const u = req.user!;
    if (!admin(u)) throw new ApiError(403, "Administrator required");
    await scope(u, req.params.id);
    const body = z
      .object({ employeeId: text, role: z.enum(["HEAD", "EMPLOYEE"]) })
      .parse(req.body);
    const employee = await prisma.employee.findFirst({
      where: {
        id: body.employeeId,
        companyId: company(u),
        status: "ACTIVE",
        dateOfExit: null,
      },
    });
    if (!employee) throw new ApiError(400, "Active company employee required");
    res.json(
      await prisma.seoMember.upsert({
        where: {
          workspaceId_employeeId: {
            workspaceId: req.params.id,
            employeeId: body.employeeId,
          },
        },
        create: { workspaceId: req.params.id, ...body },
        update: { role: body.role },
      }),
    );
  }),
);
seoRouter.delete(
  "/workspaces/:id/members/:employeeId",
  wrap(async (req, res) => {
    if (!admin(req.user!)) throw new ApiError(403, "Administrator required");
    await scope(req.user!, req.params.id);
    await prisma.seoMember.deleteMany({
      where: { workspaceId: req.params.id, employeeId: req.params.employeeId },
    });
    res.json({ ok: true });
  }),
);
seoRouter.get(
  "/google/connections",
  wrap(async (req, res) => {
    if (!admin(req.user!)) throw new ApiError(403, "Administrator required");
    res.json(
      await prisma.seoConnection.findMany({
        where: { companyId: company(req.user!) },
        select: { id: true, status: true, createdAt: true, properties: true },
      }),
    );
  }),
);
seoRouter.post(
  "/google/connect",
  limited,
  wrap(async (req, res) => res.json(await begin(req.user!))),
);
seoRouter.delete(
  "/google/connections/:connectionId",
  wrap(async (req, res) => {
    await disconnect(req.user!, req.params.connectionId);
    res.json({ ok: true });
  }),
);
seoRouter.post(
  "/google/connections/:connectionId/refresh-properties",
  limited,
  wrap(async (req, res) => {
    if (!admin(req.user!)) throw new ApiError(403, "Administrator required");
    const c = await prisma.seoConnection.findFirst({
      where: { id: req.params.connectionId, companyId: company(req.user!) },
    });
    if (!c) throw new ApiError(404, "Connection not found");
    await discover(c.id);
    res.json({ ok: true });
  }),
);
seoRouter.put(
  "/workspaces/:id/property",
  wrap(async (req, res) => {
    const u = req.user!;
    if (!admin(u)) throw new ApiError(403, "Administrator required");
    await scope(u, req.params.id);
    const { propertyId } = z
      .object({ propertyId: z.string().nullable() })
      .parse(req.body);
    if (
      propertyId &&
      !(await prisma.seoProperty.findFirst({
        where: {
          id: propertyId,
          connection: { companyId: company(u), status: "CONNECTED" },
        },
      }))
    )
      throw new ApiError(400, "Active company property required");
    const w = await prisma.seoWorkspace.findUniqueOrThrow({
      where: { id: req.params.id },
    });
    if (w.leaseUntil && w.leaseUntil > new Date())
      throw new ApiError(409, "Wait for the active sync to finish");
    // Never mix historical metrics from different properties. Reconnect may map the same URL.
    if (propertyId) {
      const next = await prisma.seoProperty.findUniqueOrThrow({
        where: { id: propertyId },
      });
      if (w.sourceSiteUrl && w.sourceSiteUrl !== next.siteUrl)
        throw new ApiError(
          409,
          "Historical data is bound to another property; archive before changing it",
        );
    }
    if (w.propertyId && propertyId && w.propertyId !== propertyId) {
      const [old, next] = await Promise.all([
        prisma.seoProperty.findUnique({ where: { id: w.propertyId } }),
        prisma.seoProperty.findUnique({ where: { id: propertyId } }),
      ]);
      if (
        old?.siteUrl !== next?.siteUrl &&
        (await prisma.seoMetric.count({ where: { workspaceId: w.id } }))
      )
        throw new ApiError(
          409,
          "This workspace has historical data for another property; export and archive it before changing the property",
        );
    }
    res.json(
      await prisma.seoWorkspace.update({
        where: { id: w.id },
        data: {
          propertyId,
          ...(propertyId
            ? {
                sourceSiteUrl: (
                  await prisma.seoProperty.findUniqueOrThrow({
                    where: { id: propertyId },
                  })
                ).siteUrl,
              }
            : {}),
          nextSyncAt: new Date(),
        },
      }),
    );
  }),
);
seoRouter.post(
  "/workspaces/:id/sync",
  limited,
  wrap(async (req, res) => {
    await scope(req.user!, req.params.id, "seo.report.view", true);
    // Job continues independently of browser request timeouts.
    await new Promise<void>((resolve, reject) => {
      void sync(req.params.id, true, resolve).catch(reject);
    });
    res.status(202).json({
      queued: true,
      message: "Sync requested. Check sync history for results.",
    });
  }),
);
function range(req: Request) {
  const end = z
    .string()
    .default(day(new Date(Date.now() - 86400000)))
    .parse(req.query.end);
  const start = z
    .string()
    .default(day(new Date(Date.now() - 28 * 86400000)))
    .parse(req.query.start);
  period(start, end);
  return { start, end };
}
seoRouter.get(
  "/workspaces/:id/dashboard",
  wrap(async (req, res) => {
    const a = await scope(req.user!, req.params.id);
    const r = range(req);
    res.json(
      await analytics(
        req.params.id,
        r.start,
        r.end,
        a.manager
          ? z.string().optional().parse(req.query.employeeId)
          : a.employeeId,
        z.string().optional().parse(req.query.project),
      ),
    );
  }),
);
seoRouter.get(
  "/workspaces/:id/tasks",
  wrap(async (req, res) => {
    const a = await scope(req.user!, req.params.id);
    const tasks = await prisma.seoTask.findMany({
      where: {
        workspaceId: req.params.id,
        ...(!a.manager ? { employeeId: a.employeeId } : {}),
      },
      include: {
        evidence: {
          select: {
            id: true,
            url: true,
            name: true,
            mimeType: true,
            createdAt: true,
          },
        },
        reviews: { orderBy: { createdAt: "desc" } },
      },
      orderBy: { assignedDate: "desc" },
      take: 500,
    });
    const cards = await prisma.workCard.findMany({
      where: {
        id: { in: tasks.map((t) => t.workCardId) },
        companyId: company(req.user!),
      },
      select: { id: true, title: true, deadline: true },
    });
    res.json(
      tasks.map((t) => ({
        ...t,
        workCard: cards.find((c) => c.id === t.workCardId),
      })),
    );
  }),
);
seoRouter.post(
  "/workspaces/:id/tasks",
  wrap(async (req, res) =>
    res.json(
      await createTask(
        req.user!,
        req.params.id,
        z
          .object({
            employeeId: text,
            category: z.enum(categories),
            title: text,
            description: text,
            dueDate: z.string().datetime(),
            targetQuantity: z.number().positive().max(100000),
            project: z.string().max(200).default(""),
          })
          .parse(req.body),
      ),
    ),
  ),
);
seoRouter.patch(
  "/workspaces/:id/tasks/:taskId",
  wrap(async (req, res) =>
    res.json(
      await updateTask(
        req.user!,
        req.params.id,
        req.params.taskId,
        z
          .object({
            status: z.enum([
              "IN_PROGRESS",
              "SUBMITTED",
              "APPROVED",
              "REJECTED",
              "CORRECTIONS",
            ]),
            completedQuantity: z.number().nonnegative().max(100000).optional(),
            remarks: z.string().max(10000).optional(),
            feedback: z.string().max(10000).optional(),
            quality: z.number().int().min(1).max(5).optional(),
            evidence: z
              .array(z.object({ url, name: z.string().max(200) }))
              .max(20)
              .optional(),
          })
          .parse(req.body),
      ),
    ),
  ),
);
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    cb(
      null,
      ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(
        file.mimetype,
      ),
    ),
});
seoRouter.post(
  "/workspaces/:id/tasks/:taskId/evidence",
  evidenceUpload.single("file"),
  wrap(async (req, res) => {
    const a = await scope(req.user!, req.params.id, "worktrack.file.upload");
    const task = await prisma.seoTask.findFirst({
      where: { id: req.params.taskId, workspaceId: req.params.id },
    });
    if (!task || task.employeeId !== a.employeeId)
      throw new ApiError(403, "Assigned employee required");
    if (task.status !== "IN_PROGRESS")
      throw new ApiError(
        409,
        "Evidence can be uploaded while work is in progress",
      );
    if (!req.file)
      throw new ApiError(
        400,
        "Upload a PDF, PNG, JPEG or WebP file (maximum 5 MB)",
      );
    const evidenceId = randomUUID();
    const evidence = await prisma.seoEvidence.create({
      data: {
        id: evidenceId,
        taskId: task.id,
        url: `/api/seo/workspaces/${req.params.id}/tasks/${task.id}/evidence/${evidenceId}`,
        name: req.file.originalname
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .slice(0, 150),
        mimeType: req.file.mimetype,
        fileData: new Uint8Array(req.file.buffer),
      },
      select: { id: true, name: true, url: true },
    });
    res.json(evidence);
  }),
);
seoRouter.get(
  "/workspaces/:id/tasks/:taskId/evidence/:evidenceId",
  wrap(async (req, res) => {
    const a = await scope(req.user!, req.params.id);
    const task = await prisma.seoTask.findFirst({
      where: { id: req.params.taskId, workspaceId: req.params.id },
    });
    if (!task || (!a.manager && task.employeeId !== a.employeeId))
      throw new ApiError(403, "Assigned employee required");
    const evidence = await prisma.seoEvidence.findFirst({
      where: { id: req.params.evidenceId, taskId: task.id },
    });
    if (!evidence?.fileData) throw new ApiError(404, "Attachment not found");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${evidence.name}"`,
    );
    res
      .type(evidence.mimeType || "application/octet-stream")
      .send(Buffer.from(evidence.fileData));
  }),
);
const keyword = z.object({
  keyword: z.string().trim().min(1).max(512),
  targetUrl: url,
  country: z.string().max(3).default(""),
  device: z.enum(["", "DESKTOP", "MOBILE", "TABLET"]).default(""),
  intent: z.string().max(100).default(""),
  employeeId: z.string().optional(),
});
seoRouter.get(
  "/workspaces/:id/keywords",
  wrap(async (req, res) => {
    await scope(req.user!, req.params.id, "seo.ranking.view");
    res.json(
      await prisma.seoKeyword.findMany({
        where: { workspaceId: req.params.id },
        include: { history: { orderBy: { date: "desc" }, take: 400 } },
        take: 2000,
      }),
    );
  }),
);
seoRouter.post(
  "/workspaces/:id/keywords/import",
  wrap(async (req, res) => {
    await scope(req.user!, req.params.id, "seo.ranking.edit");
    const body = z
      .object({ keywords: z.array(keyword).min(1).max(1000) })
      .parse(req.body);
    for (const k of body.keywords) {
      if (k.employeeId)
        await employeeAssigned(req.params.id, k.employeeId, company(req.user!));
      await prisma.seoKeyword.upsert({
        where: {
          workspaceId_identityHash: {
            workspaceId: req.params.id,
            identityHash: keywordIdentity(
              k.keyword,
              k.targetUrl,
              k.country,
              k.device,
            ),
          },
        },
        create: {
          ...k,
          workspaceId: req.params.id,
          identityHash: keywordIdentity(
            k.keyword,
            k.targetUrl,
            k.country,
            k.device,
          ),
        },
        update: {},
      });
    }
    res.json({ imported: body.keywords.length });
  }),
);
seoRouter.post(
  "/workspaces/:id/keywords/:keywordId/rankings",
  wrap(async (req, res) => {
    await scope(req.user!, req.params.id, "seo.ranking.edit");
    const body = z
      .object({
        date: z.string(),
        position: z.number().positive().max(10000).nullable(),
      })
      .parse(req.body);
    period(body.date, body.date);
    if (
      !(await prisma.seoKeyword.findFirst({
        where: { id: req.params.keywordId, workspaceId: req.params.id },
      }))
    )
      throw new ApiError(404, "Keyword not found");
    res.json(
      await prisma.seoRanking.upsert({
        where: {
          keywordId_date_source: {
            keywordId: req.params.keywordId,
            date: dateValue(body.date),
            source: "MANUAL_EXACT",
          },
        },
        create: {
          keywordId: req.params.keywordId,
          date: dateValue(body.date),
          source: "MANUAL_EXACT",
          position: body.position,
        },
        update: { position: body.position },
      }),
    );
  }),
);
const technicalCategories = [
  "Broken links",
  "404 errors",
  "Redirect issues",
  "Missing canonical tags",
  "Duplicate content",
  "Sitemap issues",
  "Robots.txt issues",
  "Mobile usability issues",
  "Page speed issues",
  "Structured data errors",
  "Indexing problems",
] as const;
function validateActivity(kind: string, data: Record<string, unknown>) {
  if (kind === "BACKLINK")
    z.object({ targetUrl: url }).passthrough().parse(data);
  if (kind === "TECHNICAL")
    z.object({
      category: z.enum(technicalCategories),
      severity: z.enum(["low", "medium", "high", "critical"]),
    })
      .passthrough()
      .parse(data);
  if (kind === "CONTENT") z.object({ title: text }).passthrough().parse(data);
}
const activity = z.object({
  kind: z.enum(["BACKLINK", "ON_PAGE", "TECHNICAL", "CONTENT"]),
  url,
  employeeId: z.string().optional(),
  data: z
    .record(z.unknown())
    .refine((d) => JSON.stringify(d).length <= 20000, "Activity too large"),
});
seoRouter.get(
  "/workspaces/:id/activities",
  wrap(async (req, res) => {
    const a = await scope(
      req.user!,
      req.params.id,
      req.query.kind === "BACKLINK" ? "seo.backlink.view" : "seo.report.view",
    );
    res.json(
      await prisma.seoActivity.findMany({
        where: {
          workspaceId: req.params.id,
          ...(!a.manager ? { employeeId: a.employeeId } : {}),
          ...(req.query.kind
            ? {
                kind: z
                  .enum(["BACKLINK", "ON_PAGE", "TECHNICAL", "CONTENT"])
                  .parse(req.query.kind),
              }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 500,
      }),
    );
  }),
);
seoRouter.post(
  "/workspaces/:id/activities",
  wrap(async (req, res) => {
    const body = activity.parse(req.body);
    const a = await scope(
      req.user!,
      req.params.id,
      body.kind === "BACKLINK"
        ? "seo.backlink.edit"
        : "worktrack.task.status.update",
    );
    const employeeId = body.employeeId || a.employeeId;
    if (!employeeId) throw new ApiError(400, "Employee profile required");
    if (employeeId !== a.employeeId) {
      await scope(req.user!, req.params.id, "worktrack.task.assign", true);
      await employeeAssigned(req.params.id, employeeId, company(req.user!));
    }
    validateActivity(body.kind, body.data);
    res.json(
      await prisma.seoActivity.create({
        data: {
          workspaceId: req.params.id,
          employeeId,
          kind: body.kind,
          url: body.url,
          data: body.data as any,
          history: [],
        },
      }),
    );
  }),
);
seoRouter.patch(
  "/workspaces/:id/activities/:activityId",
  wrap(async (req, res) => {
    const body = z
      .object({
        employeeId: z.string().optional(),
        status: z
          .enum([
            "PLANNED",
            "OUTREACH_SENT",
            "SUBMITTED",
            "LIVE",
            "LOST",
            "REJECTED",
            "IN_PROGRESS",
            "RESOLVED",
            "PUBLISHED",
          ])
          .optional(),
        verification: z.enum(["APPROVED", "REJECTED"]).optional(),
        data: z
          .record(z.unknown())
          .refine(
            (d) => JSON.stringify(d).length <= 20000,
            "Activity too large",
          )
          .optional(),
        reason: z.string().max(2000).default(""),
      })
      .parse(req.body);
    const a = await scope(
      req.user!,
      req.params.id,
      body.verification
        ? "worktrack.review.approve"
        : "worktrack.task.status.update",
      !!body.verification,
    );
    const row = await prisma.seoActivity.findFirst({
      where: { id: req.params.activityId, workspaceId: req.params.id },
    });
    if (!row) throw new ApiError(404, "Activity not found");
    if (!a.manager && row.employeeId !== a.employeeId)
      throw new ApiError(403, "Assigned employee required");
    if (body.employeeId) {
      await scope(req.user!, req.params.id, "worktrack.task.assign", true);
      await employeeAssigned(
        req.params.id,
        body.employeeId,
        company(req.user!),
      );
    }
    const responsible = body.employeeId || row.employeeId;
    if (body.verification && responsible === a.employeeId)
      throw new ApiError(403, "Independent verification required");
    if (body.verification === "APPROVED")
      await employeeAssigned(req.params.id, responsible, company(req.user!));
    if (body.data || body.verification === "APPROVED")
      validateActivity(row.kind, { ...(row.data as object), ...body.data });
    if (body.verification === "REJECTED" && !body.reason)
      throw new ApiError(400, "Rejection reason required");
    const history = [
      ...(Array.isArray(row.history) ? row.history : []),
      {
        at: new Date().toISOString(),
        userId: req.user!.id,
        before: {
          status: row.status,
          verification: row.verification,
          data: row.data,
        },
        reason: body.reason,
      },
    ];
    res.json(
      await prisma.seoActivity.update({
        where: { id: row.id },
        data: {
          employeeId: body.employeeId,
          status: body.status,
          ...(body.data
            ? { data: body.data as any, verification: "UNVERIFIED" }
            : {}),
          ...(body.verification
            ? {
                verification: body.verification,
                verifiedAt:
                  body.verification === "APPROVED" ? new Date() : null,
              }
            : { verification: "UNVERIFIED", verifiedAt: null }),
          history: history as any,
        },
      }),
    );
  }),
);
seoRouter.post(
  "/workspaces/:id/activities/:activityId/verify-link",
  limited,
  wrap(async (req, res) => {
    await scope(req.user!, req.params.id, "seo.backlink.edit", true);
    const row = await prisma.seoActivity.findFirst({
      where: {
        id: req.params.activityId,
        workspaceId: req.params.id,
        kind: "BACKLINK",
      },
    });
    if (!row) throw new ApiError(404, "Backlink not found");
    const data = row.data as Record<string, any>;
    let result;
    try {
      result = await verifyBacklink(row.url, url.parse(data.targetUrl));
    } catch {
      result = {
        result: "INCONCLUSIVE",
        checkedAt: new Date().toISOString(),
        attributes: [],
      };
    }
    await prisma.seoActivity.update({
      where: { id: row.id },
      data: { data: { ...data, linkCheck: result } },
    });
    res.json(result);
  }),
);
// Browser-only legacy sheets are never deleted or treated as Search Console data.
seoRouter.post(
  "/workspaces/:id/legacy-import",
  wrap(async (req, res) => {
    await scope(req.user!, req.params.id, "seo.ranking.edit", true);
    await scope(req.user!, req.params.id, "seo.backlink.edit", true);
    const body = z
      .object({
        sheetKey: z.string().max(500),
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        rankings: z
          .array(
            z
              .object({
                keyword: z.string(),
                currentRank: z.string(),
                rankingUrl: z.string(),
              })
              .passthrough(),
          )
          .max(5000),
        backlinks: z.array(z.record(z.unknown())).max(5000),
      })
      .parse(req.body);
    period(`${body.month}-01`, `${body.month}-01`);
    const sourceHash = hash(JSON.stringify(body));
    await prisma.$transaction(
      async (tx) => {
        await tx.seoLegacySheet.upsert({
          where: {
            workspaceId_sourceHash: { workspaceId: req.params.id, sourceHash },
          },
          create: {
            workspaceId: req.params.id,
            sheetKey: body.sheetKey,
            sourceHash,
            payload: body as any,
            importedBy: req.user!.id,
          },
          update: {},
        });
        for (const row of body.rankings) {
          if (!row.keyword.trim() || !url.safeParse(row.rankingUrl).success)
            continue;
          const identityHash = keywordIdentity(
            row.keyword,
            row.rankingUrl,
            "",
            "",
          );
          const k = await tx.seoKeyword.upsert({
            where: {
              workspaceId_identityHash: {
                workspaceId: req.params.id,
                identityHash,
              },
            },
            create: {
              workspaceId: req.params.id,
              identityHash,
              keyword: row.keyword.trim(),
              targetUrl: row.rankingUrl,
            },
            update: {},
          });
          const position = Number(row.currentRank);
          if (row.currentRank.trim() && position > 0 && position < 10000)
            await tx.seoRanking.upsert({
              where: {
                keywordId_date_source: {
                  keywordId: k.id,
                  date: dateValue(`${body.month}-01`),
                  source: "LEGACY_MONTHLY_MANUAL",
                },
              },
              create: {
                keywordId: k.id,
                date: dateValue(`${body.month}-01`),
                source: "LEGACY_MONTHLY_MANUAL",
                position,
              },
              update: {},
            });
        }
        for (const [index, row] of body.backlinks.entries()) {
          const source = String(row.backlink || row.link || "");
          if (!url.safeParse(source).success) continue;
          const legacyId = `legacy-${hash(JSON.stringify([req.params.id, body.sheetKey, index, source])).slice(0, 24)}`;
          await tx.seoActivity.upsert({
            where: { id: legacyId },
            create: {
              id: legacyId,
              workspaceId: req.params.id,
              employeeId: "LEGACY_UNATTRIBUTED",
              kind: "BACKLINK",
              url: source,
              status: "SUBMITTED",
              verification: "UNVERIFIED",
              data: { ...row, legacySheet: body.sheetKey },
              history: [],
            },
            update: {},
          });
        }
      },
      { timeout: 60000 },
    );
    res.json({
      archived: true,
      message:
        "Original rows archived. Valid target URLs and manual monthly ranks imported; backlinks require attribution and verification.",
    });
  }),
);
seoRouter.get(
  "/workspaces/:id/legacy-sheets",
  wrap(async (req, res) => {
    await scope(req.user!, req.params.id, "seo.report.view", true);
    res.json(
      await prisma.seoLegacySheet.findMany({
        where: { workspaceId: req.params.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
  }),
);
seoRouter.get(
  "/points",
  wrap(async (req, res) => {
    if (!admin(req.user!)) throw new ApiError(403, "Administrator required");
    res.json(
      await prisma.seoPointRule.findMany({
        where: { companyId: company(req.user!) },
      }),
    );
  }),
);
seoRouter.put(
  "/points",
  wrap(async (req, res) => {
    if (!admin(req.user!)) throw new ApiError(403, "Administrator required");
    const body = z
      .object({
        category: z.enum(categories),
        quantity: z.number().positive().max(100000),
        points: z.number().nonnegative().max(10000),
      })
      .parse(req.body);
    res.json(
      await prisma.seoPointRule.upsert({
        where: {
          companyId_category: {
            companyId: company(req.user!),
            category: body.category,
          },
        },
        create: { companyId: company(req.user!), ...body },
        update: body,
      }),
    );
  }),
);
seoRouter.post(
  "/insights",
  limited,
  wrap(async (req, res) => {
    const u = req.user!;
    const r = range(req);
    const { question } = z.object({ question: text }).parse(req.body);
    const employee = await prisma.employee.findFirst({
      where: { userId: u.id, companyId: company(u) },
      select: { id: true },
    });
    const candidates = await prisma.seoWorkspace.findMany({
      where: {
        companyId: company(u),
        ...(!admin(u)
          ? { members: { some: { employeeId: employee?.id || "__none__" } } }
          : {}),
      },
      include: { client: { select: { name: true } } },
      take: 50,
    });
    const clients = [];
    for (const w of candidates) {
      let a;
      try {
        a = await scope(u, w.id);
      } catch {
        continue;
      }
      const data = await analytics(
        w.id,
        r.start,
        r.end,
        a.manager ? undefined : a.employeeId,
      );
      clients.push({
        client: w.client.name,
        period: data.period,
        totals: data.totals,
        previous: data.previous,
        work: data.work,
        topQueries: data.queries.slice(0, 10),
        topPages: data.pages.slice(0, 10),
        tasks: data.tasks.slice(0, 30).map((t) => ({
          employeeId: t.employeeId,
          category: t.category,
          status: t.status,
          completedQuantity: t.completedQuantity,
          points: t.points,
        })),
        unresolvedIssues: data.activities
          .filter(
            (a) => a.kind === "TECHNICAL" && a.verification !== "APPROVED",
          )
          .slice(0, 20)
          .map((a) => ({ url: a.url, status: a.status, data: a.data })),
      });
    }
    res.json(
      await insight(
        {
          clients,
          coverage:
            "At most 50 permitted clients; work belongs to the employee unless they are a client head. Search Console query/page data is incomplete and average positions are not exact rankings.",
        },
        question,
      ),
    );
  }),
);
seoRouter.post(
  "/workspaces/:id/insights",
  limited,
  wrap(async (req, res) => {
    const a = await scope(req.user!, req.params.id);
    const r = range(req);
    const { question } = z.object({ question: text }).parse(req.body);
    const snapshot = await analytics(
      req.params.id,
      r.start,
      r.end,
      a.manager ? undefined : a.employeeId,
    );
    res.json(await insight(snapshot, question));
  }),
);
seoRouter.get(
  "/workspaces/:id/sitemaps",
  limited,
  wrap(async (req, res) => {
    const a = await scope(req.user!, req.params.id);
    const p = a.workspace.property;
    if (!p) throw new ApiError(409, "Connect a Search Console property first");
    res.json(
      await google(
        p.connectionId,
        `/sites/${encodeURIComponent(p.siteUrl)}/sitemaps`,
      ),
    );
  }),
);
seoRouter.post(
  "/workspaces/:id/inspect",
  limited,
  wrap(async (req, res) => {
    const a = await scope(req.user!, req.params.id);
    const p = a.workspace.property;
    if (!p) throw new ApiError(409, "Connect a Search Console property first");
    const { inspectionUrl } = z.object({ inspectionUrl: url }).parse(req.body);
    const target = new URL(inspectionUrl);
    const property = p.siteUrl;
    if (
      property.startsWith("sc-domain:")
        ? !(
            target.hostname === property.slice(10) ||
            target.hostname.endsWith(`.${property.slice(10)}`)
          )
        : !(
            target.origin === new URL(property).origin &&
            target.pathname.startsWith(new URL(property).pathname)
          )
    )
      throw new ApiError(400, "URL must belong to this property");
    res.json(
      await google(
        p.connectionId,
        "",
        { inspectionUrl, siteUrl: property },
        true,
      ),
    );
  }),
);
seoRouter.get(
  "/workspaces/:id/reports",
  wrap(async (req, res) => {
    await scope(req.user!, req.params.id, "seo.report.view", true);
    res.json(
      await prisma.seoReport.findMany({
        where: { workspaceId: req.params.id },
        orderBy: { month: "desc" },
        take: 100,
      }),
    );
  }),
);
export async function generateReport(
  workspaceId: string,
  month: string,
  userId: string,
) {
  const start = `${month}-01`,
    end = day(
      new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      ),
    );
  period(start, end);
  const snapshot = await analytics(workspaceId, start, end);
  const previousEnd = day(new Date(+dateValue(start) - 86400000));
  const previousStart = `${previousEnd.slice(0, 7)}-01`;
  const previous = await analytics(workspaceId, previousStart, previousEnd);
  const keywordChanges = snapshot.queries.flatMap((q) => {
    const old = previous.queries.find(
      (p) => p.label.toLowerCase() === q.label.toLowerCase(),
    );
    return old?.position != null && q.position != null
      ? [
          {
            keyword: q.label,
            previous: old.position,
            current: q.position,
            change: old.position - q.position,
          },
        ]
      : [];
  });
  const fullSnapshot = {
    ...snapshot,
    previous: previous.totals,
    period: { ...snapshot.period, previousStart, previousEnd },
    keywordChanges,
  };
  const ai = await insight(
    fullSnapshot,
    "Summarize the reporting month and recommend next-month SEO activities.",
  );
  return prisma.seoReport.upsert({
    where: { workspaceId_month: { workspaceId, month } },
    create: {
      workspaceId,
      month,
      snapshot: JSON.parse(JSON.stringify(fullSnapshot)),
      summary: ai.text,
      generatedBy: userId,
    },
    update: {
      snapshot: JSON.parse(JSON.stringify(fullSnapshot)),
      summary: ai.text,
      generatedBy: userId,
      createdAt: new Date(),
    },
  });
}
seoRouter.post(
  "/workspaces/:id/reports",
  limited,
  wrap(async (req, res) => {
    await scope(req.user!, req.params.id, "seo.report.view", true);
    const { month } = z
      .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
      .parse(req.body);
    if (month >= day(new Date()).slice(0, 7))
      throw new ApiError(400, "Choose a completed month");
    res.json(await generateReport(req.params.id, month, req.user!.id));
  }),
);
seoRouter.get(
  "/workspaces/:id/reports/:reportId/pdf",
  wrap(async (req, res) => {
    const a = await scope(req.user!, req.params.id, "seo.report.view", true);
    const report = await prisma.seoReport.findFirst({
      where: { id: req.params.reportId, workspaceId: req.params.id },
    });
    if (!report) throw new ApiError(404, "Report not found");
    res.type("application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="seo-${report.month}.pdf"`,
    );
    renderSeoReport(a.workspace.client.name, {
      month: report.month,
      snapshot: report.snapshot,
      summary: report.summary,
    }).pipe(res);
  }),
);
