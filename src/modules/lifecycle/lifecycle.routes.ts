import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { lifecycleService } from "./lifecycle.service.js";
import { prisma } from "../../lib/prisma.js";

export const lifecycleRouter = Router();
lifecycleRouter.use(requireAuth);

async function getEmployee(userId: string) {
  const employee = await prisma.employee.findUnique({ where: { userId } });
  if (!employee) throw new ApiError(404, "Employee profile not found");
  return employee;
}

// -------------------------------------------------------------
// Templates
// -------------------------------------------------------------
lifecycleRouter.get("/templates", async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const type = req.query.type as "ONBOARDING" | "EXIT" | undefined;
    const templates = await lifecycleService.getTemplates(companyId, type);
    res.json(templates);
  } catch (error) {
    next(error);
  }
});

lifecycleRouter.post("/templates", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      title: z.string().min(1),
      type: z.enum(["ONBOARDING", "EXIT"]),
      tasks: z.array(
        z.object({
          title: z.string().min(1),
          description: z.string().optional(),
          assignedRole: z.string().min(1)
        })
      )
    }).parse(req.body);

    const template = await lifecycleService.createTemplate(companyId, body.title, body.type, body.tasks);
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
});

lifecycleRouter.delete("/templates/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    await lifecycleService.deleteTemplate(companyId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Checklists
// -------------------------------------------------------------
lifecycleRouter.get("/checklists", async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");

    if (req.user.role === Role.SUPER_ADMIN || req.user.role === Role.HR_ADMIN || req.user.role === Role.MANAGER) {
      const checklists = await lifecycleService.getActiveChecklists(companyId);
      return res.json(checklists);
    }

    const emp = await getEmployee(req.user.id);
    const checklists = await lifecycleService.getEmployeeChecklists(emp.id);
    res.json(checklists);
  } catch (error) {
    next(error);
  }
});

lifecycleRouter.post("/checklists", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      employeeId: z.string().min(1),
      templateId: z.string().min(1)
    }).parse(req.body);

    const checklist = await lifecycleService.instantiateChecklist(companyId, body.employeeId, body.templateId);
    res.status(201).json(checklist);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Assigned tasks & Item Checklist actions
// -------------------------------------------------------------
lifecycleRouter.get("/items/assigned", async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const roleParam = req.query.role || "HR";
    const tasks = await lifecycleService.getAssignedTasks(companyId, String(roleParam));
    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

lifecycleRouter.patch("/items/:itemId", async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const emp = await getEmployee(req.user.id);

    const body = z.object({
      status: z.enum(["PENDING", "COMPLETED"])
    }).parse(req.body);

    const updated = await lifecycleService.updateChecklistItemStatus(
      companyId,
      req.params.itemId,
      body.status,
      emp.id
    );
    res.json(updated);
  } catch (error) {
    next(error);
  }
});
