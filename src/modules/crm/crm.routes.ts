import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { crmService } from "./crm.service.js";

export const crmRouter = Router();

crmRouter.use(requireAuth);

crmRouter.get("/data", async (req, res, next) => {
  try {
    const data = await crmService.getCrmData(req.user?.companyId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

crmRouter.put("/data", async (req, res, next) => {
  try {
    const data = await crmService.saveCrmData(req.user?.companyId, req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
});
