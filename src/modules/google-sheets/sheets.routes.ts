import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import * as sheets from "./sheets.service.js";
export const googleSheetsRouter = Router();
const wrap = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
googleSheetsRouter.get(
  "/callback",
  wrap(async (req: any, res: any) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      await sheets.callback(
        z.string().parse(req.query.state),
        z.string().min(1).parse(req.query.code),
      );
      res.redirect(sheets.destination("connected"));
    } catch {
      res.redirect(sheets.destination("failed"));
    }
  }),
);
googleSheetsRouter.use(requireAuth);
googleSheetsRouter.get(
  "/",
  wrap(async (req: any, res: any) => res.json(await sheets.status(req.user))),
);
googleSheetsRouter.post(
  "/authorize",
  wrap(async (req: any, res: any) => res.json(await sheets.begin(req.user))),
);
googleSheetsRouter.post(
  "/inspect",
  wrap(async (req: any, res: any) =>
    res.json(
      await sheets.inspect(
        req.user,
        z.object({ url: z.string().max(1000) }).parse(req.body).url,
      ),
    ),
  ),
);
googleSheetsRouter.put(
  "/selection",
  wrap(async (req: any, res: any) => {
    const data = z
      .object({
        url: z.string().max(1000),
        worksheetId: z.number().int().nonnegative(),
        direction: z.enum(["two-way", "import", "export"]),
      })
      .parse(req.body);
    res.json(
      await sheets.select(req.user, data.url, data.worksheetId, data.direction),
    );
  }),
);
googleSheetsRouter.delete(
  "/",
  wrap(async (req: any, res: any) =>
    res.json(await sheets.disconnect(req.user)),
  ),
);
