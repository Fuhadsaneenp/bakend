import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";
import { startOfYear, endOfYear, startOfMonth, endOfMonth, differenceInHours, addDays, isAfter } from "date-fns";

const DEFAULT_SETTINGS = {
  pointValues: JSON.stringify({
    URGENT: 5,
    HIGH: 3,
    NORMAL: 2,
    LOW: 1
  }),
  slaTimes: JSON.stringify({
    URGENT: 24, // in hours
    HIGH: 48,
    NORMAL: 72,
    LOW: 120
  }),
  categories: JSON.stringify([
    "Poster",
    "Reel",
    "Video",
    "Logo",
    "Brochure",
    "Ad campaign",
    "Other"
  ]),
  reworkReasons: JSON.stringify([
    "Did not follow the brief",
    "Design quality below standard",
    "Text / spelling error",
    "Wrong size or format",
    "Brand guideline missed",
    "Late delivery",
    "Client changed mind"
  ]),
  promotionRules: JSON.stringify({
    minMonthlyPointsPremium: 20, // percent above average
    minFirstPassRate: 80, // percent
    minOnTimeRate: 90, // percent
    minWorksCompleted: 60 // in last 6 months
  })
};

export const workTrackService = {
  async getSettings(companyId: string) {
    let settings = await prisma.workTrackSetting.findUnique({
      where: { companyId }
    });
    if (!settings) {
      settings = await prisma.workTrackSetting.create({
        data: {
          companyId,
          ...DEFAULT_SETTINGS
        }
      });
    }
    return {
      id: settings.id,
      companyId: settings.companyId,
      pointValues: JSON.parse(settings.pointValues),
      slaTimes: JSON.parse(settings.slaTimes),
      categories: JSON.parse(settings.categories),
      reworkReasons: JSON.parse(settings.reworkReasons),
      promotionRules: JSON.parse(settings.promotionRules)
    };
  },

  async updateSettings(companyId: string, data: any) {
    const settings = await prisma.workTrackSetting.findUnique({
      where: { companyId }
    });
    const updateData = {
      pointValues: data.pointValues ? JSON.stringify(data.pointValues) : undefined,
      slaTimes: data.slaTimes ? JSON.stringify(data.slaTimes) : undefined,
      categories: data.categories ? JSON.stringify(data.categories) : undefined,
      reworkReasons: data.reworkReasons ? JSON.stringify(data.reworkReasons) : undefined,
      promotionRules: data.promotionRules ? JSON.stringify(data.promotionRules) : undefined
    };

    if (settings) {
      return prisma.workTrackSetting.update({
        where: { companyId },
        data: updateData
      });
    } else {
      return prisma.workTrackSetting.create({
        data: {
          companyId,
          pointValues: updateData.pointValues || DEFAULT_SETTINGS.pointValues,
          slaTimes: updateData.slaTimes || DEFAULT_SETTINGS.slaTimes,
          categories: updateData.categories || DEFAULT_SETTINGS.categories,
          reworkReasons: updateData.reworkReasons || DEFAULT_SETTINGS.reworkReasons,
          promotionRules: updateData.promotionRules || DEFAULT_SETTINGS.promotionRules
        }
      });
    }
  },

  async getClients(companyId: string) {
    return prisma.client.findMany({
      where: { companyId },
      include: {
        accountManager: {
          select: { id: true, firstName: true, lastName: true }
        },
        specialDays: true
      },
      orderBy: { name: "asc" }
    });
  },

  async createClient(companyId: string, data: { name: string; details?: string; contacts?: string; accountManagerId?: string }) {
    return prisma.client.create({
      data: {
        companyId,
        name: data.name,
        details: data.details,
        contacts: data.contacts,
        accountManagerId: data.accountManagerId
      }
    });
  },

  async getDesigners(companyId: string) {
    // Return all employees with role EMPLOYEE or MANAGER
    return prisma.employee.findMany({
      where: {
        companyId,
        user: { role: { in: [Role.EMPLOYEE, Role.MANAGER] } }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedWorkCards: {
          where: {
            status: { in: ["PENDING", "IN_PROGRESS"] }
          },
          select: {
            id: true,
            priority: true,
            complexity: true
          }
        },
        pointsLedgers: {
          where: {
            createdAt: {
              gte: startOfMonth(new Date()),
              lte: endOfMonth(new Date())
            }
          },
          select: {
            points: true
          }
        }
      }
    });
  },

  async createWorkCard(companyId: string, creatorUserId: string, data: {
    clientId: string;
    title: string;
    brief: string;
    category: string;
    priority: string;
    complexity: string;
    deadline: string;
    assignedToId?: string;
  }) {
    // Generate sequential workId e.g. ST-2026-0001
    const year = new Date().getFullYear();
    const start = startOfYear(new Date());
    const end = endOfYear(new Date());
    const count = await prisma.workCard.count({
      where: {
        companyId,
        createdAt: { gte: start, lte: end }
      }
    });
    const workId = `ST-${year}-${String(count + 1).padStart(4, "0")}`;

    const creatorEmployee = await prisma.employee.findUnique({
      where: { userId: creatorUserId }
    });

    const card = await prisma.workCard.create({
      data: {
        companyId,
        workId,
        clientId: data.clientId,
        title: data.title,
        brief: data.brief,
        category: data.category,
        priority: data.priority.toUpperCase(),
        complexity: data.complexity.toUpperCase(),
        deadline: new Date(data.deadline),
        assignedToId: data.assignedToId || null,
        assignedById: creatorEmployee?.id || null,
        status: "PENDING"
      }
    });

    // Create initial status history
    await prisma.statusHistory.create({
      data: {
        workCardId: card.id,
        status: "PENDING",
        userId: creatorUserId
      }
    });

    // Send in-app notification if assigned
    if (data.assignedToId) {
      const assignedEmployee = await prisma.employee.findUnique({
        where: { id: data.assignedToId },
        select: { userId: true }
      });
      if (assignedEmployee) {
        await prisma.notification.create({
          data: {
            userId: assignedEmployee.userId,
            channel: "IN_APP",
            subject: "New Work Card Assigned",
            body: `You have been assigned to: ${card.workId} - ${card.title}`
          }
        });
      }
    }

    return card;
  },

  async getWorkCards(companyId: string, userId: string, userRole: Role, filters: {
    clientId?: string;
    assignedToId?: string;
    status?: string;
    priority?: string;
  }) {
    const employee = await prisma.employee.findUnique({
      where: { userId }
    });

    let roleFilter: any = {};
    if (userRole === Role.EMPLOYEE && employee) {
      roleFilter = { assignedToId: employee.id };
    } else if (userRole === Role.MANAGER && employee) {
      if (!filters.assignedToId) {
        roleFilter = {
          OR: [
            { assignedToId: employee.id },
            { assignedById: employee.id }
          ]
        };
      }
    }

    return prisma.workCard.findMany({
      where: {
        companyId,
        clientId: filters.clientId || undefined,
        assignedToId: filters.assignedToId || undefined,
        status: filters.status || undefined,
        priority: filters.priority ? filters.priority.toUpperCase() : undefined,
        ...roleFilter
      },
      include: {
        client: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        comments: {
          include: {
            user: { select: { id: true, email: true } }
          },
          orderBy: { createdAt: "asc" }
        },
        reworkLogs: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async getWorkCardDetails(id: string) {
    const card = await prisma.workCard.findUnique({
      where: { id },
      include: {
        client: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
        comments: {
          include: {
            user: { select: { id: true, email: true, role: true } }
          },
          orderBy: { createdAt: "asc" }
        },
        reworkLogs: {
          orderBy: { createdAt: "desc" }
        },
        statusHistory: {
          include: {
            user: { select: { id: true, email: true } }
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });
    if (!card) throw notFound("Work Card");
    return card;
  },

  async updateWorkCardStatus(companyId: string, id: string, userId: string, data: {
    status: string;
    reworkReason?: string;
    reworkComment?: string;
    rulingType?: "designer_fault" | "client_delay" | "none";
    finalFileUrl?: string;
  }) {
    const card = await prisma.workCard.findUnique({
      where: { id },
      include: { assignedTo: true }
    });
    if (!card) throw notFound("Work Card");

    const newStatus = data.status.toUpperCase();
    const prevStatus = card.status;

    let updateData: any = { status: newStatus };
    if (data.finalFileUrl) {
      // Append final files
      let filesList = card.files ? JSON.parse(card.files) : [];
      filesList.push({ url: data.finalFileUrl, name: "final_output_" + Date.now(), type: "final" });
      updateData.files = JSON.stringify(filesList);
    }

    if (newStatus === "FINISHED" && prevStatus !== "FINISHED") {
      // When designer moves to finished, automatically set status to OUT_TO_DELIVER
      updateData.status = "OUT_TO_DELIVER";
    }

    const updatedCard = await prisma.workCard.update({
      where: { id },
      data: updateData
    });

    // Record status history
    await prisma.statusHistory.create({
      data: {
        workCardId: id,
        status: updateData.status,
        userId
      }
    });

    // Handle Rework logic
    if (newStatus === "REWORK") {
      const reason = data.reworkReason || "Did not follow the brief";
      const comment = data.reworkComment || "";
      const roundNumber = card.reworkCount + 1;

      await prisma.reworkLog.create({
        data: {
          workCardId: id,
          roundNumber,
          reason,
          comment,
          chargedToId: card.assignedToId
        }
      });

      await prisma.workCard.update({
        where: { id },
        data: {
          reworkCount: roundNumber,
          status: "PENDING" // return back to pending
        }
      });

      // Status history back to pending
      await prisma.statusHistory.create({
        data: {
          workCardId: id,
          status: "PENDING",
          userId
        }
      });

      // Notify Designer
      if (card.assignedTo) {
        await prisma.notification.create({
          data: {
            userId: card.assignedTo.userId,
            channel: "IN_APP",
            subject: "Work Returned for Rework",
            body: `Card ${card.workId} has been returned for rework. Reason: ${reason}. Comment: ${comment}`
          }
        });
      }
    }

    // Handle Approved / points logic
    if (newStatus === "APPROVED" && prevStatus !== "APPROVED") {
      const settings = await this.getSettings(companyId);
      const pointsBaseMap = settings.pointValues;
      const basePoints = pointsBaseMap[card.priority] || 2;

      let complexityMultiplier = 1.0;
      if (card.complexity === "SIMPLE") complexityMultiplier = 1.0;
      else if (card.complexity === "MEDIUM") complexityMultiplier = 1.5;
      else if (card.complexity === "HEAVY") complexityMultiplier = 2.0;

      let rawPoints = basePoints * complexityMultiplier;
      let multiplier = 1.0;
      let ledgerDesc = `Base points (${basePoints}) x Complexity (${complexityMultiplier})`;

      const isRework = card.reworkCount > 0;
      const now = new Date();
      const onTime = !isAfter(now, card.deadline);

      if (data.rulingType === "client_delay") {
        ledgerDesc += ` (Client delay marked, no penalties applied)`;
      } else {
        // Adjustments:
        // 1. Approved first time, on-time: +20% bonus
        if (!isRework && onTime) {
          multiplier += 0.2;
          ledgerDesc += ` + 20% First-time On-time Bonus`;
        }
        // 2. Each rework round caused by our side: -10% per round (max -50%)
        if (isRework) {
          const penalty = Math.min(card.reworkCount * 0.1, 0.5);
          multiplier -= penalty;
          ledgerDesc += ` - ${penalty * 100}% Rework Penalty (${card.reworkCount} rounds)`;
        }
        // 3. Delivered after deadline: -50%
        if (!onTime) {
          multiplier -= 0.5;
          ledgerDesc += ` - 50% Overdue Penalty`;
        }
      }

      // Max multiplier lower bound constraint
      const finalMultiplier = Math.max(multiplier, 0.2);
      const finalPoints = rawPoints * finalMultiplier;

      await prisma.workCard.update({
        where: { id },
        data: { pointsEarned: finalPoints }
      });

      if (card.assignedToId) {
        await prisma.pointsLedger.create({
          data: {
            employeeId: card.assignedToId,
            workCardId: id,
            points: finalPoints,
            description: ledgerDesc
          }
        });

        // Notify Designer
        await prisma.notification.create({
          data: {
            userId: card.assignedTo!.userId,
            channel: "IN_APP",
            subject: "Work Approved & Points Earned",
            body: `Congratulations! ${card.workId} approved. You earned ${finalPoints.toFixed(1)} points.`
          }
        });
      }
    }

    return this.getWorkCardDetails(id);
  },

  async addComment(workCardId: string, userId: string, text: string) {
    return prisma.comment.create({
      data: {
        workCardId,
        userId,
        text
      },
      include: {
        user: { select: { id: true, email: true, role: true } }
      }
    });
  },

  async getAnalytics(companyId: string, month: number, year: number) {
    const start = startOfMonth(new Date(year, month - 1, 1));
    const end = endOfMonth(new Date(year, month - 1, 1));

    // 1. Total Work Cards completed/pending/overdue
    const cards = await prisma.workCard.findMany({
      where: {
        companyId,
        createdAt: { gte: start, lte: end }
      },
      include: {
        assignedTo: true,
        reworkLogs: true
      }
    });

    const total = cards.length;
    const completed = cards.filter(c => c.status === "APPROVED").length;
    const pending = cards.filter(c => ["PENDING", "IN_PROGRESS", "FINISHED", "OUT_TO_DELIVER"].includes(c.status)).length;
    
    const now = new Date();
    const overdue = cards.filter(c => 
      ["PENDING", "IN_PROGRESS", "FINISHED", "OUT_TO_DELIVER"].includes(c.status) &&
      isAfter(now, c.deadline)
    ).length;

    // Rework rate
    const cardsWithRework = cards.filter(c => c.reworkCount > 0).length;
    const reworkRate = total > 0 ? (cardsWithRework / total) * 100 : 0;

    // 2. Client requirement tracker
    const clients = await prisma.client.findMany({
      where: { companyId },
      include: {
        workCards: {
          where: {
            createdAt: { gte: start, lte: end }
          }
        }
      }
    });

    // Satisfaction score base starting at 100 per client
    const clientTracker = clients.map(client => {
      const clientCards = client.workCards;
      const cTotal = clientCards.length;
      const cCompleted = clientCards.filter(c => c.status === "APPROVED").length;
      const cPending = clientCards.filter(c => ["PENDING", "IN_PROGRESS", "FINISHED", "OUT_TO_DELIVER"].includes(c.status)).length;
      const cOverdue = clientCards.filter(c => 
        ["PENDING", "IN_PROGRESS", "FINISHED", "OUT_TO_DELIVER"].includes(c.status) &&
        isAfter(now, c.deadline)
      ).length;

      // Satisfaction formula: Starts at 100. -5 per rework round. -10 per missed deadline. +2 per first-pass approval. Max 100.
      let satisfactionScore = 100;
      let reworkRounds = 0;
      let missedDeadlines = 0;
      let firstPassApprovals = 0;

      clientCards.forEach(c => {
        reworkRounds += c.reworkCount;
        const cardFinishedDate = c.status === "APPROVED" ? c.updatedAt : now;
        if (isAfter(cardFinishedDate, c.deadline)) {
          missedDeadlines++;
        }
        if (c.status === "APPROVED" && c.reworkCount === 0) {
          firstPassApprovals++;
        }
      });

      satisfactionScore -= (reworkRounds * 5);
      satisfactionScore -= (missedDeadlines * 10);
      satisfactionScore += (firstPassApprovals * 2);
      satisfactionScore = Math.max(Math.min(satisfactionScore, 100), 0);

      let status = "Happy";
      if (satisfactionScore < 75) status = "At Risk";
      else if (satisfactionScore < 90) status = "Watch";

      return {
        id: client.id,
        name: client.name,
        received: cTotal,
        completed: cCompleted,
        pending: cPending,
        overdue: cOverdue,
        satisfactionScore,
        status
      };
    });

    const averageSatisfaction = clientTracker.length > 0
      ? clientTracker.reduce((acc, curr) => acc + curr.satisfactionScore, 0) / clientTracker.length
      : 100;

    // 3. Employee leaderboard
    const designers = await prisma.employee.findMany({
      where: {
        companyId,
        user: { role: Role.EMPLOYEE }
      },
      include: {
        assignedWorkCards: {
          where: {
            createdAt: { gte: start, lte: end }
          }
        },
        pointsLedgers: {
          where: {
            createdAt: { gte: start, lte: end }
          }
        }
      }
    });

    const leaderboard = designers.map(designer => {
      const dCards = designer.assignedWorkCards;
      const dApproved = dCards.filter(c => c.status === "APPROVED");
      const dTotalApproved = dApproved.length;
      
      const totalPoints = designer.pointsLedgers.reduce((acc, curr) => acc + curr.points, 0);

      // On-time rate
      const onTimeDeliveries = dApproved.filter(c => !isAfter(c.updatedAt, c.deadline)).length;
      const onTimeRate = dTotalApproved > 0 ? (onTimeDeliveries / dTotalApproved) * 100 : 100;

      // First pass approval rate
      const firstPassCount = dApproved.filter(c => c.reworkCount === 0).length;
      const firstPassRate = dTotalApproved > 0 ? (firstPassCount / dTotalApproved) * 100 : 100;

      return {
        id: designer.id,
        name: `${designer.firstName} ${designer.lastName}`,
        points: totalPoints,
        completed: dTotalApproved,
        firstPassRate,
        onTimeRate
      };
    }).sort((a, b) => b.points - a.points);

    // 4. Weak-area analysis
    // Group rejections by reason
    const reworks = await prisma.reworkLog.findMany({
      where: {
        workCard: {
          companyId,
          createdAt: { gte: start, lte: end }
        }
      },
      include: { workCard: true }
    });

    const reworksByReason: Record<string, number> = {};
    const reworksByCategory: Record<string, number> = {};

    reworks.forEach(r => {
      reworksByReason[r.reason] = (reworksByReason[r.reason] || 0) + 1;
      reworksByCategory[r.workCard.category] = (reworksByCategory[r.workCard.category] || 0) + 1;
    });

    // 5. Special days next 30 days
    const next30Days = addDays(new Date(), 30);
    const specialDays = await prisma.specialDay.findMany({
      where: {
        date: {
          gte: new Date(),
          lte: next30Days
        }
      },
      include: { client: true },
      orderBy: { date: "asc" }
    });

    // 6. Promotion Panel eligibility
    const settings = await this.getSettings(companyId);
    const rules = settings.promotionRules;
    const sixMonthsAgo = addDays(new Date(), -180);

    const sixMonthCards = await prisma.workCard.findMany({
      where: {
        companyId,
        status: "APPROVED",
        updatedAt: { gte: sixMonthsAgo }
      }
    });

    const teamAveragePoints = leaderboard.reduce((acc, curr) => acc + curr.points, 0) / (leaderboard.length || 1);

    const promotionList = designers.map(designer => {
      const dSixMonthCards = sixMonthCards.filter(c => c.assignedToId === designer.id);
      const totalWorksCompleted = dSixMonthCards.length;

      const isEligible = 
        totalWorksCompleted >= rules.minWorksCompleted &&
        designer.pointsLedgers.reduce((acc, curr) => acc + curr.points, 0) >= teamAveragePoints * (1 + rules.minMonthlyPointsPremium / 100);

      return {
        id: designer.id,
        name: `${designer.firstName} ${designer.lastName}`,
        worksCompleted: totalWorksCompleted,
        eligible: isEligible,
        reason: isEligible ? "Exceeds all point, first-pass and SLA delivery targets" : "Does not meet the point or volume threshold"
      };
    }).filter(p => p.eligible);

    return {
      topNumbers: {
        total,
        completed,
        pending,
        overdue,
        reworkRate,
        averageSatisfaction
      },
      clientTracker,
      leaderboard,
      weakAreas: {
        reworksByReason,
        reworksByCategory
      },
      specialDays,
      promotionList
    };
  },

  async importFromCsv(companyId: string, creatorUserId: string, rows: Array<{
    clientName: string;
    title: string;
    brief: string;
    category: string;
    priority: string;
    complexity: string;
    deadline: string;
  }>) {
    const creatorEmployee = await prisma.employee.findUnique({
      where: { userId: creatorUserId }
    });

    const results = [];
    for (const row of rows) {
      // Find or create Client
      let client = await prisma.client.findFirst({
        where: { name: row.clientName, companyId }
      });
      if (!client) {
        client = await prisma.client.create({
          data: { name: row.clientName, companyId }
        });
      }

      // Generate sequential workId e.g. ST-2026-0001
      const year = new Date().getFullYear();
      const start = startOfYear(new Date());
      const end = endOfYear(new Date());
      const count = await prisma.workCard.count({
        where: {
          companyId,
          createdAt: { gte: start, lte: end }
        }
      });
      const workId = `ST-${year}-${String(count + 1).padStart(4, "0")}`;

      const card = await prisma.workCard.create({
        data: {
          companyId,
          workId,
          clientId: client.id,
          title: row.title,
          brief: row.brief,
          category: row.category,
          priority: row.priority.toUpperCase(),
          complexity: row.complexity.toUpperCase(),
          deadline: new Date(row.deadline),
          assignedById: creatorEmployee?.id || null,
          status: "PENDING"
        }
      });

      await prisma.statusHistory.create({
        data: {
          workCardId: card.id,
          status: "PENDING",
          userId: creatorUserId
        }
      });

      results.push(card);
    }
    return results;
  }
};
