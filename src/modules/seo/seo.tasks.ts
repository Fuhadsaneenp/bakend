import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { scope, company, employeeAssigned } from "./seo.access.js";
import { transition, defaults, hash } from "./seo.domain.js";
export async function createTask(
  u: AuthUser,
  id: string,
  body: {
    employeeId: string;
    category: string;
    title: string;
    description: string;
    dueDate: string;
    targetQuantity: number;
    project: string;
  },
) {
  const a = await scope(u, id, "worktrack.task.assign", true);
  await employeeAssigned(id, body.employeeId, company(u));
  return prisma.$transaction(async (tx) => {
    const work = await tx.workCard.create({
      data: {
        companyId: company(u),
        clientId: a.workspace.clientId,
        workId: `SEO-${randomUUID()}`,
        title: body.title,
        brief: `[track: seo] ${body.description}`,
        category: body.category,
        priority: "NORMAL",
        complexity: "MEDIUM",
        deadline: new Date(body.dueDate),
        assignedToId: body.employeeId,
        assignedById: a.employeeId,
        status: "PENDING",
        pointsEarned: 0,
      },
    });
    return tx.seoTask.create({
      data: {
        workspaceId: id,
        workCardId: work.id,
        employeeId: body.employeeId,
        category: body.category,
        description: body.description,
        targetQuantity: body.targetQuantity,
        project: body.project,
      },
    });
  });
}
export async function updateTask(
  u: AuthUser,
  id: string,
  taskId: string,
  body: {
    status: string;
    completedQuantity?: number;
    remarks?: string;
    feedback?: string;
    quality?: number;
    evidence?: { url: string; name: string }[];
  },
) {
  const review = ["APPROVED", "REJECTED", "CORRECTIONS"].includes(body.status);
  const a = await scope(
    u,
    id,
    review ? "worktrack.review.approve" : "worktrack.task.status.update",
    review,
  );
  return prisma.$transaction(async (tx) => {
    const task = await tx.seoTask.findFirst({
      where: { id: taskId, workspaceId: id },
      include: { evidence: true },
    });
    if (!task) throw new ApiError(404, "Task not found");
    if (!review && task.employeeId !== a.employeeId)
      throw new ApiError(403, "Only the assigned employee may submit work");
    if (review && task.employeeId === a.employeeId)
      throw new ApiError(403, "A second person must verify work");
    transition(task.status, body.status, a.manager);
    if (
      ["REJECTED", "CORRECTIONS"].includes(body.status) &&
      !body.feedback?.trim()
    )
      throw new ApiError(400, "Review reason required");
    const quantity = review
      ? task.completedQuantity
      : (body.completedQuantity ?? task.completedQuantity);
    if (quantity > task.targetQuantity)
      throw new ApiError(
        400,
        "Completed quantity cannot exceed the assigned target",
      );
    if (
      body.status === "SUBMITTED" &&
      (!quantity || !(task.evidence.length || body.evidence?.length))
    )
      throw new ApiError(400, "Completed quantity and evidence are required");
    if (body.status === "APPROVED" && body.quality === undefined)
      throw new ApiError(400, "Quality score required");
    const rule = await tx.seoPointRule.findUnique({
      where: {
        companyId_category: { companyId: company(u), category: task.category },
      },
    });
    const fallback = defaults[task.category] || [1, 0];
    const points =
      body.status === "APPROVED"
        ? (quantity / (rule?.quantity ?? fallback[0])) *
          (rule?.points ?? fallback[1])
        : 0;
    // Compare-and-set stops concurrent reviews from awarding twice.
    const evidenceHash = hash(
      JSON.stringify(task.evidence.map((e) => e.url).sort()),
    );
    const changed = await tx.seoTask.updateMany({
      where: { id: task.id, status: task.status },
      data: {
        status: body.status,
        ...(!review
          ? { completedQuantity: quantity, remarks: body.remarks }
          : {}),
        ...(review ? { feedback: body.feedback, quality: body.quality } : {}),
        ...(body.status === "IN_PROGRESS" ? { startTime: new Date() } : {}),
        ...(body.status === "SUBMITTED" ? { completionTime: new Date() } : {}),
        points,
        ...(body.status === "APPROVED"
          ? { approvedEvidenceHash: evidenceHash }
          : {}),
      },
    });
    if (!changed.count)
      throw new ApiError(409, "Task changed; reload before reviewing");
    if (!review && body.evidence?.length)
      await tx.seoEvidence.createMany({
        data: body.evidence.map((e) => ({ ...e, taskId: task.id })),
      });
    if (body.status === "APPROVED") {
      const ledger = await tx.pointsLedger.create({
        data: {
          employeeId: task.employeeId,
          workCardId: task.workCardId,
          points,
          description: `Verified SEO: ${task.category}; quality ${body.quality}/5`,
        },
      });
      await tx.seoTask.update({
        where: { id: task.id },
        data: { ledgerId: ledger.id },
      });
    }
    const mapped: Record<string, string> = {
      ASSIGNED: "PENDING",
      IN_PROGRESS: "IN_PROGRESS",
      SUBMITTED: "FINISHED",
      APPROVED: "APPROVED",
      REJECTED: "REWORK",
      CORRECTIONS: "REWORK",
    };
    await tx.workCard.update({
      where: { id: task.workCardId },
      data: { status: mapped[body.status], pointsEarned: points },
    });
    await tx.seoReview.create({
      data: {
        taskId: task.id,
        userId: u.id,
        status: body.status,
        reason: body.feedback || body.remarks || "",
      },
    });
    await tx.statusHistory.create({
      data: {
        workCardId: task.workCardId,
        userId: u.id,
        status: mapped[body.status],
      },
    });
    return tx.seoTask.findUnique({
      where: { id: task.id },
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
        reviews: true,
      },
    });
  });
}
