import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../../middleware/auth.js";
import { permissionService } from "../authority/permission.service.js";
import { ApiError } from "../../lib/errors.js";
import { begin, callback, company, disconnect, isAdmin, report, sharedReportCompany, sync } from "./adsense.service.js";
export const adsenseRouter = Router();
export const adsenseDestination = (website?: string) => `${process.env.APP_ORIGIN || "https://stems.secondtales.com"}/work-track?track=data-entry&tab=adsense-daily-views${website ? `&website=${encodeURIComponent(website)}` : ""}`;
adsenseRouter.get("/google/callback", async (req, res) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  try { const website = await callback(z.string().min(20).parse(req.query.state), z.string().min(1).parse(req.query.code)); res.redirect(adsenseDestination(website) + "&adsense=connected"); }
  catch { res.redirect(adsenseDestination() + "&adsense=failed"); }
});
adsenseRouter.use(requireAuth);
adsenseRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const limited = rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
const query = z.object({ website: z.enum(["trikonet.com", "medbiomate.com"]).default("trikonet.com"), start: z.string().optional(), end: z.string().optional() }).refine(q => !!q.start === !!q.end, "Provide both dates");
adsenseRouter.get("/report", async (req, res, next) => {
  try {
    if (!isAdmin(req.user!)) await permissionService.requirePermission(req.user!.id, "adsense.views.view", { companyId: company(req.user!) });
    const q = query.parse(req.query);
    const reportCompany = !isAdmin(req.user!) ? await sharedReportCompany(company(req.user!), q.website) : company(req.user!);
    res.json({ ...await report(reportCompany, q.website, q.start && q.end ? { start: q.start, end: q.end } : undefined), canManage: isAdmin(req.user!) });
  } catch (error) { next(error); }
});
adsenseRouter.use((req, _res, next) => { if (!isAdmin(req.user!)) return next(new ApiError(403, "Administrator required")); next(); });
adsenseRouter.post("/connect", limited, async (req, res, next) => { try { if (!req.body?.website) throw new ApiError(409, "This page is out of date. Reload STEMS, select your website, then connect again."); const body = z.object({ website: z.enum(["trikonet.com", "medbiomate.com"]) }).parse(req.body); res.json(await begin(req.user!, body.website)); } catch (error) { next(error); } });
adsenseRouter.delete("/connection", limited, async (req, res, next) => { try { const q = z.object({ website: z.enum(["trikonet.com", "medbiomate.com"]) }).parse(req.query); await disconnect(company(req.user!), q.website); res.json({ disconnected: true }); } catch (error) { next(error); } });
adsenseRouter.post("/refresh", limited, async (req, res, next) => {
  try { if (!req.body?.website) throw new ApiError(409, "This page is out of date. Reload STEMS, select your website, then refresh again."); const body = z.object({ website: z.enum(["trikonet.com", "medbiomate.com"]), start: z.string().optional(), end: z.string().optional() }).refine(b => !!b.start === !!b.end).parse(req.body || {}); await sync(company(req.user!), body.start && body.end ? { start: body.start, end: body.end } : undefined, body.website); res.json({ synced: true }); } catch (error) { next(error); }
});
