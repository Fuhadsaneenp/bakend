import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { performanceService } from "./performance.service.js";
import { prisma } from "../../lib/prisma.js";

export const performanceRouter = Router();
performanceRouter.use(requireAuth);

// Helper to resolve employee profile
async function getEmployee(userId: string) {
  const employee = await prisma.employee.findUnique({ where: { userId } });
  if (!employee) throw new ApiError(404, "Employee profile not found");
  return employee;
}

// -------------------------------------------------------------
// Appraisal Cycles
// -------------------------------------------------------------
performanceRouter.get("/cycles", async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const cycles = await performanceService.getAppraisalCycles(companyId);
    res.json(cycles);
  } catch (error) {
    next(error);
  }
});

performanceRouter.post("/cycles", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      title: z.string().min(1),
      startDate: z.coerce.date(),
      endDate: z.coerce.date()
    }).parse(req.body);

    const cycle = await performanceService.createAppraisalCycle(companyId, body.title, body.startDate, body.endDate);
    res.status(201).json(cycle);
  } catch (error) {
    next(error);
  }
});

performanceRouter.patch("/cycles/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const body = z.object({
      status: z.enum(["DRAFT", "ACTIVE", "COMPLETED"])
    }).parse(req.body);

    const cycle = await performanceService.updateAppraisalCycleStatus(companyId, req.params.id, body.status);
    res.json(cycle);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Key Result Areas (KRAs)
// -------------------------------------------------------------
performanceRouter.get("/kras", async (req: any, res, next) => {
  try {
    const employeeId = req.query.employeeId;
    let targetEmployeeId: string;

    if (employeeId && (req.user.role === Role.SUPER_ADMIN || req.user.role === Role.HR_ADMIN || req.user.role === Role.MANAGER)) {
      targetEmployeeId = String(employeeId);
    } else {
      const emp = await getEmployee(req.user.id);
      targetEmployeeId = emp.id;
    }

    const kras = await performanceService.getEmployeeKRAs(targetEmployeeId);
    res.json(kras);
  } catch (error) {
    next(error);
  }
});

performanceRouter.post("/kras", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req: any, res, next) => {
  try {
    const body = z.object({
      employeeId: z.string().min(1),
      title: z.string().min(1),
      weightage: z.number().min(0).max(100),
      description: z.string().optional()
    }).parse(req.body);

    const kra = await performanceService.createKRA(body.employeeId, body.title, body.weightage, body.description);
    res.status(201).json(kra);
  } catch (error) {
    next(error);
  }
});

performanceRouter.delete("/kras/:id", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req: any, res, next) => {
  try {
    const employeeId = req.query.employeeId;
    if (!employeeId) throw new ApiError(400, "employeeId query param required");
    await performanceService.deleteKRA(String(employeeId), req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Goals
// -------------------------------------------------------------
performanceRouter.get("/goals", async (req: any, res, next) => {
  try {
    const employeeId = req.query.employeeId;
    let targetEmployeeId: string;

    if (employeeId && (req.user.role === Role.SUPER_ADMIN || req.user.role === Role.HR_ADMIN || req.user.role === Role.MANAGER)) {
      targetEmployeeId = String(employeeId);
    } else {
      const emp = await getEmployee(req.user.id);
      targetEmployeeId = emp.id;
    }

    const goals = await performanceService.getEmployeeGoals(targetEmployeeId);
    res.json(goals);
  } catch (error) {
    next(error);
  }
});

performanceRouter.post("/goals", async (req: any, res, next) => {
  try {
    const emp = await getEmployee(req.user.id);
    const body = z.object({
      title: z.string().min(1),
      target: z.number().min(0),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      description: z.string().optional(),
      kraId: z.string().optional()
    }).parse(req.body);

    const goal = await performanceService.createGoal(
      emp.id,
      body.title,
      body.target,
      body.startDate,
      body.endDate,
      body.description,
      body.kraId
    );
    res.status(201).json(goal);
  } catch (error) {
    next(error);
  }
});

performanceRouter.patch("/goals/:id", async (req: any, res, next) => {
  try {
    const emp = await getEmployee(req.user.id);
    const body = z.object({
      achieved: z.number().min(0),
      status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "ARCHIVED"])
    }).parse(req.body);

    const goal = await performanceService.updateGoalProgress(emp.id, req.params.id, body.achieved, body.status);
    res.json(goal);
  } catch (error) {
    next(error);
  }
});

performanceRouter.delete("/goals/:id", async (req: any, res, next) => {
  try {
    const emp = await getEmployee(req.user.id);
    await performanceService.deleteGoal(emp.id, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Appraisals
// -------------------------------------------------------------
performanceRouter.get("/appraisals", async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");

    const cycleId = req.query.cycleId;
    if (cycleId && (req.user.role === Role.SUPER_ADMIN || req.user.role === Role.HR_ADMIN || req.user.role === Role.MANAGER)) {
      const appraisals = await performanceService.getCycleAppraisals(companyId, String(cycleId));
      return res.json(appraisals);
    }

    const emp = await getEmployee(req.user.id);
    const appraisals = await performanceService.getEmployeeAppraisals(emp.id);
    res.json(appraisals);
  } catch (error) {
    next(error);
  }
});

performanceRouter.post("/appraisals", async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const emp = await getEmployee(req.user.id);

    const body = z.object({
      appraisalCycleId: z.string().min(1),
      selfScore: z.number().min(0).max(10).optional(),
      selfFeedback: z.string().optional()
    }).parse(req.body);

    const appraisal = await performanceService.createAppraisal(
      companyId,
      emp.id,
      body.appraisalCycleId,
      body.selfScore,
      body.selfFeedback
    );
    res.status(201).json(appraisal);
  } catch (error) {
    next(error);
  }
});

performanceRouter.patch("/appraisals/:id/review", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER), async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");

    const body = z.object({
      managerScore: z.number().min(0).max(10),
      managerFeedback: z.string().optional()
    }).parse(req.body);

    const appraisal = await performanceService.reviewAppraisal(
      companyId,
      req.params.id,
      body.managerScore,
      body.managerFeedback
    );
    res.json(appraisal);
  } catch (error) {
    next(error);
  }
});

performanceRouter.patch("/appraisals/:id/approve", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");
    const emp = await getEmployee(req.user.id);

    const body = z.object({
      finalScore: z.number().min(0).max(10)
    }).parse(req.body);

    const appraisal = await performanceService.approveAppraisal(
      companyId,
      req.params.id,
      body.finalScore,
      emp.id
    );
    res.json(appraisal);
  } catch (error) {
    next(error);
  }
});
