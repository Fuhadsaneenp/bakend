import { ApprovalStatus, Role } from "@prisma/client";
import { differenceInMinutes } from "date-fns";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";
import { notificationService } from "../notifications/notification.service.js";
import type { AuthUser } from "../../middleware/auth.js";

const db = prisma as any;

function parseMissedPunchTimes(reason: string) {
  if (!reason.startsWith("[Missed Punch]")) return null;
  const checkIn = reason.match(/\[IN=(\d{2}:\d{2})\]/)?.[1];
  const checkOut = reason.match(/\[OUT=(\d{2}:\d{2})\]/)?.[1];
  return checkIn && checkOut ? { checkIn, checkOut } : null;
}

async function applyApprovedMissedPunch(request: any) {
  const times = parseMissedPunchTimes(request.reason || "");
  if (!times) return;

  const employee = await db.employee.findUnique({
    where: { id: request.employeeId },
    include: { shift: true }
  });
  if (!employee) throw notFound("Employee");

  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(request.startDate));
  const workDate = new Date(`${dateKey}T00:00:00+05:30`);
  const checkInAt = new Date(`${dateKey}T${times.checkIn}:00+05:30`);
  const checkOutAt = new Date(`${dateKey}T${times.checkOut}:00+05:30`);

  if (checkOutAt <= checkInAt) {
    throw new ApiError(400, "Corrected check-out time must be later than check-in time");
  }

  const shiftStartTime = employee.shift?.startTime || "09:00";
  const shiftEndTime = employee.shift?.endTime || "18:00";
  const gracePeriod = employee.shift?.gracePeriod || 0;
  const earlyPunchTolerance = employee.shift?.earlyPunchTolerance || 0;
  const workMinutesFix = employee.shift?.workMinutesFix || 8 * 60;
  const shiftStart = new Date(`${dateKey}T${shiftStartTime}:00+05:30`);
  const shiftEnd = new Date(`${dateKey}T${shiftEndTime}:00+05:30`);
  const worked = Math.max(0, differenceInMinutes(checkOutAt, checkInAt));

  await db.attendance.upsert({
    where: { employeeId_workDate: { employeeId: request.employeeId, workDate } },
    create: {
      employeeId: request.employeeId,
      workDate,
      checkInAt,
      checkOutAt,
      workMinutes: worked,
      overtimeMinutes: Math.max(0, worked - workMinutesFix),
      isLate: checkInAt.getTime() > shiftStart.getTime() + gracePeriod * 60_000,
      isEarlyLeave: checkOutAt.getTime() < shiftEnd.getTime() - earlyPunchTolerance * 60_000
    },
    update: {
      checkInAt,
      checkOutAt,
      workMinutes: worked,
      overtimeMinutes: Math.max(0, worked - workMinutesFix),
      isLate: checkInAt.getTime() > shiftStart.getTime() + gracePeriod * 60_000,
      isEarlyLeave: checkOutAt.getTime() < shiftEnd.getTime() - earlyPunchTolerance * 60_000
    }
  });
}

const requestInclude = {
  employee: {
    include: {
      user: true,
      documents: true,
      manager: {
        include: {
          user: true,
          manager: {
            include: {
              user: true
            }
          }
        }
      }
    }
  }
};

async function getEmployeeByUserId(userId: string) {
  return db.employee.findUnique({
    where: { userId },
    include: {
      user: true,
      manager: {
        include: {
          user: true,
          manager: {
            include: {
              user: true
            }
          }
        }
      }
    }
  });
}

async function getHrHeads(companyId: string, excludeUserIds: string[] = []) {
  let users: any[] = [];
  try {
    users = await db.user.findMany({
      where: {
        companyId,
        OR: [
          { role: Role.SUPER_ADMIN },
          { role: Role.HR_ADMIN },
          { employee: { isHrHead: true } }
        ]
      },
      include: {
        employee: true
      }
    });
  } catch {
    users = await db.user.findMany({
      where: {
        companyId,
        OR: [
          { role: Role.SUPER_ADMIN },
          { role: Role.HR_ADMIN }
        ]
      },
      include: {
        employee: true
      }
    });
  }

  const seen = new Set<string>();
  return users.filter((user: any) => {
    if (excludeUserIds.includes(user.id)) return false;
    if (seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });
}

function buildFinalState(input: {
  status: ApprovalStatus;
  immediateManagerStatus: ApprovalStatus;
  higherManagerStatus: ApprovalStatus;
  hrHeadStatus: ApprovalStatus;
  hasHigherManager: boolean;
}) {
  const rejectionStatuses = [
    input.immediateManagerStatus,
    input.higherManagerStatus,
    input.hrHeadStatus
  ];

  if (rejectionStatuses.includes(ApprovalStatus.REJECTED)) {
    return ApprovalStatus.REJECTED;
  }

  if (
    input.higherManagerStatus === ApprovalStatus.APPROVED ||
    input.hrHeadStatus === ApprovalStatus.APPROVED
  ) {
    return ApprovalStatus.APPROVED;
  }

  return ApprovalStatus.PENDING;
}

export const wfhService = {
  async request(userId: string, data: { startDate: string; endDate: string; reason: string }) {
    const employee = await getEmployeeByUserId(userId);
    if (!employee) throw notFound("Employee");

    const immediateManagerId = employee.managerId || null;
    const higherManagerId = employee.manager?.managerId || null;

    let request: any;
    try {
      request = await db.wFHRequest.create({
        data: {
          employeeId: employee.id,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
          reason: data.reason,
          immediateManagerId,
          higherManagerId
        },
        include: requestInclude
      });
    } catch {
      request = await db.wFHRequest.create({
        data: {
          employeeId: employee.id,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
          reason: data.reason
        },
        include: requestInclude
      });
    }

    const notifyUserIds = new Set<string>();

    if (employee.manager?.userId) {
      notifyUserIds.add(employee.manager.userId);
    }
    if (employee.manager?.manager?.userId) {
      notifyUserIds.add(employee.manager.manager.userId);
    }

    const hrHeads = await getHrHeads(employee.companyId, [employee.userId]);
    hrHeads.forEach((hrHead: any) => {
      notifyUserIds.add(hrHead.id);
    });

    await Promise.all(
      Array.from(notifyUserIds).map((reviewerUserId) =>
        notificationService.inApp(
          reviewerUserId,
          "New leave request submitted",
          `${employee.firstName} ${employee.lastName} submitted a leave/WFH request for review.`,
          { requestId: request.id, employeeId: employee.id }
        )
      )
    );

    return request;
  },

  async review(requestId: string, reviewer: AuthUser, status: ApprovalStatus) {
    const existing = await db.wFHRequest.findUnique({
      where: { id: requestId },
      include: {
        employee: {
          include: {
            user: true,
            manager: {
              include: {
                user: true,
                manager: {
                  include: {
                    user: true
                  }
                }
              }
            }
          }
        }
      }
    });
    if (!existing) throw notFound("WFH request");

    const reviewerEmployee = await db.employee.findUnique({
      where: { userId: reviewer.id },
      include: { user: true }
    });

    const reviewerIsHrHead =
      reviewer.role === Role.SUPER_ADMIN ||
      reviewer.role === Role.HR_ADMIN ||
      Boolean(reviewerEmployee?.isHrHead);

    const reviewerName = reviewerEmployee 
      ? `${reviewerEmployee.firstName} ${reviewerEmployee.lastName === "-" ? "" : reviewerEmployee.lastName}`.trim()
      : reviewer.email || "System/HR";

    const resolvedImmediateManagerId =
      existing.immediateManagerId || existing.employee.managerId || existing.employee.manager?.id || null;
    const resolvedHigherManagerId =
      existing.higherManagerId || existing.employee.manager?.manager?.id || null;

    const isImmediateManager = Boolean(reviewerEmployee && resolvedImmediateManagerId === reviewerEmployee.id);
    const isHigherManager = Boolean(reviewerEmployee && resolvedHigherManagerId === reviewerEmployee.id);

    if (!reviewerIsHrHead && !isImmediateManager && !isHigherManager) {
      throw new ApiError(403, "You are not allowed to review this request");
    }

    let request: any;
    const now = new Date();

    try {
      const updateData: Record<string, unknown> = {};

      if (reviewerIsHrHead) {
        updateData.hrHeadStatus = status;
        updateData.hrHeadReviewedBy = reviewer.id;
        updateData.hrHeadReviewedAt = now;
      } else if (isHigherManager) {
        updateData.higherManagerStatus = status;
        updateData.higherManagerReviewedBy = reviewer.id;
        updateData.higherManagerReviewedAt = now;
      } else if (isImmediateManager) {
        updateData.immediateManagerStatus = status;
        updateData.immediateManagerReviewedBy = reviewer.id;
        updateData.immediateManagerReviewedAt = now;
      }

      const nextState = {
        status: existing.status,
        immediateManagerStatus: (updateData.immediateManagerStatus as ApprovalStatus | undefined) ?? existing.immediateManagerStatus,
        higherManagerStatus: (updateData.higherManagerStatus as ApprovalStatus | undefined) ?? existing.higherManagerStatus,
        hrHeadStatus: (updateData.hrHeadStatus as ApprovalStatus | undefined) ?? existing.hrHeadStatus,
        hasHigherManager: Boolean(resolvedHigherManagerId)
      };

      updateData.status = buildFinalState(nextState);
      updateData.reviewedBy = updateData.status !== ApprovalStatus.PENDING ? reviewerName : existing.reviewedBy;
      updateData.reviewedAt = updateData.status !== ApprovalStatus.PENDING ? now : existing.reviewedAt;

      request = await db.wFHRequest.update({
        where: { id: requestId },
        data: updateData,
        include: requestInclude
      });
    } catch (err) {
      console.error("DEBUG: WFH review try block failed! Error details:", err);
      const fallbackImmediateManagerId =
        existing.immediateManagerId || existing.employee.managerId || existing.employee.manager?.id || null;
      const fallbackHigherManagerId =
        existing.higherManagerId || existing.employee.manager?.manager?.id || null;
      const fallbackIsImmediateManager = Boolean(reviewerEmployee && fallbackImmediateManagerId === reviewerEmployee.id);
      const fallbackIsHigherManager = Boolean(reviewerEmployee && fallbackHigherManagerId === reviewerEmployee.id);

      if (!reviewerIsHrHead && !fallbackIsImmediateManager && !fallbackIsHigherManager) {
        throw new ApiError(403, "You are not allowed to review this request");
      }

      let fallbackStatus = status;

      if (status === ApprovalStatus.APPROVED) {
        if (reviewerIsHrHead || fallbackIsHigherManager) {
          fallbackStatus = ApprovalStatus.APPROVED;
        } else if (fallbackIsImmediateManager) {
          fallbackStatus = ApprovalStatus.PENDING;
        } else {
          fallbackStatus = ApprovalStatus.APPROVED;
        }
      }

      request = await db.wFHRequest.update({
        where: { id: requestId },
        data: {
          status: fallbackStatus,
          hrHeadStatus: reviewerIsHrHead ? status : existing.hrHeadStatus,
          immediateManagerStatus: fallbackIsImmediateManager ? status : existing.immediateManagerStatus,
          higherManagerStatus: fallbackIsHigherManager ? status : existing.higherManagerStatus,
          hrHeadReviewedBy: reviewerIsHrHead ? reviewer.id : existing.hrHeadReviewedBy,
          hrHeadReviewedAt: reviewerIsHrHead ? now : existing.hrHeadReviewedAt,
          immediateManagerReviewedBy: fallbackIsImmediateManager ? reviewer.id : existing.immediateManagerReviewedBy,
          immediateManagerReviewedAt: fallbackIsImmediateManager ? now : existing.immediateManagerReviewedAt,
          higherManagerReviewedBy: fallbackIsHigherManager ? reviewer.id : existing.higherManagerReviewedBy,
          higherManagerReviewedAt: fallbackIsHigherManager ? now : existing.higherManagerReviewedAt,
          reviewedBy:
            fallbackStatus === ApprovalStatus.PENDING && status === ApprovalStatus.APPROVED
              ? reviewerName
              : fallbackStatus !== ApprovalStatus.PENDING
                ? reviewerName
                : existing.reviewedBy,
          reviewedAt:
            fallbackStatus === ApprovalStatus.PENDING && status === ApprovalStatus.APPROVED
              ? now
              : fallbackStatus !== ApprovalStatus.PENDING
                ? now
                : existing.reviewedAt
        },
        include: requestInclude
      });
    }

    if (request.status === ApprovalStatus.APPROVED) {
      await applyApprovedMissedPunch(request);
    }

    await notificationService.inApp(
      request.employee.userId,
      `Leave/WFH ${String(request.status).toLowerCase()}`,
      `Your leave/WFH request is now ${String(request.status).toLowerCase()}.`,
      { requestId: request.id, status: request.status }
    );

    return request;
  },

  async listForUser(user: AuthUser) {
    if (!user.companyId) return [];

    if (user.role === Role.SUPER_ADMIN || user.role === Role.HR_ADMIN) {
      return db.wFHRequest.findMany({
        where: { employee: { companyId: user.companyId } },
        include: requestInclude,
        orderBy: { createdAt: "desc" }
      });
    }

    const employee = await db.employee.findUnique({ where: { userId: user.id } });
    if (!employee) return [];

    if (employee.isHrHead) {
      return db.wFHRequest.findMany({
        where: { employee: { companyId: user.companyId } },
        include: requestInclude,
        orderBy: { createdAt: "desc" }
      });
    }

    if (user.role === Role.MANAGER) {
      try {
        return await db.wFHRequest.findMany({
          where: {
            OR: [
              { employeeId: employee.id },
              { immediateManagerId: employee.id },
              { higherManagerId: employee.id },
              { employee: { managerId: employee.id } },
              { employee: { manager: { managerId: employee.id } } }
            ]
          },
          include: {
            employee: requestInclude.employee
          },
          orderBy: { createdAt: "desc" }
        });
      } catch {
        return db.wFHRequest.findMany({
          where: {
            OR: [
              { employeeId: employee.id },
              { employee: { managerId: employee.id } },
              { employee: { manager: { managerId: employee.id } } }
            ]
          },
          include: requestInclude,
          orderBy: { createdAt: "desc" }
        });
      }
    }

    return db.wFHRequest.findMany({
      where: { employeeId: employee.id },
      include: requestInclude,
      orderBy: { createdAt: "desc" }
    });
  }
};
