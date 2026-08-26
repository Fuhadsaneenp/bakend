import { Prisma, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError, notFound } from "../../lib/errors.js";
import { formatFullName } from "../../lib/formatName.js";
import { startOfYear, endOfYear, startOfMonth, endOfMonth, differenceInHours, addDays, isAfter } from "date-fns";
import { permissionService } from "../authority/permission.service.js";
import { accessResolverService } from "../authority/access-resolver.service.js";
import { scopeResolverService } from "../authority/scope-resolver.service.js";
import { notificationService } from "../notifications/notification.service.js";

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

const DESIGNER_ALLOWED_STATUSES = ["PENDING", "IN_PROGRESS", "WAITING", "FINISHED", "OUT_TO_DELIVER", "REWORK"];
const REVIEW_ALLOWED_STATUSES = ["PENDING", "WAITING", "OUT_TO_DELIVER", "IN_PROGRESS", "REWORK", "FINISHED", "APPROVED"];
const APPROVAL_ALLOWED_STATUSES = ["PENDING", "APPROVED", "REWORK", "WAITING", "OUT_TO_DELIVER", "IN_PROGRESS"];
const DATA_ENTRY_SHEETS_SETTING_KEY = "worktrack_data_entry_sheets_v1";

type DataEntrySheetRow = {
  count: number;
  category: string;
  companyName?: string;
  jobCount?: number | string;
  employeeName?: string;
  platformName?: string;
  sourceUrl: string;
  status: string;
};

type DataEntrySheetMap = Record<string, DataEntrySheetRow[]>;

function normalizeDataEntryRows(rows: unknown): DataEntrySheetRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.map((row: any, index) => ({
    count: Number.isFinite(Number(row?.count)) ? Number(row.count) : index + 1,
    category: typeof row?.category === "string" ? row.category : "",
    companyName: typeof row?.companyName === "string" ? row.companyName : (typeof row?.company === "string" ? row.company : ""),
    jobCount: row?.jobCount !== undefined && row?.jobCount !== null ? (Number.isFinite(Number(row.jobCount)) ? Number(row.jobCount) : String(row.jobCount)) : "",
    employeeName: typeof row?.employeeName === "string" ? row.employeeName : (typeof row?.employee === "string" ? row.employee : ""),
    platformName: typeof row?.platformName === "string" ? row.platformName : (typeof row?.platform === "string" ? row.platform : ""),
    sourceUrl: typeof row?.sourceUrl === "string" ? row.sourceUrl : "",
    status: typeof row?.status === "string" ? row.status : "Not Uploaded"
  }));
}

function normalizeDataEntrySheets(value: unknown): DataEntrySheetMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, rows]) => Boolean(key) && Array.isArray(rows))
      .map(([key, rows]) => [key, normalizeDataEntryRows(rows)])
  );
}

async function readDataEntrySheets(companyId: string) {
  const setting = await prisma.companySetting.findUnique({
    where: { companyId_key: { companyId, key: DATA_ENTRY_SHEETS_SETTING_KEY } }
  });

  return normalizeDataEntrySheets(setting?.value);
}

const META_RESULT_ACTION_TYPES = [
  "lead",
  "onsite_conversion.lead_grouped",
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_conversation_started",
  "messaging_conversation_started",
  "onsite_conversion.messaging_first_reply",
  "messaging_first_reply",
  "contact_total"
];

const META_RESULT_COST_ACTION_TYPES = new Set([
  ...META_RESULT_ACTION_TYPES
]);

function parseMetaNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : parseFloat(String(value || "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMetaInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : parseInt(String(value || "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMetaResultCount(insight: any) {
  if (!Array.isArray(insight?.actions)) return 0;
  for (const actionType of META_RESULT_ACTION_TYPES) {
    const action = insight.actions.find((row: any) => row.action_type === actionType);
    const value = parseMetaInteger(action?.value);
    if (value > 0) return value;
  }
  return 0;
}

function getMetaCostPerResult(insight: any) {
  if (!Array.isArray(insight?.cost_per_action_type)) return 0;
  for (const actionType of META_RESULT_ACTION_TYPES) {
    const resultCost = insight.cost_per_action_type.find((row: any) => row.action_type === actionType);
    const value = parseMetaNumber(resultCost?.value);
    if (value > 0) return value;
  }
  const resultCost = insight.cost_per_action_type.find((action: any) =>
    META_RESULT_COST_ACTION_TYPES.has(action.action_type)
  );
  return parseMetaNumber(resultCost?.value);
}

function normalizeMetaAdAccountId(accountId?: string | null) {
  if (!accountId) return "";
  const normalized = String(accountId).trim();
  return normalized.startsWith("act_") ? normalized : `act_${normalized}`;
}

async function fetchConnectedMetaAdAccounts(accessToken: string) {
  const accounts: Array<{ id: string; name: string }> = [];
  let nextUrl: string | null = null;
  const initialUrl = new URL("https://graph.facebook.com/v20.0/me/adaccounts");
  initialUrl.searchParams.set("fields", "id,account_id,name,account_status");
  initialUrl.searchParams.set("limit", "500");
  initialUrl.searchParams.set("access_token", accessToken);
  nextUrl = initialUrl.toString();

  while (nextUrl) {
    const res: Response = await fetch(nextUrl);
    const json: any = await res.json();
    if (!res.ok || json?.error) {
      throw new ApiError(502, json?.error?.message || "Meta ad accounts fetch failed");
    }

    for (const account of json?.data || []) {
      const id = normalizeMetaAdAccountId(account.id || account.account_id);
      if (!id) continue;
      accounts.push({
        id,
        name: account.name || id
      });
    }

    nextUrl = json?.paging?.next || null;
  }

  return accounts;
}

const trackAccessPermissionCodes: Record<string, string[]> = {
  designer: ["design.task.view", "design.task.upload", "design.review.submit", "design.approve"],
  "video-editor": ["video.task.view", "video.task.upload", "video.review.submit", "video.approve"],
  seo: ["seo.ranking.view", "seo.ranking.edit", "seo.backlink.view", "seo.backlink.edit", "seo.report.view"],
  "performance-marketing": ["performance.campaign.view", "performance.campaign.manage", "performance.report.export"],
  development: ["dev.task.view", "dev.task.manage", "dev.pr.review", "dev.deploy.approve"],
  "data-entry": ["data_entry.task.view", "data_entry.task.edit", "data_entry.file.upload", "data_entry.review.submit"]
};

const trackCoordinatorPermissionCodes: Record<string, string[]> = {
  designer: ["design.approve"],
  "video-editor": ["video.approve"],
  seo: ["seo.report.view"],
  "performance-marketing": ["performance.report.export"],
  development: ["dev.deploy.approve"],
  "data-entry": ["data_entry.review.submit"]
};

function isPureCoordinator(employee: {
  department?: { name?: string | null } | null;
  designation?: { title?: string | null } | null;
  assignedWorkCards?: any[] | null;
}) {
  const title = (employee.designation?.title || "").toLowerCase();
  const department = (employee.department?.name || "").toLowerCase();

  const isCoord =
    title.includes("coordinator") ||
    title.includes("co-ordinator") ||
    title.includes("coordinat");

  const isCreative =
    title.includes("designer") ||
    title.includes("design") ||
    title.includes("graphic") ||
    title.includes("video") ||
    title.includes("editor") ||
    title.includes("animat") ||
    title.includes("ui") ||
    title.includes("ux") ||
    title.includes("art") ||
    title.includes("creative");

  const hasCards = (employee.assignedWorkCards?.length || 0) > 0;
  return isCoord && !isCreative && !hasCards;
}

function employeeMatchesWorkTrack(employee: {
  department?: { name?: string | null } | null;
  designation?: { title?: string | null } | null;
  role?: string | null;
  user?: { role?: string | null } | null;
  assignedWorkCards?: any[] | null;
}, track?: string) {
  if (isPureCoordinator(employee)) {
    return false;
  }

  const title = (employee.designation?.title || "").toLowerCase();
  const department = (employee.department?.name || "").toLowerCase();
  const userRole = (employee.user?.role || employee.role || "").toUpperCase();
  const isSuperOrAdmin = userRole === "SUPER_ADMIN" || userRole === "HR_ADMIN";

  const isNonCreativeManagement =
    isSuperOrAdmin ||
    title.includes("growth") ||
    title.includes("sales") ||
    title.includes("business") ||
    title.includes("accountant") ||
    title.includes("finance") ||
    title.includes("hr ") ||
    title === "hr" ||
    title.includes("human resource") ||
    title.includes("digital marketer") ||
    title.includes("marketing manager") ||
    title.includes("marketing head") ||
    title.includes("growth head") ||
    title.includes("core team") ||
    title.includes("founder") ||
    title.includes("ceo") ||
    title.includes("director");

  const isVideoPerson = title.includes("video") || title.includes("motion") || title.includes("animat") || title.includes("editor") || title.includes("cinemat") || title.includes("colorist") || title.includes("videograph") || department.includes("video") || department.includes("production");
  const isDesignPerson = title.includes("designer") || title.includes("graphic") || title.includes("ui/ux") || title.includes("ui design") || title.includes("brand") || title.includes("visual") || title.includes("illustrat") || title.includes("creative") || (title.includes("design") && !isVideoPerson) || (department.includes("design") && !isVideoPerson && !isNonCreativeManagement);

  if (track === "designer") {
    if (isNonCreativeManagement && !title.includes("designer") && !title.includes("graphic")) return false;
    return isDesignPerson && !isVideoPerson;
  }
  if (track === "video-editor") {
    if (isNonCreativeManagement && !title.includes("editor") && !title.includes("video")) return false;
    return isVideoPerson && !title.includes("graphic designer");
  }
  if (track === "seo") {
    return title.includes("seo") || department.includes("seo");
  }
  if (track === "performance-marketing") {
    return title.includes("marketing") || title.includes("ads") || title.includes("media buyer") || department.includes("marketing") || department.includes("growth");
  }
  if (track === "development") {
    return title.includes("developer") || title.includes("engineer") || department.includes("development") || department.includes("tech");
  }
  if (track === "data-entry") {
    return title.includes("data") || title.includes("entry") || department.includes("data");
  }

  return false;
}

async function buildWorkCardScope(userId: string, card: {
  companyId: string;
  clientId: string;
  assignedToId?: string | null;
  assignedById?: string | null;
}) {
  const actor = await accessResolverService.getUserAccessContext(userId);
  return {
    actor,
    scope: {
      companyId: card.companyId,
      clientId: card.clientId,
      assignedToEmployeeId: card.assignedToId || null,
      createdByEmployeeId: card.assignedById || null,
      departmentId: actor.employee?.departmentId || null,
      officeId: actor.employee?.officeId || null
    }
  };
}

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

  async getDataEntrySheets(companyId: string) {
    return readDataEntrySheets(companyId);
  },

  async upsertDataEntrySheets(companyId: string, sheets: DataEntrySheetMap) {
    const existing = await readDataEntrySheets(companyId);
    const incoming = normalizeDataEntrySheets(sheets);
    const next = { ...existing, ...incoming };

    await prisma.companySetting.upsert({
      where: { companyId_key: { companyId, key: DATA_ENTRY_SHEETS_SETTING_KEY } },
      create: {
        companyId,
        key: DATA_ENTRY_SHEETS_SETTING_KEY,
        value: next as Prisma.InputJsonValue
      },
      update: {
        value: next as Prisma.InputJsonValue
      }
    });

    return next;
  },

  async getClients(companyId: string) {
    return prisma.client.findMany({
      where: { companyId },
      include: {
        accountManager: {
          select: { id: true, firstName: true, middleName: true, lastName: true }
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

  async updateClient(
    companyId: string,
    clientId: string,
    data: {
      name?: string;
      details?: string;
      contacts?: string;
      packageName?: string;
      postersCommitted?: number;
      videoSeo?: string;
      digitalMarketingActivities?: string;
      accountManagerId?: string | null;
    }
  ) {
    return prisma.client.update({
      where: { id: clientId, companyId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.details !== undefined ? { details: data.details } : {}),
        ...(data.contacts !== undefined ? { contacts: data.contacts } : {}),
        ...(data.packageName !== undefined ? { packageName: data.packageName } : {}),
        ...(data.postersCommitted !== undefined ? { postersCommitted: data.postersCommitted } : {}),
        ...(data.videoSeo !== undefined ? { videoSeo: data.videoSeo } : {}),
        ...(data.digitalMarketingActivities !== undefined ? { digitalMarketingActivities: data.digitalMarketingActivities } : {}),
        ...(data.accountManagerId !== undefined ? { accountManagerId: data.accountManagerId } : {})
      },
      include: {
        accountManager: {
          select: { id: true, firstName: true, middleName: true, lastName: true }
        },
        specialDays: true
      }
    });
  },

  async getDesigners(companyId: string, track?: string) {
    const employees = await prisma.employee.findMany({
      where: {
        companyId
      },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        personalEmail: true,
        userId: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true
          }
        },
        department: {
          select: {
            name: true
          }
        },
        designation: {
          select: {
            title: true
          }
        },
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

    const requiredCodes = track ? trackAccessPermissionCodes[track] : undefined;
    if (!requiredCodes?.length) return employees;
    const coordinatorCodes = track ? trackCoordinatorPermissionCodes[track] || [] : [];

    const trackAliases = track === "designer" 
      ? ["design", "designer"] 
      : track === "video-editor" 
        ? ["video", "video-editor"] 
        : track === "performance-marketing" 
          ? ["performance", "performance-marketing"] 
          : track === "data-entry" 
            ? ["data_entry", "data-entry"] 
            : track === "development" 
              ? ["dev", "development"] 
              : track ? [track] : [];

    // Load authority track settings
    const trackSetting = await prisma.companySetting.findUnique({
      where: {
        companyId_key: {
          companyId,
          key: "authority_user_track_settings"
        }
      }
    });

    let trackSettings: {
      trackLevels?: Record<string, any>;
      moduleGrants?: Record<string, any>;
      positionOverrides?: Record<string, any>;
    } = {};

    if (trackSetting?.value) {
      try {
        trackSettings = typeof trackSetting.value === "string" ? JSON.parse(trackSetting.value) : trackSetting.value;
      } catch {}
    }

    const filtered = [];
    for (const employee of employees) {
      const empId = employee.id;
      const empUserId = employee.userId || employee.user?.id || "";
      const empEmail = (employee.personalEmail || employee.user?.email || "").toLowerCase();
      const firstName = (employee.firstName || "").trim().toLowerCase();
      const middleName = (employee.middleName || "").trim().toLowerCase();
      const lastName = (employee.lastName || "").trim().toLowerCase();
      const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ").trim().toLowerCase();

      const lookupKeys = Array.from(new Set([
        empId,
        empUserId,
        empEmail,
        fullName,
        firstName,
        middleName,
        lastName,
        empEmail ? `email:${empEmail}` : "",
        fullName ? `employee-name:${fullName}` : ""
      ].filter(Boolean)));

      const title = (employee.designation?.title || "").toLowerCase();
      const userRole = (employee.user?.role || "").toUpperCase();
      const isSuperOrAdmin = userRole === "SUPER_ADMIN" || userRole === "HR_ADMIN";
      const isHeadTitle =
        title.includes("growth head") ||
        title.includes("marketing head") ||
        title.includes("department head") ||
        title.includes("dept head") ||
        title.includes("head of") ||
        title.includes("founder") ||
        title.includes("ceo") ||
        title.includes("director");

      // Only use DB role and designation title to identify heads — never track-level/grant settings
      const isHeadLevel = isSuperOrAdmin || isHeadTitle;

      // Heads (Super Admin, non-creative management) are NEVER shown on the board
      if (isHeadLevel) {
        continue;
      }

      // 1. Check Authority Settings explicitly
      //    explicitDenied is ONLY set by position overrides (admin deliberately placed them on a different track).
      //    overview-designer:false is a side-effect of track level "off" controlling what the person can SEE
      //    in their own workspace — it must NOT hide them from the coordinator/head board.
      let explicitAllowed: boolean | null = null;
      let explicitDenied = false; // Only set by position overrides, NOT by overview-designer:false
      for (const k of lookupKeys) {
        // Module grants check (overview-designer:true = admin explicitly added non-designer to board)
        const userGrants = trackSettings.moduleGrants?.[k];
        if (userGrants) {
          for (const alias of trackAliases) {
            if (userGrants[alias]?.["overview-designer"] === true) {
              explicitAllowed = true;
              break;
            }
            // NOTE: overview-designer:false is intentionally NOT setting explicitDenied here.
            // It is automatically written as a side-effect of track level "off" and should not
            // block natural designers from appearing on the coordinator/head team board.
          }
        }

        // Track levels check — "off" only blocks non-naturally-matched employees
        const userLevels = trackSettings.trackLevels?.[k];
        if (userLevels) {
          for (const alias of trackAliases) {
            const lvl = userLevels[alias];
            if (lvl === "off" && explicitAllowed !== true) {
              // Don't block; natural designation check below will still apply
              break;
            }
            if (lvl === "member") {
              explicitAllowed = true;
              break;
            }
          }
        }

        // Position overrides check — these ARE intentional explicit admin decisions
        const override = trackSettings.positionOverrides?.[k];
        if (override) {
          if (track === "designer") {
            if (override.position === "DESIGNER" || override.roles?.includes("designer")) {
              explicitAllowed = true;
              break;
            }
            if (override.position === "VIDEO_EDITOR" || override.roles?.includes("video-editor") || override.roles?.includes("video_editor")) {
              explicitAllowed = false;
              explicitDenied = true;
              break;
            }
          }
          if (track === "video-editor") {
            if (override.position === "VIDEO_EDITOR" || override.roles?.includes("video-editor") || override.roles?.includes("video_editor")) {
              explicitAllowed = true;
              break;
            }
            if (override.position === "DESIGNER" || override.roles?.includes("designer")) {
              explicitAllowed = false;
              explicitDenied = true;
              break;
            }
          }
          if (override.position === "COORDINATOR") {
            if (isPureCoordinator(employee)) {
              explicitAllowed = false;
              explicitDenied = true;
              break;
            }
          }
        }
        if (explicitAllowed !== null || explicitDenied) break;
      }

      // Position-override explicit deny (admin deliberately placed them on a different track)
      if (explicitDenied && explicitAllowed !== true) {
        continue;
      }

      if (explicitAllowed === true) {
        filtered.push(employee);
        continue;
      }

      // Natural designation match → ALWAYS include (even if track level is "off").
      // This is the primary rule: any employee whose designation/department matches the track
      // must appear on the coordinator/head board.
      if (employeeMatchesWorkTrack(employee, track)) {
        filtered.push(employee);
        continue;
      }

      // 2. Check Permissions from DB / access payload (for non-naturally-matched people)
      let hasTrackAccess = false;

      if (employee.userId) {
        const access = await permissionService.getAccessPayload(employee.userId);
        hasTrackAccess = access.permissions.some(
          (permission) => permission.allowed && requiredCodes.includes(permission.code)
        );
      }

      if (hasTrackAccess && !isPureCoordinator(employee)) {
        filtered.push(employee);
      }
    }

    return filtered;
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
    createdAt?: string;
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

    const creatorEmployee = await prisma.employee.findFirst({
      where: { userId: creatorUserId, companyId }
    });

    const card = await prisma.workCard.create({
      data: {
        companyId,
        clientId: data.clientId,
        workId,
        title: data.title,
        brief: data.brief,
        category: data.category,
        priority: data.priority ? data.priority.toUpperCase() : "MEDIUM",
        complexity: data.complexity ? data.complexity.toUpperCase() : "MEDIUM",
        deadline: new Date(data.deadline),
        createdAt: data.createdAt ? new Date(data.createdAt) : undefined,
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

    // Send in-app / push notification if assigned
    if (data.assignedToId) {
      const assignedEmployee = await prisma.employee.findUnique({
        where: { id: data.assignedToId },
        select: { userId: true }
      });
      if (assignedEmployee?.userId) {
        const assignerName = creatorEmployee
          ? `${creatorEmployee.firstName} ${creatorEmployee.lastName || ""}`.trim()
          : "Manager";
        notificationService.notifyTaskAssigned({
          assignedUserId: assignedEmployee.userId,
          assignerName,
          taskTitle: card.title,
          taskId: card.id,
          metadata: { workId: card.workId, category: card.category }
        }).catch((e) => console.error("[WorkTrack] Task assigned notification error:", e));
      }
    }

    return card;
  },

  async getWorkCards(companyId: string, userId: string, filters: {
    clientId?: string;
    assignedToId?: string;
    status?: string;
    priority?: string;
  }) {
    // Return all created work cards for the company so Client Work Calendar, team views, and client track can show all tasks. (Kanban boards isolate per designer on frontend)
    return prisma.workCard.findMany({
      where: {
        companyId,
        clientId: filters.clientId || undefined,
        assignedToId: filters.assignedToId || undefined,
        status: filters.status || undefined,
        priority: filters.priority ? filters.priority.toUpperCase() : undefined
      },
      include: {
        client: true,
        assignedTo: { select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } }, department: { select: { name: true } } } },
        assignedBy: { select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } }, department: { select: { name: true } } } },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
                employee: {
                  select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } } }
                }
              }
            }
          },
          orderBy: { createdAt: "asc" }
        },
        reworkLogs: {
          include: {
            chargedTo: {
              select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } } }
            }
          },
          orderBy: { createdAt: "desc" }
        },
        statusHistory: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
                employee: {
                  select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } } }
                }
              }
            }
          },
          orderBy: { createdAt: "asc" }
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
        assignedTo: { select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } }, department: { select: { name: true } } } },
        assignedBy: { select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } }, department: { select: { name: true } } } },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
                employee: {
                  select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } } }
                }
              }
            }
          },
          orderBy: { createdAt: "asc" }
        },
        reworkLogs: {
          include: {
            chargedTo: {
              select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } } }
            }
          },
          orderBy: { createdAt: "desc" }
        },
        statusHistory: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
                employee: {
                  select: { id: true, firstName: true, middleName: true, lastName: true, designation: { select: { title: true } } }
                }
              }
            }
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });
    if (!card) throw notFound("Work Card");
    return card;
  },

  async deleteWorkCard(companyId: string, userId: string, id: string) {
    const card = await prisma.workCard.findUnique({ where: { id } });
    if (!card || card.companyId !== companyId) throw notFound("Work Card");

    const scope = {
      companyId: card.companyId,
      clientId: card.clientId,
      assignedToEmployeeId: card.assignedToId || null,
      createdByEmployeeId: card.assignedById || null
    };

    const actor = await accessResolverService.getUserAccessContext(userId);
    const userRoleStr = String(actor.user.role || "").toUpperCase();
    const isAdmin = userRoleStr === "SUPER_ADMIN" || userRoleStr === "HR_ADMIN" || Boolean((actor.user as any).impersonatedBy);
    let canDelete = isAdmin;

    if (!canDelete) {
      canDelete = await permissionService.hasPermission(userId, "worktrack.task.delete", scope)
        || await permissionService.hasPermission(userId, "worktrack.review.approve", scope);
    }

    if (!canDelete && actor.employee?.id) {
      // Allow if user is creator or assigned
      if (card.assignedById === actor.employee.id || card.assignedToId === actor.employee.id) {
        canDelete = true;
      }

      if (!canDelete) {
        const empRecord = await prisma.employee.findUnique({
          where: { id: actor.employee.id },
          include: { designation: true }
        });
        const title = (empRecord?.designation?.title || "").toLowerCase();
        canDelete =
          title.includes("coordinator") ||
          title.includes("head") ||
          title.includes("manager") ||
          title.includes("lead") ||
          title.includes("director") ||
          title.includes("admin");
      }
    }

    if (!canDelete) {
      throw new ApiError(403, "You do not have permission to delete this task.");
    }

    await prisma.statusHistory.deleteMany({ where: { workCardId: id } });
    await prisma.reworkLog.deleteMany({ where: { workCardId: id } });
    await prisma.comment.deleteMany({ where: { workCardId: id } });
    await prisma.rating.deleteMany({ where: { workCardId: id } });
    await prisma.pointsLedger.updateMany({
      where: { workCardId: id },
      data: { workCardId: null }
    });

    return prisma.workCard.delete({ where: { id } });
  },

  async clearAllTasks(companyId: string, userId: string, track?: string) {
    const actor = await accessResolverService.getUserAccessContext(userId);
    const userRoleStr = String(actor.user.role || "").toUpperCase();
    const isSuperAdmin = userRoleStr === "SUPER_ADMIN" || Boolean((actor.user as any).impersonatedBy);
    if (!isSuperAdmin) {
      throw new ApiError(403, "Only Super Admin can clear all tasks.");
    }

    const whereClause: any = { companyId };
    if (track && track !== "all") {
      const normalized = track.toLowerCase().replace(/-/g, "_");
      whereClause.OR = [
        { category: { equals: track, mode: "insensitive" } },
        { category: { equals: normalized, mode: "insensitive" } },
        { category: { contains: track, mode: "insensitive" } }
      ];
    }

    const targetCards = await prisma.workCard.findMany({
      where: whereClause,
      select: { id: true }
    });

    const cardIds = targetCards.map(c => c.id);
    if (cardIds.length > 0) {
      await prisma.statusHistory.deleteMany({ where: { workCardId: { in: cardIds } } });
      await prisma.reworkLog.deleteMany({ where: { workCardId: { in: cardIds } } });
      await prisma.comment.deleteMany({ where: { workCardId: { in: cardIds } } });
      await prisma.rating.deleteMany({ where: { workCardId: { in: cardIds } } });
      await prisma.pointsLedger.updateMany({
        where: { workCardId: { in: cardIds } },
        data: { workCardId: null }
      });
      await prisma.workCard.deleteMany({ where: { id: { in: cardIds } } });
    }

    return { success: true, count: cardIds.length };
  },

  async clearAllWorkHistory(companyId: string, userId: string, track?: string) {
    const actor = await accessResolverService.getUserAccessContext(userId);
    const userRoleStr = String(actor.user.role || "").toUpperCase();
    const isSuperAdmin = userRoleStr === "SUPER_ADMIN" || Boolean((actor.user as any).impersonatedBy);
    if (!isSuperAdmin) {
      throw new ApiError(403, "Only Super Admin can clear work history.");
    }

    const whereClause: any = { companyId };
    if (track && track !== "all") {
      const normalized = track.toLowerCase().replace(/-/g, "_");
      whereClause.OR = [
        { category: { equals: track, mode: "insensitive" } },
        { category: { equals: normalized, mode: "insensitive" } },
        { category: { contains: track, mode: "insensitive" } }
      ];
    }

    const targetCards = await prisma.workCard.findMany({
      where: whereClause,
      select: { id: true }
    });

    const cardIds = targetCards.map(c => c.id);
    if (cardIds.length > 0) {
      await prisma.statusHistory.deleteMany({ where: { workCardId: { in: cardIds } } });
      await prisma.reworkLog.deleteMany({ where: { workCardId: { in: cardIds } } });
      await prisma.workCard.updateMany({
        where: { id: { in: cardIds } },
        data: { reworkCount: 0, status: "PENDING" }
      });
    }

    return { success: true, count: cardIds.length };
  },

  async updateWorkCardFields(companyId: string, id: string, data: {
    userId: string,
    priority?: string;
    assignedToId?: string | null;
    status?: string;
    title?: string;
    brief?: string;
    deadline?: string;
    createdAt?: string;
    files?: string;
  }) {
    const card = await prisma.workCard.findUnique({ where: { id } });
    if (!card || card.companyId !== companyId) throw notFound("Work Card");

    const scope = {
      companyId: card.companyId,
      clientId: card.clientId,
      assignedToEmployeeId: card.assignedToId || null,
      createdByEmployeeId: card.assignedById || null
    };

    const actor = await accessResolverService.getUserAccessContext(data.userId);
    const userRoleStr = String(actor.user.role || "").toUpperCase();
    const isCompanyAdmin = userRoleStr === "SUPER_ADMIN" || userRoleStr === "COMPANY_ADMIN" || userRoleStr === "HR_MANAGER";

    let isCoordinator = isCompanyAdmin;
    if (!isCoordinator && actor.employee?.id) {
      const empRecord = await prisma.employee.findUnique({
        where: { id: actor.employee.id },
        include: { designation: true }
      });
      const title = (empRecord?.designation?.title || "").toLowerCase();
      const email = (actor.user.email || empRecord?.personalEmail || (empRecord as any)?.email || "").toLowerCase();
      const fullName = `${empRecord?.firstName || ""} ${empRecord?.lastName || ""}`.toLowerCase();
      if (
        title.includes("coordinator") ||
        title.includes("manager") ||
        title.includes("lead") ||
        title.includes("head") ||
        title.includes("director") ||
        title.includes("marketer") ||
        title.includes("marketing") ||
        title.includes("growth") ||
        title.includes("specialist") ||
        title.includes("executive") ||
        fullName.includes("sherin") ||
        email.includes("fathima") ||
        fullName.includes("salahudeen") ||
        email.includes("salahudeen") ||
        (card.assignedById && card.assignedById === actor.employee.id)
      ) {
        isCoordinator = true;
      }
    }

    if (!isCoordinator) {
      if (card.assignedToId && actor.employee?.id && card.assignedToId !== actor.employee.id) {
        throw new ApiError(403, "View access only");
      }
      if (data.assignedToId !== undefined) {
        await permissionService.requirePermission(data.userId, "worktrack.task.assign", scope);
      } else if (data.status !== undefined && Object.keys(data).filter(k => k !== "userId" && k !== "status").length === 0) {
        await permissionService.requireAnyPermission(data.userId, ["worktrack.task.status.update", "worktrack.review.review", "worktrack.review.approve", "worktrack.review.reject", "worktrack.task.edit"], scope);
      } else if (data.files !== undefined && Object.keys(data).filter(k => k !== "userId" && k !== "files").length === 0) {
        await permissionService.requireAnyPermission(data.userId, ["worktrack.file.upload", "worktrack.task.edit", "worktrack.task.status.update"], scope);
      } else {
        await permissionService.requirePermission(data.userId, "worktrack.task.edit", scope);
      }
    }

    // Capture previous status for transitions
    const previousStatus = card.status;
    let nextStatus = data.status || previousStatus;

    if (data.status && data.status !== previousStatus) {
      const isStatusCoordinator = isCoordinator;
      const isDesigner = !isCompanyAdmin && !isStatusCoordinator;

      if (isDesigner) {
        if (!DESIGNER_ALLOWED_STATUSES.includes(data.status.toUpperCase())) {
          throw new ApiError(403, "Designers can only move tasks between Pending, In Progress, and Waiting Review.");
        }
        if (previousStatus === "APPROVED") {
          throw new ApiError(403, "Approved tasks are completed and locked. Designers cannot change the status of approved tasks unless rework is requested.");
        }
      }
    }

    let updateData: any = {};
    if (data.priority) updateData.priority = data.priority.toUpperCase();
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId || null;
    if (data.status) updateData.status = data.status.toUpperCase();
    if (data.title) updateData.title = data.title;
    if (data.brief !== undefined) updateData.brief = data.brief;
    if (data.deadline !== undefined) updateData.deadline = data.deadline;
    if (data.createdAt !== undefined) updateData.createdAt = new Date(data.createdAt);
    if (data.files !== undefined) updateData.files = data.files;

    if (data.status && data.status.toUpperCase() !== previousStatus) {
      await prisma.statusHistory.create({
        data: {
          workCardId: id,
          status: data.status.toUpperCase(),
          userId: data.userId
        }
      });
    }

    const updated = await prisma.workCard.update({
      where: { id },
      data: updateData
    });

    if (data.assignedToId && data.assignedToId !== card.assignedToId) {
      try {
        const assignedEmployee = await prisma.employee.findUnique({
          where: { id: data.assignedToId },
          select: { userId: true }
        });
        if (assignedEmployee?.userId) {
          const assignerRecord = await prisma.employee.findFirst({ where: { userId: data.userId } });
          const assignerName = assignerRecord
            ? `${assignerRecord.firstName} ${assignerRecord.lastName || ""}`.trim()
            : "Manager";
          notificationService.notifyTaskAssigned({
            assignedUserId: assignedEmployee.userId,
            assignerName,
            taskTitle: card.title,
            taskId: card.id,
            metadata: { workId: card.workId, category: card.category }
          }).catch(() => {});
        }
      } catch {}
    }

    return this.getWorkCardDetails(id);
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
      include: { assignedTo: true, client: true }
    });
    if (!card) throw notFound("Work Card");

    const actor = await accessResolverService.getUserAccessContext(userId);
    const scope = {
      companyId: card.companyId,
      clientId: card.clientId,
      assignedToEmployeeId: card.assignedToId || null,
      createdByEmployeeId: card.assignedById || null,
      departmentId: card.assignedTo?.departmentId || null,
      officeId: card.assignedTo?.officeId || null
    };

    const newStatus = data.status.toUpperCase();
    const prevStatus = card.status;

    const userRoleStr = String(actor.user.role || "").toUpperCase();
    const isHeadOrAdminRole = userRoleStr === "SUPER_ADMIN" || userRoleStr === "COMPANY_ADMIN" || userRoleStr === "HR_MANAGER";

    let isHead = isHeadOrAdminRole;
    let isCoordinator = isHeadOrAdminRole;

    if (actor.employee?.id) {
      const empRecord = await prisma.employee.findUnique({
        where: { id: actor.employee.id },
        include: { designation: true }
      });
      const title = (empRecord?.designation?.title || "").toLowerCase();
      const email = (actor.user.email || empRecord?.personalEmail || (empRecord as any)?.email || "").toLowerCase();
      const fullName = `${empRecord?.firstName || ""} ${empRecord?.lastName || ""}`.toLowerCase();
      if (title.includes("head") || title.includes("admin") || title.includes("director")) {
        isHead = true;
        isCoordinator = true;
      } else if (
        title.includes("coordinator") ||
        title.includes("manager") ||
        title.includes("lead") ||
        title.includes("marketer") ||
        title.includes("marketing") ||
        title.includes("growth") ||
        title.includes("specialist") ||
        title.includes("executive") ||
        fullName.includes("sherin") ||
        email.includes("fathima") ||
        fullName.includes("salahudeen") ||
        email.includes("salahudeen") ||
        (card.assignedById && card.assignedById === actor.employee.id)
      ) {
        isCoordinator = true;
      }
    }

    if (isHead || isCoordinator) {
      // Department Head, Super Admin, Coordinators, and Marketers/Reviewers can set workflow statuses
    } else {
      // Designers / Team Members can only move their own tasks between Pending, In Progress, Waiting Review
      if (card.assignedToId && actor.employee?.id && card.assignedToId !== actor.employee.id) {
        throw new ApiError(403, "View access only");
      }
      if (prevStatus === "APPROVED") {
        throw new ApiError(403, "Approved tasks are completed and locked. Designers cannot change the status of approved tasks unless rework is requested.");
      }
      if (!DESIGNER_ALLOWED_STATUSES.includes(newStatus)) {
        throw new ApiError(403, "Designers can only move tasks between Pending, In Progress, and Waiting Review.");
      }
    }

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
          status: "REWORK"
        }
      });

      // Notify Designer
      if (card.assignedTo?.userId) {
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
      const now = new Date();
      const onTime = card.deadline ? !isAfter(now, new Date(card.deadline)) : true;
      const isClientDelay = data.rulingType === "client_delay";
      const effectiveOnTime = onTime || isClientDelay;

      let finalPoints = 5;
      let ledgerDesc = "";

      if (!effectiveOnTime) {
        // Delivered late / overdue: 1 point
        finalPoints = 1;
        ledgerDesc = `1 Point earned (Overdue delivery penalty - delivered after deadline)`;
      } else if (card.reworkCount > 2) {
        // Exceeded 2 edits / rework rounds: 3 points
        finalPoints = 3;
        ledgerDesc = `3 Points earned (Completed with ${card.reworkCount} edits/rework rounds - beyond 2 edits limit)`;
      } else {
        // Completed within 2 edits on time: 5 points
        finalPoints = 5;
        ledgerDesc = `5 Points earned (Completed on time within ${card.reworkCount} edit${card.reworkCount === 1 ? "" : "s"})`;
      }

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
        if (card.assignedTo?.userId) {
          await prisma.notification.create({
            data: {
              userId: card.assignedTo.userId,
              channel: "IN_APP",
              subject: "Work Approved & Points Earned",
              body: `Congratulations! ${card.workId} approved. You earned ${finalPoints} points (${ledgerDesc}).`
            }
          });
        }
      }

      // Notify Managers and Coordinators of completion
      try {
        const empName = card.assignedTo
          ? `${card.assignedTo.firstName} ${card.assignedTo.lastName || ""}`.trim()
          : "Team Member";
        notificationService.notifyTaskCompleted({
          companyId: card.companyId,
          taskTitle: card.title,
          taskId: card.id,
          employeeName: empName,
          employeeUserId: userId
        }).catch(() => {});
      } catch {}
    }

    // Handle Under Review / Submission alert to managers & coordinators
    if (
      (newStatus === "OUT_TO_DELIVER" || newStatus === "WAITING_REVIEW" || newStatus === "IN_REVIEW") &&
      prevStatus !== newStatus
    ) {
      try {
        const empRecord = await prisma.employee.findFirst({ where: { userId } });
        const empName = empRecord
          ? `${empRecord.firstName} ${empRecord.lastName || ""}`.trim()
          : "Employee";
        notificationService.notifyTaskUnderReview({
          companyId: card.companyId,
          taskTitle: card.title,
          taskId: card.id,
          employeeName: empName,
          employeeUserId: userId
        }).catch(() => {});
      } catch {}
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
        name: formatFullName(designer),
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
        name: formatFullName(designer),
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
  },

  async getMetaClients(companyId: string) {
    const tokenSource = await prisma.metaAdAccount.findFirst({
      where: {
        companyId,
        accessToken: { not: null }
      },
      orderBy: { updatedAt: "desc" }
    });

    const tokenCandidates = [
      process.env.META_ACCESS_TOKEN,
      tokenSource?.accessToken
    ].filter(Boolean) as string[];

    let validToken: string | null = null;
    let connectedAccounts: Array<{ id: string; name: string }> = [];

    for (const token of tokenCandidates) {
      try {
        const accounts = await fetchConnectedMetaAdAccounts(token);
        if (accounts && accounts.length > 0) {
          validToken = token;
          connectedAccounts = accounts;
          break;
        }
      } catch (error: any) {
        console.warn("Meta token candidate check failed:", error?.message || error);
      }
    }

    if (validToken && connectedAccounts.length > 0) {
      try {
        for (const account of connectedAccounts) {
          // Check if ad account or client with matching name already exists
          let existingAccount = await prisma.metaAdAccount.findFirst({
            where: {
              companyId,
              adAccountId: account.id
            },
            include: { client: true }
          });

          if (!existingAccount) {
            const matchingClient = await prisma.client.findFirst({
              where: {
                companyId,
                name: account.name
              }
            });

            if (matchingClient) {
              const clientMetaAcc = await prisma.metaAdAccount.findUnique({
                where: { clientId: matchingClient.id }
              });

              if (clientMetaAcc) {
                existingAccount = await prisma.metaAdAccount.update({
                  where: { id: clientMetaAcc.id },
                  data: {
                    adAccountId: account.id,
                    accessToken: validToken,
                    tokenStatus: "VALID",
                    connectionStatus: "CONNECTED",
                    syncFrequency: "DAILY"
                  },
                  include: { client: true }
                });
              } else {
                existingAccount = await prisma.metaAdAccount.create({
                  data: {
                    companyId,
                    clientId: matchingClient.id,
                    adAccountId: account.id,
                    accessToken: validToken,
                    tokenStatus: "VALID",
                    connectionStatus: "CONNECTED",
                    syncFrequency: "DAILY"
                  },
                  include: { client: true }
                });
              }
            }
          }

          if (existingAccount) {
            await prisma.client.update({
              where: { id: existingAccount.clientId },
              data: {
                name: existingAccount.client.name || account.name
              }
            }).catch(() => {});
            await prisma.metaAdAccount.update({
              where: { id: existingAccount.id },
              data: {
                adAccountId: account.id,
                accessToken: validToken,
                tokenStatus: "VALID",
                connectionStatus: "CONNECTED",
                syncFrequency: "DAILY"
              }
            }).catch(() => {});
            continue;
          }

          const client = await prisma.client.create({
            data: {
              companyId,
              name: account.name,
              details: `Meta Ad Account (${account.id})`,
              packageName: "Performance Marketing"
            }
          });

          await prisma.metaAdAccount.create({
            data: {
              companyId,
              clientId: client.id,
              adAccountId: account.id,
              accessToken: validToken,
              tokenStatus: "VALID",
              connectionStatus: "CONNECTED",
              syncFrequency: "DAILY"
            }
          });
        }
      } catch (error: any) {
        console.warn("Unable to reconcile Meta ad accounts:", error?.message || error);
      }
    }

    const clients = await prisma.client.findMany({
      where: {
        companyId
      },
      include: {
        metaAdAccount: true,
        metaCampaigns: {
          select: {
            id: true,
            status: true,
            amountSpent: true,
            leads: true,
            conversions: true,
            roas: true
          }
        }
      },
      orderBy: { name: "asc" }
    });

    const mappedClients = clients.map(c => {
      const activeCampaignsCount = c.metaCampaigns.filter(camp => camp.status === "ACTIVE").length;
      const totalSpend = c.metaCampaigns.reduce((sum, camp) => sum + (camp.amountSpent || 0), 0);
      const totalLeads = c.metaCampaigns.reduce((sum, camp) => sum + (camp.leads || 0), 0);
      const totalConversions = c.metaCampaigns.reduce((sum, camp) => sum + (camp.conversions || 0), 0);
      const blendedRoas = c.metaCampaigns.length > 0
        ? Number((c.metaCampaigns.reduce((sum, camp) => sum + (camp.roas || 0), 0) / c.metaCampaigns.length).toFixed(2))
        : 0;

      return {
        id: c.id,
        name: c.name,
        details: c.details,
        packageName: c.packageName,
        metaAdAccount: c.metaAdAccount,
        stats: {
          campaignsCount: c.metaCampaigns.length,
          activeCampaignsCount,
          totalSpend,
          totalLeads,
          totalConversions,
          blendedRoas
        }
      };
    });

    // Sort: Connected accounts with campaigns/spend first, then connected accounts, then other clients
    return mappedClients.sort((a, b) => {
      const aConnected = a.metaAdAccount?.connectionStatus === "CONNECTED" && a.metaAdAccount?.tokenStatus === "VALID";
      const bConnected = b.metaAdAccount?.connectionStatus === "CONNECTED" && b.metaAdAccount?.tokenStatus === "VALID";
      if (aConnected && !bConnected) return -1;
      if (!aConnected && bConnected) return 1;

      if ((b.stats?.totalSpend || 0) !== (a.stats?.totalSpend || 0)) {
        return (b.stats?.totalSpend || 0) - (a.stats?.totalSpend || 0);
      }
      if ((b.stats?.campaignsCount || 0) !== (a.stats?.campaignsCount || 0)) {
        return (b.stats?.campaignsCount || 0) - (a.stats?.campaignsCount || 0);
      }
      return a.name.localeCompare(b.name);
    });
  },

  async syncAllMetaAccounts(companyId: string, options: { since?: string; until?: string; datePreset?: string } = {}) {
    const clients = await this.getMetaClients(companyId);
    const connectedClients = clients.filter(c => c.metaAdAccount?.connectionStatus === "CONNECTED" && c.metaAdAccount?.adAccountId);
    const results: any[] = [];

    for (const client of connectedClients) {
      try {
        const syncResult = await this.syncMetaAccount(companyId, client.id, options);
        results.push({ clientId: client.id, name: client.name, success: true, count: syncResult.metaCampaigns?.length || 0 });
      } catch (err: any) {
        console.warn(`Sync failed for ${client.name} (${client.id}):`, err?.message || err);
        results.push({ clientId: client.id, name: client.name, success: false, error: err?.message || "Sync failed" });
      }
    }

    return {
      success: true,
      syncedAt: new Date(),
      totalAccounts: connectedClients.length,
      results
    };
  },

  async getMetaAccountDetails(companyId: string, clientId: string) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, companyId },
      include: {
        metaAdAccount: true,
        metaCampaigns: {
          include: {
            assignedMarketer: {
              select: {
                id: true,
                firstName: true,
                lastName: true
              }
            }
          },
          orderBy: { createdAt: "desc" }
        },
        metaDailyInsights: {
          orderBy: { date: "asc" },
          take: 30
        }
      }
    });

    if (!client) throw notFound("Client not found");
    return client;
  },

  async updateMetaAccount(companyId: string, clientId: string, data: any) {
    const client = await prisma.client.findFirst({ where: { id: clientId, companyId } });
    if (!client) throw notFound("Client not found");

    let tokenStatus = data.tokenStatus || (data.accessToken ? "VALID" : "NOT_CONFIGURED");
    let connectionStatus = data.connectionStatus || (data.accessToken ? "CONNECTED" : "DISCONNECTED");

    if (data.accessToken) {
      try {
        const testRes = await fetch(`https://graph.facebook.com/v20.0/me?access_token=${data.accessToken}`);
        const testJson: any = await testRes.json();
        if (!testRes.ok || testJson?.error) {
          tokenStatus = "EXPIRED";
          connectionStatus = "DISCONNECTED";
        } else {
          tokenStatus = "VALID";
          connectionStatus = "CONNECTED";
        }
      } catch {
        tokenStatus = "EXPIRED";
        connectionStatus = "DISCONNECTED";
      }
    }

    const normalizedAdAccountId = data.adAccountId ? normalizeMetaAdAccountId(data.adAccountId) : null;

    const adAccount = await prisma.metaAdAccount.upsert({
      where: { clientId },
      create: {
        companyId,
        clientId,
        businessManagerId: data.businessManagerId || null,
        adAccountId: normalizedAdAccountId,
        pageId: data.pageId || null,
        instagramAccountId: data.instagramAccountId || null,
        pixelId: data.pixelId || null,
        accessToken: data.accessToken || null,
        tokenStatus,
        connectionStatus,
        syncFrequency: data.syncFrequency || "DAILY",
        lastSyncedAt: new Date()
      },
      update: {
        businessManagerId: data.businessManagerId,
        adAccountId: normalizedAdAccountId,
        pageId: data.pageId,
        instagramAccountId: data.instagramAccountId,
        pixelId: data.pixelId,
        accessToken: data.accessToken !== undefined ? data.accessToken : undefined,
        tokenStatus,
        connectionStatus,
        syncFrequency: data.syncFrequency,
        lastSyncedAt: new Date()
      }
    });

    // If valid token and account ID, trigger async live sync
    if (tokenStatus === "VALID" && normalizedAdAccountId && data.accessToken) {
      this.syncMetaAccount(companyId, clientId).catch((err) => {
        console.warn("Background sync after Meta account update failed:", err?.message || err);
      });
    }

    return adAccount;
  },

  async syncMetaAccount(companyId: string, clientId: string, options: { since?: string; until?: string; datePreset?: string } = {}) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, companyId },
      include: { metaAdAccount: true }
    });
    if (!client) throw notFound("Client not found");

    const token = client.metaAdAccount?.accessToken || process.env.META_ACCESS_TOKEN;
    const adAccountId = client.metaAdAccount?.adAccountId;

    const now = new Date();
    const syncedCampaigns: any[] = [];

    if (!adAccountId || !token) {
      throw new ApiError(400, "Meta ad account or access token is not configured for this client");
    }

    try {
      // Fetch campaign metadata separately from insights. The selected date range
      // belongs to insights/results, never to campaign created date.
      const campaignParams = new URLSearchParams({
        fields: "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time",
        limit: "500",
        effective_status: JSON.stringify(["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES"]),
        access_token: token
      });
      const campUrl = `https://graph.facebook.com/v20.0/${adAccountId}/campaigns?${campaignParams.toString()}`;
      const campRes = await fetch(campUrl);
      const campJson = await campRes.json();
      if (!campRes.ok || campJson?.error) {
        throw new ApiError(502, campJson?.error?.message || "Meta campaigns fetch failed");
      }
      const campaigns = campJson?.data || [];
      const campaignsById = new Map<string, any>();
      for (const campaign of campaigns) {
        campaignsById.set(String(campaign.id), campaign);
      }

      // Fetch campaign-level insights for the selected Meta Ads reporting window.
      // This changes metrics only; it does not filter campaigns by created date.
      const insightsParams = new URLSearchParams({
        level: "campaign",
        fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,cpc,cpm,ctr,actions,cost_per_action_type,purchase_roas",
        limit: "500",
        access_token: token
      });
      if (options.since && options.until) {
        insightsParams.set("time_range", JSON.stringify({ since: options.since, until: options.until }));
      } else {
        insightsParams.set("date_preset", options.datePreset || "maximum");
      }
      const insUrl = `https://graph.facebook.com/v20.0/${adAccountId}/insights?${insightsParams.toString()}`;
      const insRes = await fetch(insUrl);
      const insJson = await insRes.json();
      if (!insRes.ok || insJson?.error) {
        throw new ApiError(502, insJson?.error?.message || "Meta insights fetch failed");
      }
      const insightsMap: Record<string, any> = {};
      if (insJson?.data && Array.isArray(insJson.data)) {
        for (const row of insJson.data) {
          insightsMap[row.campaign_id] = row;
        }
      }

      const selectedCampaignIds = options.since && options.until
        ? Object.keys(insightsMap).filter((campaignId) => getMetaResultCount(insightsMap[campaignId]) > 0)
        : Array.from(new Set([...campaigns.map((camp: any) => String(camp.id)), ...Object.keys(insightsMap)]));

      for (const campaignId of selectedCampaignIds) {
        const ins = insightsMap[campaignId] || {};
        const camp = campaignsById.get(campaignId) || {
          id: campaignId,
          name: ins.campaign_name || "Untitled campaign",
          status: "PAUSED",
          objective: "",
          daily_budget: null,
          lifetime_budget: null,
          created_time: null,
          start_time: null
        };
        const spend = parseMetaNumber(ins.spend);
        const impressions = parseMetaInteger(ins.impressions);
        const reach = parseMetaInteger(ins.reach);
        const clicks = parseMetaInteger(ins.clicks);
        const ctr = parseMetaNumber(ins.ctr);
        const cpc = parseMetaNumber(ins.cpc);
        const cpm = parseMetaNumber(ins.cpm);
        const leads = getMetaResultCount(ins);
        const costPerResult = getMetaCostPerResult(ins);

        let roas = 0;
        if (ins.purchase_roas && Array.isArray(ins.purchase_roas) && ins.purchase_roas.length > 0) {
          roas = parseFloat(ins.purchase_roas[0].value || "0");
        }

        const dailyBudget = camp.daily_budget ? Math.round(parseInt(camp.daily_budget, 10) / 100) : 0;
        const lifetimeBudget = camp.lifetime_budget ? Math.round(parseInt(camp.lifetime_budget, 10) / 100) : null;
        const metaStatus = camp.status === "ACTIVE" ? "ACTIVE" : "PAUSED";

        let metaObjective = "ENGAGEMENT";
        const objStr = (camp.objective || "").toUpperCase();
        if (objStr.includes("LEAD")) metaObjective = "LEADS";
        else if (objStr.includes("CONVERSION") || objStr.includes("OUTCOME_SALES")) metaObjective = "CONVERSIONS";
        else if (objStr.includes("TRAFFIC")) metaObjective = "TRAFFIC";
        else if (objStr.includes("MESSAGE")) metaObjective = "MESSAGES";
        else if (objStr.includes("ENGAGEMENT")) metaObjective = "ENGAGEMENT";

        const campCreatedDate = camp.created_time ? new Date(camp.created_time) : (camp.start_time ? new Date(camp.start_time) : null);

        const existingCamp = await prisma.metaCampaign.findFirst({
          where: { clientId: client.id, metaCampaignId: camp.id }
        });

        let savedCampaign;
        if (existingCamp) {
          savedCampaign = await prisma.metaCampaign.update({
            where: { id: existingCamp.id },
            data: {
              name: camp.name,
              status: metaStatus,
              objective: metaObjective,
              dailyBudget,
              lifetimeBudget,
              amountSpent: spend,
              impressions,
              reach,
              clicks,
              ctr: Number(ctr.toFixed(2)),
              cpc: Number(cpc.toFixed(2)),
              cpm: Number(cpm.toFixed(2)),
              leads,
              conversions: 0,
              costPerResult: Number(costPerResult.toFixed(2)),
              roas: Number(roas.toFixed(1)),
              startDate: campCreatedDate || existingCamp.startDate
            }
          });
        } else {
          savedCampaign = await prisma.metaCampaign.create({
            data: {
              company: { connect: { id: companyId } },
              client: { connect: { id: client.id } },
              metaCampaignId: camp.id,
              name: camp.name,
              status: metaStatus,
              objective: metaObjective,
              dailyBudget,
              lifetimeBudget,
              amountSpent: spend,
              impressions,
              reach,
              clicks,
              ctr: Number(ctr.toFixed(2)),
              cpc: Number(cpc.toFixed(2)),
              cpm: Number(cpm.toFixed(2)),
              leads,
              messages: 0,
              conversions: 0,
              costPerResult: Number(costPerResult.toFixed(2)),
              roas: Number(roas.toFixed(1)),
              startDate: campCreatedDate,
              createdAt: campCreatedDate || undefined,
              creativeType: "IMAGE",
              notes: camp.name
            }
          });
        }

        syncedCampaigns.push(savedCampaign);
      }
    } catch (err) {
      console.error("Error syncing Meta API live:", err);
      const errorMessage = err instanceof Error ? err.message : "Meta API sync failed";
      if (/access token|session has expired|token.*expired/i.test(errorMessage)) {
        await prisma.metaAdAccount.updateMany({
          where: { clientId: client.id, companyId },
          data: {
            tokenStatus: "EXPIRED",
            connectionStatus: "FAILED",
            lastSyncedAt: now
          }
        });
        throw new ApiError(401, "Meta access token expired. Reconnect this Meta ad account, then sync again.");
      }
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, "Meta API sync failed");
    }

    await prisma.metaAdAccount.upsert({
      where: { clientId },
      create: {
        companyId,
        clientId,
        accessToken: token,
        tokenStatus: "VALID",
        connectionStatus: "CONNECTED",
        lastSyncedAt: now
      },
      update: {
        tokenStatus: "VALID",
        connectionStatus: "CONNECTED",
        lastSyncedAt: now
      }
    });

    return {
      success: true,
      syncedAt: now,
      metaCampaigns: syncedCampaigns,
      message: "Meta Ads campaign insights synchronized successfully from Meta Marketing API"
    };
  },

  async createMetaCampaign(companyId: string, data: any) {
    return await prisma.metaCampaign.create({
      data: {
        companyId,
        clientId: data.clientId,
        metaCampaignId: data.metaCampaignId || `META-${Date.now().toString().slice(-6)}`,
        name: data.name,
        status: data.status || "ACTIVE",
        objective: data.objective || "LEADS",
        dailyBudget: Number(data.dailyBudget) || 0,
        amountSpent: Number(data.amountSpent) || 0,
        impressions: Number(data.impressions) || 0,
        reach: Number(data.reach) || 0,
        clicks: Number(data.clicks) || 0,
        ctr: Number(data.ctr) || 0,
        cpc: Number(data.cpc) || 0,
        cpm: Number(data.cpm) || 0,
        leads: Number(data.leads) || 0,
        conversions: Number(data.conversions) || 0,
        costPerResult: Number(data.costPerResult) || 0,
        roas: Number(data.roas) || 0,
        assignedMarketerId: data.assignedMarketerId || null,
        creativeType: data.creativeType || "IMAGE",
        notes: data.notes || null
      }
    });
  },

  async updateMetaCampaign(companyId: string, id: string, data: any) {
    const existingCampaign = await prisma.metaCampaign.findFirst({
      where: { id, companyId },
      include: {
        client: {
          include: { metaAdAccount: true }
        }
      }
    });
    if (!existingCampaign) throw notFound("Meta campaign not found");

    const updateData: any = {
      dailyBudget: data.dailyBudget !== undefined ? Number(data.dailyBudget) : undefined,
      notes: data.notes,
      assignedMarketerId: data.assignedMarketerId
    };

    if (data.status !== undefined) {
      const nextStatus = String(data.status).toUpperCase() === "ACTIVE" ? "ACTIVE" : "PAUSED";
      const token = existingCampaign.client.metaAdAccount?.accessToken || process.env.META_ACCESS_TOKEN;
      const metaCampaignId = existingCampaign.metaCampaignId;

      if (!token || !metaCampaignId) {
        throw new ApiError(400, "Meta campaign is not connected to a live Meta account");
      }

      const statusParams = new URLSearchParams({
        status: nextStatus,
        access_token: token
      });
      const statusRes = await fetch(`https://graph.facebook.com/v20.0/${metaCampaignId}`, {
        method: "POST",
        body: statusParams
      });
      const statusJson: any = await statusRes.json();
      if (!statusRes.ok || statusJson?.error) {
        const message = statusJson?.error?.message || "Meta campaign status update failed";
        if (/access token|session has expired|token.*expired/i.test(message)) {
          await prisma.metaAdAccount.updateMany({
            where: { clientId: existingCampaign.clientId, companyId },
            data: {
              tokenStatus: "EXPIRED",
              connectionStatus: "FAILED",
              lastSyncedAt: new Date()
            }
          });
          throw new ApiError(401, "Meta access token expired. Reconnect this Meta ad account, then try again.");
        }
        throw new ApiError(502, message);
      }

      updateData.status = nextStatus;
    }

    return await prisma.metaCampaign.update({
      where: { id },
      data: updateData
    });
  },

  async getMetaClientReport(companyId: string, clientId: string) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, companyId },
      include: {
        metaAdAccount: true,
        metaCampaigns: {
          orderBy: { amountSpent: "desc" }
        }
      }
    });

    if (!client) throw notFound("Client not found");

    const totalSpend = client.metaCampaigns.reduce((sum, c) => sum + c.amountSpent, 0);
    const totalLeads = client.metaCampaigns.reduce((sum, c) => sum + c.leads, 0);
    const totalImpressions = client.metaCampaigns.reduce((sum, c) => sum + c.impressions, 0);
    const totalClicks = client.metaCampaigns.reduce((sum, c) => sum + c.clicks, 0);
    const avgCpl = totalLeads > 0 ? Number((totalSpend / totalLeads).toFixed(2)) : 0;
    const avgCtr = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
    const blendedRoas = client.metaCampaigns.length > 0
      ? Number((client.metaCampaigns.reduce((sum, c) => sum + c.roas, 0) / client.metaCampaigns.length).toFixed(2))
      : 0;

    const topCampaign = client.metaCampaigns[0] || null;

    return {
      client: {
        id: client.id,
        name: client.name,
        details: client.details,
        packageName: client.packageName
      },
      account: client.metaAdAccount,
      summary: {
        totalSpend,
        totalLeads,
        totalImpressions,
        totalClicks,
        avgCpl,
        avgCtr,
        blendedRoas,
        activeCampaignsCount: client.metaCampaigns.filter(c => c.status === "ACTIVE").length,
        totalCampaignsCount: client.metaCampaigns.length
      },
      topCampaign,
      campaigns: client.metaCampaigns,
      recommendations: [
        "Scale daily budget on top-performing instant lead form creatives by 15%.",
        "Refine custom audience retargeting to 14-day high-intent website visitors for higher conversion velocity.",
        "A/B test video testimonials against static image carousels to lower average CPL."
      ]
    };
  },

  async getMetaLeads(companyId: string, filters: {
    clientId?: string;
    campaignId?: string;
    leadStatus?: string;
    qualificationStatus?: string;
    leadSource?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: any = { companyId };
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.campaignId) where.campaignId = filters.campaignId;
    if (filters.leadStatus && filters.leadStatus !== "ALL") where.leadStatus = filters.leadStatus;
    if (filters.qualificationStatus && filters.qualificationStatus !== "ALL") where.qualificationStatus = filters.qualificationStatus;
    if (filters.leadSource && filters.leadSource !== "ALL") where.leadSource = { contains: filters.leadSource };
    if (filters.startDate || filters.endDate) {
      where.leadSubmittedAt = {};
      if (filters.startDate) where.leadSubmittedAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.leadSubmittedAt.lte = new Date(filters.endDate);
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search } },
        { phone: { contains: filters.search } },
        { email: { contains: filters.search } },
        { location: { contains: filters.search } },
        { formName: { contains: filters.search } },
        { adSetName: { contains: filters.search } },
        { adName: { contains: filters.search } }
      ];
    }

    return await prisma.metaLead.findMany({
      where,
      include: {
        campaign: {
          select: { id: true, name: true, objective: true, dailyBudget: true, amountSpent: true, costPerResult: true }
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, phone: true }
        },
        leadNotes: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { leadSubmittedAt: "desc" }
    });
  },

  async createMetaLead(companyId: string, data: {
    clientId: string;
    campaignId?: string;
    name: string;
    phone?: string;
    email?: string;
    location?: string;
    ageGroup?: string;
    gender?: string;
    leadSource?: string;
    formName?: string;
    adSetName?: string;
    adName?: string;
    leadStatus?: string;
    qualificationStatus?: string;
    assignedToId?: string;
    notes?: string;
  }) {
    return await prisma.metaLead.create({
      data: {
        companyId,
        clientId: data.clientId,
        campaignId: data.campaignId || null,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        location: data.location || null,
        ageGroup: data.ageGroup || null,
        gender: data.gender || null,
        leadSource: data.leadSource || "Facebook",
        formName: data.formName || "Instant Lead Form",
        adSetName: data.adSetName || null,
        adName: data.adName || null,
        leadStatus: data.leadStatus || "NEW_LEAD",
        qualificationStatus: data.qualificationStatus || "QUALIFIED",
        assignedToId: data.assignedToId || null,
        notes: data.notes || null,
        leadSubmittedAt: new Date()
      },
      include: {
        campaign: true,
        assignedTo: true,
        leadNotes: true
      }
    });
  },

  async updateMetaLead(companyId: string, id: string, data: {
    leadStatus?: string;
    qualificationStatus?: string;
    assignedToId?: string | null;
    lastContactDate?: string | null;
    nextFollowUpDate?: string | null;
    conversionDate?: string | null;
    conversionValue?: number;
    notes?: string;
  }) {
    const updateData: any = {};
    if (data.leadStatus !== undefined) updateData.leadStatus = data.leadStatus;
    if (data.qualificationStatus !== undefined) updateData.qualificationStatus = data.qualificationStatus;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
    if (data.lastContactDate !== undefined) updateData.lastContactDate = data.lastContactDate ? new Date(data.lastContactDate) : null;
    if (data.nextFollowUpDate !== undefined) updateData.nextFollowUpDate = data.nextFollowUpDate ? new Date(data.nextFollowUpDate) : null;
    if (data.conversionDate !== undefined) updateData.conversionDate = data.conversionDate ? new Date(data.conversionDate) : null;
    if (data.conversionValue !== undefined) updateData.conversionValue = data.conversionValue;
    if (data.notes !== undefined) updateData.notes = data.notes;

    return await prisma.metaLead.update({
      where: { id },
      data: updateData,
      include: {
        campaign: true,
        assignedTo: true,
        leadNotes: {
          orderBy: { createdAt: "desc" }
        }
      }
    });
  },

  async addMetaLeadNote(companyId: string, leadId: string, authorName: string, content: string) {
    const lead = await prisma.metaLead.findFirst({
      where: { id: leadId, companyId }
    });
    if (!lead) throw notFound("Lead not found");

    return await prisma.metaLeadNote.create({
      data: {
        leadId,
        authorName,
        content
      }
    });
  },

  async getMetaLeadAnalytics(companyId: string, filters: { clientId?: string; campaignId?: string }) {
    const where: any = { companyId };
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.campaignId) where.campaignId = filters.campaignId;

    const leads = await prisma.metaLead.findMany({
      where,
      include: {
        campaign: true
      }
    });

    const campaigns = await prisma.metaCampaign.findMany({
      where: filters.clientId ? { companyId, clientId: filters.clientId } : { companyId }
    });

    const totalLeads = leads.length;
    const uniqueLeads = new Set(leads.map(l => (l.phone || l.email || l.name).toLowerCase())).size;
    const qualifiedLeads = leads.filter(l => l.qualificationStatus === "QUALIFIED" || l.leadStatus === "CONVERTED" || l.leadStatus === "INTERESTED").length;
    const unqualifiedLeads = leads.filter(l => l.qualificationStatus === "UNQUALIFIED" || l.leadStatus === "NOT_INTERESTED").length;
    const duplicateLeads = leads.filter(l => l.qualificationStatus === "DUPLICATE").length;
    const invalidLeads = leads.filter(l => l.qualificationStatus === "INVALID" || l.leadStatus === "WRONG_NUMBER").length;
    const convertedLeads = leads.filter(l => l.leadStatus === "CONVERTED").length;

    const totalSpend = campaigns.reduce((s, c) => s + c.amountSpent, 0);
    const avgCpl = totalLeads > 0 ? Number((totalSpend / totalLeads).toFixed(2)) : 0;
    const conversionRate = totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(1)) : 0;

    // Leads by Date
    const dateMap = new Map<string, number>();
    leads.forEach(l => {
      const d = l.leadSubmittedAt.toISOString().slice(0, 10);
      dateMap.set(d, (dateMap.get(d) || 0) + 1);
    });
    const leadsByDate = Array.from(dateMap.entries()).map(([date, count]) => ({ date, count }));

    // Leads by Campaign
    const campMap = new Map<string, number>();
    leads.forEach(l => {
      const name = l.campaign?.name || "Direct / Form";
      campMap.set(name, (campMap.get(name) || 0) + 1);
    });
    const leadsByCampaign = Array.from(campMap.entries()).map(([name, count]) => ({ name, count }));

    // Leads by Location
    const locMap = new Map<string, number>();
    leads.forEach(l => {
      const loc = l.location || "Kerala";
      locMap.set(loc, (locMap.get(loc) || 0) + 1);
    });
    const leadsByLocation = Array.from(locMap.entries()).map(([location, count]) => ({ location, count }));

    // Leads by Source
    const srcMap = new Map<string, number>();
    leads.forEach(l => {
      const src = l.leadSource || "Instagram";
      srcMap.set(src, (srcMap.get(src) || 0) + 1);
    });
    const leadsBySource = Array.from(srcMap.entries()).map(([source, count]) => ({ source, count }));

    return {
      overview: {
        totalLeads,
        uniqueLeads,
        qualifiedLeads,
        unqualifiedLeads,
        duplicateLeads,
        invalidLeads,
        convertedLeads,
        costPerLead: avgCpl,
        totalSpend,
        conversionRate
      },
      leadsByDate,
      leadsByCampaign,
      leadsByLocation,
      leadsBySource
    };
  },

  async getPointsSummary(companyId: string, track?: string) {
    const designers = await this.getDesigners(companyId, track);
    const employeeIds = designers.map(d => d.id);

    const [workCards, ledgers] = await Promise.all([
      prisma.workCard.findMany({
        where: {
          companyId,
          assignedToId: { in: employeeIds }
        },
        include: {
          client: true,
          assignedTo: true
        },
        orderBy: { createdAt: "desc" }
      }),
      prisma.pointsLedger.findMany({
        where: {
          employeeId: { in: employeeIds }
        },
        include: {
          workCard: {
            include: { client: true }
          },
          employee: true
        },
        orderBy: { createdAt: "desc" }
      })
    ]);

    const summaries = designers.map(designer => {
      const dCards = workCards.filter(c => c.assignedToId === designer.id);
      const approvedCards = dCards.filter(c => c.status === "APPROVED");
      const dLedgers = ledgers.filter(l => l.employeeId === designer.id);

      const totalEarnedPoints = dLedgers.reduce((acc, l) => acc + l.points, 0);
      const points5Count = approvedCards.filter(c => (c.pointsEarned ?? 0) === 5 || ((c.reworkCount || 0) <= 2 && (c.pointsEarned ?? 0) >= 5)).length;
      const points3Count = approvedCards.filter(c => (c.pointsEarned ?? 0) === 3).length;
      const points1Count = approvedCards.filter(c => (c.pointsEarned ?? 0) === 1).length;

      return {
        employeeId: designer.id,
        employeeName: formatFullName(designer),
        employeeEmail: (designer as any).email || (designer as any).personalEmail || "",
        designation: typeof designer.designation === "string" ? designer.designation : (designer.designation as any)?.title || "Designer",
        totalPoints: totalEarnedPoints,
        totalTasks: dCards.length,
        approvedTasks: approvedCards.length,
        points5Count,
        points3Count,
        points1Count,
        ledgers: dLedgers,
        cards: approvedCards
      };
    }).sort((a, b) => b.totalPoints - a.totalPoints);

    return summaries;
  },

  async awardEmployeePoints(companyId: string, actorUserId: string, data: {
    employeeId: string;
    points: number;
    description: string;
    workCardId?: string;
  }) {
    const employee = await prisma.employee.findUnique({
      where: { id: data.employeeId }
    });
    if (!employee) throw notFound("Employee");

    const createdLedger = await prisma.pointsLedger.create({
      data: {
        employeeId: data.employeeId,
        points: data.points,
        description: data.description || "Manual points adjustment",
        workCardId: data.workCardId || null
      }
    });

    if (data.workCardId) {
      await prisma.workCard.update({
        where: { id: data.workCardId },
        data: { pointsEarned: data.points }
      });
    }

    if (employee.userId) {
      await prisma.notification.create({
        data: {
          userId: employee.userId,
          channel: "IN_APP",
          subject: `${data.points >= 0 ? "+" : ""}${data.points} Points Awarded`,
          body: `${data.points >= 0 ? "+" : ""}${data.points} points marked by coordinator/admin: ${data.description}`
        }
      }).catch(() => {});
    }

    return createdLedger;
  }
};
