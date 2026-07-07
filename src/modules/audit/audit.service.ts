import { prisma } from "../../lib/prisma.js";

export const audit = {
  async record(input: {
    actorUserId?: string;
    action: string;
    entity: string;
    entityId?: string;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  }) {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        ipAddress: input.ipAddress ?? null,
        metadata: (input.metadata ?? undefined) as any
      }
    });
  }
};

