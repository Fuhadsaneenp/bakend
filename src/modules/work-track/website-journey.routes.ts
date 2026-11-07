import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, text } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { admin, company, scope } from "../seo/seo.access.js";

const connectionSchema = z.object({
  origin: z.string().url().max(250).transform(value => new URL(value)).refine(url =>
    url.protocol === "https:" && !url.username && !url.password && url.href === url.origin + "/",
    "Enter the HTTPS website origin"
  ).transform(url => url.origin),
  projectId: z.string().regex(/^[a-z0-9_-]{1,64}$/i),
  token: z.string().trim().min(1).max(4096).optional()
});
const identifier = z.string().regex(/^[a-z0-9_-]{1,64}$/i);
const eventSchema = z.object({
  visitor: z.string().uuid(),
  session: z.string().uuid(),
  path: z.string().max(500).regex(/^\/(?!\/)[^?#]*$/),
  source: z.string().max(253).regex(/^[a-z0-9.-]*$/i),
  device: z.enum(["Mobile", "Desktop", "Tablet"]),
  playback: z.object({ projectId: identifier, userId: identifier, sessionId: identifier }).optional()
});

type Connection = {
  origin: string;
  projectId: string;
  collectorId: string;
  encryptedToken?: string;
};

const encryptionKey = () => createHash("sha256").update("website-journey-token:").update(env.JWT_ACCESS_SECRET).digest();
function seal(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  return Buffer.concat([iv, cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
function unseal(value: string) {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
}

const connectionKey = (clientId: string) => `website-journey:client:${clientId}`;
const collectorKey = (id: string) => `website-journey:collector:${id}`;
const eventNamespace = "website-journey:event:";
const eventPrefix = (id: string) => `${eventNamespace}${id}:`;
const windowStart = () => new Date(Date.now() - 30 * 86400000);
let nextCleanup = 0;

function pruneExpiredVisits() {
  if (Date.now() < nextCleanup) return;
  nextCleanup = Date.now() + 3600000;
  void prisma.$executeRaw`
    DELETE FROM CompanySetting
    WHERE CAST(\`key\` AS BINARY) LIKE CAST(${eventNamespace + "%"} AS BINARY)
      AND createdAt < ${windowStart()}
  `.catch(() => { nextCleanup = Date.now() + 60000; });
}
const getConnection = async (companyId: string, clientId: string) => {
  const row = await prisma.companySetting.findUnique({
    where: { companyId_key: { companyId, key: connectionKey(clientId) } }
  });
  return row?.value as Connection | undefined;
};

const publicConnection = (connection?: Connection) => connection ? {
  origin: connection.origin,
  projectId: connection.projectId,
  collectorId: connection.collectorId,
  hasToken: Boolean(connection.encryptedToken)
} : null;

export const websiteJourneyCollector = Router();
websiteJourneyCollector.post("/:collectorId",
  rateLimit({ windowMs: 60000, limit: 120 }),
  text({ type: "text/plain", limit: "4kb" }),
  async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.collectorId);
      const origin = req.get("origin");
      if (!origin || typeof req.body !== "string") return res.sendStatus(400);
      const row = await prisma.companySetting.findUnique({ where: { id } });
      if (!row || row.key !== collectorKey(id) || (row.value as { origin?: string }).origin !== origin) return res.sendStatus(403);
      let payload: unknown;
      try { payload = JSON.parse(req.body); } catch { return res.sendStatus(400); }
      const event = eventSchema.parse(payload);
      const projectId = (row.value as { projectId?: string }).projectId;
      if (event.playback?.projectId !== projectId) delete event.playback;
      const key = eventPrefix(id) + randomBytes(12).toString("hex");
      await prisma.companySetting.create({ data: { companyId: row.companyId, key, value: event } });
      pruneExpiredVisits();
      res.sendStatus(204);
    } catch (error) {
      if (error instanceof z.ZodError) return res.sendStatus(400);
      next(error);
    }
  }
);

export const websiteJourneyRouter = Router();
const insightsSchema = z.array(z.object({
  metricName: z.string(),
  information: z.array(z.record(z.unknown()))
}));
const insights = new Map<string, { expires: number; request: Promise<z.infer<typeof insightsSchema>> }>();

websiteJourneyRouter.get("/:workspaceId", async (req, res, next) => {
  try {
    const user = req.user!;
    const companyId = company(user);
    const { workspace: { clientId } } = await scope(user, identifier.parse(req.params.workspaceId));
    const connection = await getConnection(companyId, clientId);
    if (!connection) return res.json({ connection: null, events: [] });
    pruneExpiredVisits();
    const start = windowStart();
    const matching = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM CompanySetting
      WHERE companyId = ${companyId}
        AND CAST(\`key\` AS BINARY) LIKE CAST(${eventPrefix(connection.collectorId) + "%"} AS BINARY)
        AND createdAt >= ${start}
      ORDER BY createdAt DESC LIMIT 5000
    `;
    const events = await prisma.companySetting.findMany({
      where: { companyId, id: { in: matching.map(event => event.id) } },
      orderBy: { createdAt: "desc" },
      select: { id: true, value: true, createdAt: true }
    });
    res.json({
      connection: publicConnection(connection),
      events: events.map(event => ({
        ...eventSchema.parse(event.value),
        id: event.id,
        at: event.createdAt
      })),
      limited: events.length === 5000
    });
  } catch (error) { next(error); }
});

websiteJourneyRouter.put("/:workspaceId", async (req, res, next) => {
  try {
    const user = req.user!;
    const companyId = company(user);
    const { workspace: { clientId } } = await scope(user, identifier.parse(req.params.workspaceId));
    if (!admin(user)) throw new ApiError(403, "SEO administrator required");
    const input = connectionSchema.parse(req.body);
    const existing = await getConnection(companyId, clientId);
    const sameWebsite = existing?.origin === input.origin && existing.projectId === input.projectId;
    const collectorId = sameWebsite ? existing.collectorId : randomUUID();
    const encryptedToken = input.token ? seal(input.token) : sameWebsite ? existing.encryptedToken : undefined;
    const value = { origin: input.origin, projectId: input.projectId, collectorId, ...(encryptedToken && { encryptedToken }) };
    const key = connectionKey(clientId);
    await prisma.$transaction(async tx => {
      await tx.companySetting.upsert({ where: { companyId_key: { companyId, key } }, create: { companyId, key, value }, update: { value } });
      const publicKey = collectorKey(collectorId);
      const collector = { origin: input.origin, projectId: input.projectId };
      await tx.companySetting.upsert({
        where: { companyId_key: { companyId, key: publicKey } },
        create: { id: collectorId, companyId, key: publicKey, value: collector },
        update: { value: collector }
      });
      if (existing && !sameWebsite) {
        await tx.companySetting.deleteMany({ where: { companyId, key: collectorKey(existing.collectorId) } });
      }
    });
    insights.delete(`${companyId}:${clientId}`);
    res.json(publicConnection(value));
  } catch (error) { next(error); }
});

websiteJourneyRouter.get("/:workspaceId/clarity", async (req, res, next) => {
  try {
    const user = req.user!;
    const companyId = company(user);
    const { workspace: { clientId } } = await scope(user, identifier.parse(req.params.workspaceId));
    const connection = await getConnection(companyId, clientId);
    if (!connection?.encryptedToken) throw new ApiError(404, "Add a Clarity API token in settings");
    const key = `${companyId}:${clientId}`;
    let cached = insights.get(key);
    if (!cached || cached.expires <= Date.now()) {
      for (const [id, entry] of insights) if (entry.expires <= Date.now()) insights.delete(id);
      const token = unseal(connection.encryptedToken);
      const request = fetch("https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
        redirect: "error"
      }).then(async response => {
        if (!response.ok) throw new ApiError(502, `Clarity returned HTTP ${response.status}`);
        return insightsSchema.parse(await response.json());
      }).catch(error => {
        const entry = insights.get(key);
        if (entry?.request === request) entry.expires = Date.now() + 15 * 60000;
        if (error instanceof ApiError) throw error;
        throw new ApiError(502, "Clarity could not be reached");
      });
      cached = { expires: Date.now() + 3 * 3600000, request };
      insights.set(key, cached);
    }
    res.json(await cached.request);
  } catch (error) { next(error); }
});
