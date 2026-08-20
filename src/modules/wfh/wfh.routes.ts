import { ApprovalStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRoles } from "../../middleware/auth.js";
import { ApiError } from "../../lib/errors.js";
import { wfhService } from "./wfh.service.js";
import { leaveAllocationService } from "./leaveAllocation.service.js";
import { prisma } from "../../lib/prisma.js";

export const wfhRouter = Router();
wfhRouter.use(requireAuth);

wfhRouter.post("/request", async (req, res, next) => {
  try {
    const body = z.object({ startDate: z.string(), endDate: z.string(), reason: z.string().min(5) }).parse(req.body);
    res.status(201).json(await wfhService.request(req.user!.id, body));
  } catch (error) {
    next(error);
  }
});

wfhRouter.get("/", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER, Role.EMPLOYEE), async (req, res, next) => {
  try {
    const query = z.object({ companyId: z.string().optional() }).parse(req.query);
    if (req.user?.role !== Role.SUPER_ADMIN && !req.user?.companyId) throw new ApiError(400, "Company context required");
    res.json(await wfhService.listForUser(req.user!, query.companyId));
  } catch (error) {
    next(error);
  }
});

wfhRouter.patch("/:id/review", requireRoles(Role.HR_ADMIN, Role.MANAGER, Role.SUPER_ADMIN, Role.EMPLOYEE), async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED]) }).parse(req.body);
    res.json(await wfhService.review(req.params.id, req.user!, body.status));
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Leave Allocations Endpoints
// -------------------------------------------------------------
wfhRouter.get("/allocations", async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");

    const employeeId = req.query.employeeId;
    if (employeeId && (req.user.role === Role.SUPER_ADMIN || req.user.role === Role.HR_ADMIN || req.user.role === Role.MANAGER)) {
      const allocations = await leaveAllocationService.getEmployeeAllocations(String(employeeId));
      return res.json(allocations);
    }

    if (req.user.role === Role.SUPER_ADMIN || req.user.role === Role.HR_ADMIN) {
      const allocations = await leaveAllocationService.getCompanyAllocations(companyId);
      return res.json(allocations);
    }

    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) throw new ApiError(404, "Employee profile not found");

    const allocations = await leaveAllocationService.getEmployeeAllocations(employee.id);
    res.json(allocations);
  } catch (error) {
    next(error);
  }
});

wfhRouter.post("/allocations", requireRoles(Role.SUPER_ADMIN, Role.HR_ADMIN), async (req: any, res, next) => {
  try {
    const companyId = req.user.companyId;
    if (!companyId) throw new ApiError(400, "Company context required");

    const body = z.object({
      employeeId: z.string().min(1),
      leaveType: z.string().min(1),
      year: z.number().int().min(2000).max(2100),
      maxDays: z.number().positive()
    }).parse(req.body);

    const allocation = await leaveAllocationService.createOrUpdateAllocation(
      body.employeeId,
      body.leaveType,
      body.year,
      body.maxDays
    );
    res.status(201).json(allocation);
  } catch (error) {
    next(error);
  }
});
