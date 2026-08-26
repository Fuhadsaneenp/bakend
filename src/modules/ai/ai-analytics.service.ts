import { prisma } from "../../lib/prisma.js";
import { UserContext, ExtractedEntities } from "./ai.types.js";

const workingDaysElapsedThisMonth = (date = new Date()) => {
  let count = 0;
  for (let day = 1; day <= date.getDate(); day++) {
    const cursor = new Date(date.getFullYear(), date.getMonth(), day);
    const weekDay = cursor.getDay();
    if (weekDay !== 0 && weekDay !== 6) count++;
  }
  return Math.max(1, count);
};

const formatTime = (value: Date | string | null | undefined) =>
  value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Not recorded";

export const aiAnalyticsService = {
  getSEOKeywordRankings(entities: ExtractedEntities) {
    return {
      totalKeywordsTracked: 0,
      top3Count: 0,
      top10Count: 0,
      improvedCount: 0,
      droppedCount: 0,
      stableCount: 0,
      keywords: [],
      message: entities.clientName
        ? `No live SEO ranking source is connected for ${entities.clientName}.`
        : "No live SEO ranking source is connected."
    };
  },

  async getActiveClientsList() {
    const clients = await prisma.client.findMany({
      include: {
        accountManager: true,
        workCards: true
      },
      orderBy: { name: "asc" }
    });

    return clients.map((client) => {
      const workCards = client.workCards || [];
      const completed = workCards.filter((card: any) => ["APPROVED", "FINISHED"].includes(String(card.status || "").toUpperCase())).length;
      const delayed = workCards.filter((card: any) => {
        const isPastDeadline = card.deadline && new Date(card.deadline).getTime() < Date.now();
        return isPastDeadline || String(card.status || "").toUpperCase() === "DELAYED";
      }).length;

      return {
        name: client.name,
        industry: client.details || "Not recorded",
        assignedTeam: "Use WorkTrack assignments for live task owners",
        accountManager: client.accountManager
          ? [client.accountManager.firstName, client.accountManager.middleName, client.accountManager.lastName].filter(Boolean).join(" ")
          : "Unassigned",
        activeServices: client.digitalMarketingActivities || client.packageName || "Not recorded",
        committedQuota: client.postersCommitted ? `${client.postersCommitted} posters / mo` : "Not recorded",
        currentStatus: delayed > 0 ? `Attention needed (${delayed} delayed work card(s))` : "Active",
        pendingItems: `${Math.max(0, workCards.length - completed)} pending work card(s)`
      };
    });
  },

  async getEmployeeAttendanceStats(user: UserContext) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const employee = user.employeeId ? await prisma.employee.findUnique({ where: { id: user.employeeId } }) : null;
    const employeeId = employee?.id;

    if (!employeeId) {
      return {
        workedDaysThisMonth: 0,
        totalWorkingDays: workingDaysElapsedThisMonth(now),
        attendancePercentage: 0,
        lateArrivals: 0,
        gracePeriodExceeded: 0,
        averageCheckInTime: "Not recorded",
        prevMonthAttendancePercentage: 0,
        improvementRate: "0%",
        hasIssues: false
      };
    }

    const currentPunches = await prisma.attendance.findMany({
      where: {
        employeeId,
        workDate: { gte: startOfMonth }
      }
    });

    const prevPunches = await prisma.attendance.findMany({
      where: {
        employeeId,
        workDate: { gte: startOfPrevMonth, lte: endOfPrevMonth }
      }
    });

    const workedDaysThisMonth = currentPunches.length;
    const totalWorkingDays = workingDaysElapsedThisMonth(now);
    const attendancePercentage = Math.min(100, Math.round((workedDaysThisMonth / totalWorkingDays) * 100));
    const lateArrivals = currentPunches.filter((p: any) => {
      if (p.isLate) return true;
      if (!p.checkInAt) return false;
      const checkIn = new Date(p.checkInAt);
      return checkIn.getHours() > 9 || (checkIn.getHours() === 9 && checkIn.getMinutes() > 45);
    }).length;

    const prevWorked = prevPunches.length;
    const prevWorkingDays = workingDaysElapsedThisMonth(endOfPrevMonth);
    const prevPercentage = Math.min(100, Math.round((prevWorked / prevWorkingDays) * 100));
    const averageTimestamp = currentPunches
      .map((p: any) => p.checkInAt ? new Date(p.checkInAt).getTime() : 0)
      .filter(Boolean)
      .reduce((sum: number, value: number, _index: number, arr: number[]) => sum + value / arr.length, 0);

    return {
      workedDaysThisMonth,
      totalWorkingDays,
      attendancePercentage,
      lateArrivals,
      gracePeriodExceeded: Math.max(0, lateArrivals - 2),
      averageCheckInTime: averageTimestamp ? formatTime(new Date(averageTimestamp)) : "Not recorded",
      prevMonthAttendancePercentage: prevPercentage,
      improvementRate: attendancePercentage >= prevPercentage ? `+${attendancePercentage - prevPercentage}%` : `-${prevPercentage - attendancePercentage}%`,
      hasIssues: lateArrivals >= 3
    };
  },

  async getEmployeeLeaveStats(user: UserContext) {
    const employeeId = user.employeeId;

    if (!employeeId) {
      return {
        casualLeaveRemaining: 0,
        casualLeaveTotal: 0,
        sickLeaveRemaining: 0,
        sickLeaveTotal: 0,
        earnedLeaveRemaining: 0,
        pendingApprovalsCount: 0,
        wfhDaysUsedThisMonth: 0,
        wfhMonthlyQuota: 0
      };
    }

    const [wfhRequests, leaveAllocations] = await Promise.all([
      prisma.wFHRequest.findMany({
        where: { employeeId },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      prisma.leaveAllocation.findMany({
        where: { employeeId, year: new Date().getFullYear() }
      })
    ]);

    const remainingFor = (type: string) => {
      const allocation = leaveAllocations.find((item: any) => String(item.leaveType || "").toLowerCase().includes(type));
      if (!allocation) return { remaining: 0, total: 0 };
      return {
        remaining: Math.max(0, Number(allocation.maxDays || 0) - Number(allocation.usedDays || 0)),
        total: Number(allocation.maxDays || 0)
      };
    };
    const casual = remainingFor("casual");
    const sick = remainingFor("sick");
    const earned = remainingFor("earned");

    return {
      casualLeaveRemaining: casual.remaining,
      casualLeaveTotal: casual.total,
      sickLeaveRemaining: sick.remaining,
      sickLeaveTotal: sick.total,
      earnedLeaveRemaining: earned.remaining,
      pendingApprovalsCount: wfhRequests.filter((request: any) => request.status === "PENDING").length,
      wfhDaysUsedThisMonth: wfhRequests.filter((request: any) => request.status === "APPROVED").length,
      wfhMonthlyQuota: 0,
      recentRequests: wfhRequests.slice(0, 3)
    };
  },

  async getWorkTrackProductivityStats(user: UserContext) {
    const where = user.employeeId ? { assignedToId: user.employeeId } : {};
    const workCards = await prisma.workCard.findMany({ where });
    const completedTasksCount = workCards.filter((card: any) => ["APPROVED", "FINISHED"].includes(String(card.status || "").toUpperCase())).length;
    const overdueTasksCount = workCards.filter((card: any) =>
      !["APPROVED", "FINISHED"].includes(String(card.status || "").toUpperCase()) &&
      card.deadline &&
      new Date(card.deadline).getTime() < Date.now()
    ).length;
    const reworkCount = workCards.filter((card: any) => String(card.status || "").toUpperCase() === "REWORK").length;
    const totalPoints = workCards.reduce((sum: number, card: any) => sum + Number(card.pointsEarned || 0), 0);

    return {
      assignedTasksCount: workCards.length,
      completedTasksCount,
      pendingTasksCount: Math.max(0, workCards.length - completedTasksCount),
      overdueTasksCount,
      completionPercentage: workCards.length > 0 ? Math.round((completedTasksCount / workCards.length) * 100) : 0,
      workPoints: totalPoints,
      onTimeDeliveryRate: workCards.length > 0 ? `${Math.round(((workCards.length - overdueTasksCount) / workCards.length) * 100)}%` : "0%",
      reworkRate: workCards.length > 0 ? `${Math.round((reworkCount / workCards.length) * 100)}%` : "0%"
    };
  },

  async getManagerTeamStats(user: UserContext, entities: ExtractedEntities) {
    const employees = await prisma.employee.findMany({
      where: { status: "ACTIVE" },
      include: { department: true, designation: true, assignedWorkCards: true }
    });

    const targetDept = entities.departmentName || user.department || "";
    const deptEmployees = targetDept
      ? employees.filter((employee) => (employee.department?.name || "").toLowerCase().includes(targetDept.toLowerCase()))
      : employees;
    const allTeamCards = deptEmployees.flatMap((employee: any) => employee.assignedWorkCards || []);
    const completedDeliverables = allTeamCards.filter((card: any) => ["APPROVED", "FINISHED"].includes(String(card.status || "").toUpperCase())).length;
    const overdueTasks = allTeamCards.filter((card: any) =>
      !["APPROVED", "FINISHED"].includes(String(card.status || "").toUpperCase()) &&
      card.deadline &&
      new Date(card.deadline).getTime() < Date.now()
    ).length;

    return {
      departmentName: targetDept || "All Departments",
      teamMembersCount: deptEmployees.length,
      totalPendingDeliverables: Math.max(0, allTeamCards.length - completedDeliverables),
      completedDeliverables,
      completionRate: allTeamCards.length > 0 ? `${Math.round((completedDeliverables / allTeamCards.length) * 100)}%` : "0%",
      designers: deptEmployees.map((employee: any) => {
        const cards = employee.assignedWorkCards || [];
        const completed = cards.filter((card: any) => ["APPROVED", "FINISHED"].includes(String(card.status || "").toUpperCase())).length;
        const active = Math.max(0, cards.length - completed);
        const overdue = cards.filter((card: any) =>
          !["APPROVED", "FINISHED"].includes(String(card.status || "").toUpperCase()) &&
          card.deadline &&
          new Date(card.deadline).getTime() < Date.now()
        ).length;
        return {
          name: [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(" "),
          role: employee.designation?.title || "Not recorded",
          activeTasks: active,
          pendingTasks: active,
          overdueTasks: overdue,
          completedTasks: completed,
          workCapacity: active >= 3 ? "Overloaded" : active === 0 ? "Available" : "Balanced"
        };
      }),
      bottlenecks: overdueTasks > 0 ? `${overdueTasks} overdue work card(s) found.` : "No overdue team work cards found."
    };
  },

  async getCompanyOverviewStats(user: UserContext) {
    const [totalEmployees, departmentsCount, activeClientsCount, workCards] = await Promise.all([
      prisma.employee.count({ where: { status: "ACTIVE" } }),
      prisma.department.count(),
      prisma.client.count(),
      prisma.workCard.findMany()
    ]);
    const completed = workCards.filter((card: any) => ["APPROVED", "FINISHED"].includes(String(card.status || "").toUpperCase())).length;

    return {
      totalEmployees,
      totalDepartments: departmentsCount,
      activeClientsCount,
      monthlyPostersCommitted: 0,
      monthlyVideosCommitted: 0,
      overallPunctualityRate: "Use live attendance report",
      workloadEfficiencyIndex: workCards.length > 0 ? `${Math.round((completed / workCards.length) * 100)}%` : "0%"
    };
  },

  async getTeamAttendanceToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const allEmployees = await prisma.employee.findMany({
      where: { status: "ACTIVE" },
      include: { department: true }
    });
    const todayAttendance = await prisma.attendance.findMany({
      where: {
        workDate: { gte: today, lt: tomorrow }
      },
      include: { employee: { include: { department: true } } }
    });

    const presentIds = new Set(todayAttendance.map((attendance: any) => attendance.employeeId));
    const totalActive = allEmployees.length;
    const presentCount = presentIds.size;
    const absentCount = Math.max(0, totalActive - presentCount);
    const lateArrivals = todayAttendance.filter((attendance: any) => {
      if (!attendance.checkInAt) return false;
      const checkIn = new Date(attendance.checkInAt);
      return checkIn.getHours() > 9 || (checkIn.getHours() === 9 && checkIn.getMinutes() > 45);
    });

    const deptMap: Record<string, { present: number; total: number }> = {};
    for (const employee of allEmployees) {
      const deptName = (employee as any).department?.name || "General";
      if (!deptMap[deptName]) deptMap[deptName] = { present: 0, total: 0 };
      deptMap[deptName].total++;
      if (presentIds.has(employee.id)) deptMap[deptName].present++;
    }

    const deptSummary = Object.entries(deptMap)
      .map(([dept, { present, total }]) => `${dept}: ${present}/${total}`)
      .join(", ");

    return {
      totalActive,
      presentCount,
      absentCount,
      lateCount: lateArrivals.length,
      attendanceRate: totalActive > 0 ? Math.round((presentCount / totalActive) * 100) : 0,
      deptSummary,
      date: today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })
    };
  }
};
