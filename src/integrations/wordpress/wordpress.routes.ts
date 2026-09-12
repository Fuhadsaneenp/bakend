import { Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { accessResolverService } from "../../modules/authority/access-resolver.service.js";
import { scopeResolverService } from "../../modules/authority/scope-resolver.service.js";
import { workTrackService } from "../../modules/work-track/work-track.service.js";

export const wordpressRouter = Router();
const prefix = "wordpress_upload_v1_";
const webUrl = z.string().url().refine(v => /^https?:\/\//i.test(v));
const uploadSchema = z.object({
  postId: z.number().int().positive(),
  type: z.enum(["job", "company"]),
  uploaderEmail: z.string().email(),
  uploaderId: z.number().int().positive(),
  title: z.string().max(1000),
  url: webUrl,
  companyName: z.string().max(1000),
  companyUrl: z.union([webUrl, z.literal("")]),
  categories: z.array(z.string().max(200)).max(50),
  location: z.string().max(1000),
  status: z.string().max(80),
  uploadedAt: z.string(),
  updatedAt: z.string()
});

const normalizeHost = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const defaultSites: Record<string, { url: string; brand: string; companyId: string; secret: string }> = {
  trikonet: {
    url: "https://www.trikonet.com",
    brand: "Trikonet",
    companyId: "cmrtjclxz004eun4zjp7rtcbo",
    secret: "trikonet_superio_sync_sec_8841fa729c40b83e102f48e6"
  },
  medbiomate: {
    url: "https://www.medbiomate.com",
    brand: "Medbiomate",
    companyId: "cmrtjclxz004eun4zjp7rtcbo",
    secret: "medbiomate_superio_sync_sec_9971abf83c18b76e204b33c5"
  },
  secondtales: {
    url: "https://www.secondtales.com",
    brand: "Second Tales",
    companyId: "cmrtifqe00002ty4zqy0vdpsr",
    secret: "secondtales_superio_sync_sec_1038bca8741e9bca992101df"
  }
};

// Each site gets a separate secret and tenant binding. Never trust a tenant from the payload.
wordpressRouter.post("/:site/uploads", async (req, res, next) => {
  try {
    let envSites: Record<string, any> = {};
    try {
      envSites = JSON.parse(process.env.WORDPRESS_SYNC_SITES || "{}");
    } catch {
      envSites = {};
    }
    const sites = { ...defaultSites, ...envSites };
    const site = Object.hasOwn(sites, req.params.site) ? sites[req.params.site] : null;
    const token = req.get("authorization")?.replace(/^Bearer /, "") || "";
    const hash = (v: string) => createHash("sha256").update(v).digest();

    if (!site?.secret || site.secret.length < 32 || !token || !timingSafeEqual(hash(token), hash(site.secret))) {
      throw new ApiError(401, "Invalid WordPress connection credentials");
    }

    const input = uploadSchema.parse(req.body);

    const incomingHost = normalizeHost(input.url);
    const configuredHost = normalizeHost(site.url);
    if (incomingHost && configuredHost && incomingHost !== configuredHost) {
      throw new ApiError(400, `Unexpected site URL origin (${incomingHost} does not match configured ${configuredHost})`);
    }

    const uploaderEmail = input.uploaderEmail.trim().toLowerCase();

    // 1. Check User by email in site company first, then fallback to any active company
    let user = await prisma.user.findFirst({
      where: {
        companyId: site.companyId,
        email: { equals: uploaderEmail },
        isActive: true
      },
      include: { employee: true }
    });

    if (!user?.employee) {
      user = await prisma.user.findFirst({
        where: {
          email: { equals: uploaderEmail },
          isActive: true
        },
        include: { employee: true }
      });
    }

    let employee = user?.employee;

    // 2. Fallback: Check Employee by personalEmail
    if (!employee) {
      employee = await prisma.employee.findFirst({
        where: {
          personalEmail: { equals: uploaderEmail },
          status: "ACTIVE"
        },
        include: { user: true }
      });
    }

    if (!employee) {
      throw new ApiError(422, `Uploader email (${input.uploaderEmail}) is not linked to an active employee profile`);
    }

    const key = prefix + createHash("sha256").update(`${req.params.site}:${input.type}:${input.postId}`).digest("hex");
    const name = [employee.firstName, employee.lastName].filter(Boolean).join(" ");
    const value = {
      ...input,
      employeeId: employee.id,
      employeeName: name,
      brand: site.brand,
      site: req.params.site
    };

    // Save under both the employee company and the site company so it appears seamlessly in Work Track
    const targetCompanies = Array.from(new Set([employee.companyId, site.companyId].filter(Boolean)));
    for (const cId of targetCompanies) {
      await prisma.companySetting.upsert({
        where: { companyId_key: { companyId: cId, key } },
        create: { companyId: cId, key, value },
        update: { value }
      });
    }

    // Direct sync into Data Entry spreadsheet rows so it appears immediately in the employee's table
    try {
      const brand = site.brand || "Trikonet";
      const subSheet = input.type === "job" ? "Jobs" : "Employer";
      const uploadDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(input.uploadedAt || Date.now()));

      const memberKey = `${brand}-${subSheet}-${uploadDate}-${employee.id}`;
      const companyKey = `${brand}-${subSheet}-${uploadDate}`;
      const primaryCompanyId = employee.companyId || site.companyId;

      const currentSheets = await workTrackService.getDataEntrySheets(primaryCompanyId);

      const insertOrUpdateRow = (rows: any[] = []) => {
        const nextRows = Array.isArray(rows) ? [...rows] : [];
        const existingIdx = nextRows.findIndex(
          r => r && (r.sourceUrl === input.url || (r.postId && r.postId === input.postId))
        );

        let resolvedCompanyName = (input.companyName || "").trim();
        if (resolvedCompanyName.toLowerCase() === "nmc") {
          resolvedCompanyName = "NMC Healthcare";
        }

        const rowData = {
          count: existingIdx >= 0 ? (nextRows[existingIdx]?.count || existingIdx + 1) : nextRows.length + 1,
          companyName: resolvedCompanyName,
          jobCount: 1,
          category: input.categories[0] || "",
          sourceUrl: input.url,
          status: input.status === "publish" ? "Uploaded" : "Not Uploaded",
          jobTitle: input.title,
          notes: input.title,
          postId: input.postId,
          uploadedAt: input.uploadedAt,
          uploadedBy: name,
          updatedAt: input.updatedAt,
          date: uploadDate
        };

        if (existingIdx >= 0) {
          nextRows[existingIdx] = { ...nextRows[existingIdx], ...rowData };
        } else {
          const emptyIdx = nextRows.findIndex(r => !r || (!r.companyName && !r.sourceUrl));
          if (emptyIdx >= 0) {
            nextRows[emptyIdx] = { ...rowData, count: emptyIdx + 1 };
          } else {
            nextRows.push(rowData);
          }
        }
        return nextRows;
      };

      const updatedMemberRows = insertOrUpdateRow(currentSheets[memberKey] || []);
      const updatedCompanyRows = insertOrUpdateRow(currentSheets[companyKey] || []);

      await workTrackService.upsertDataEntrySheets(primaryCompanyId, {
        [memberKey]: updatedMemberRows,
        [companyKey]: updatedCompanyRows
      });
    } catch (sheetSyncErr) {
      console.error("Failed to sync row directly into data entry sheet table:", sheetSyncErr);
    }

    res.json({ synced: true, employeeId: employee.id, employeeName: name });
  } catch (error) {
    next(error);
  }
});

wordpressRouter.get("/uploads", requireAuth, async (req, res, next) => {
  try {
    if (!req.user?.companyId) throw new ApiError(400, "Company context required");

    const settings = await prisma.companySetting.findMany({
      where: { key: { startsWith: prefix } },
      orderBy: { updatedAt: "desc" }
    });

    const isSuperAdminOrHr = req.user.role === "SUPER_ADMIN" || req.user.role === "HR_ADMIN";
    const actor = await accessResolverService.getUserAccessContext(req.user.id);
    const uploads = [];

    for (const setting of settings) {
      const row = setting.value as Record<string, any>;
      const scope = {
        companyId: req.user.companyId,
        employeeId: row.employeeId,
        assignedToEmployeeId: row.employeeId
      };

      if (
        isSuperAdminOrHr ||
        actor.employee?.id === row.employeeId ||
        (await scopeResolverService.canAccess(actor, "data_entry.task.view", scope)) ||
        (await scopeResolverService.canAccess(actor, "worktrack.task.view", scope))
      ) {
        uploads.push({ id: setting.key, ...row });
      }
    }

    res.json({ uploads });
  } catch (error) {
    next(error);
  }
});
