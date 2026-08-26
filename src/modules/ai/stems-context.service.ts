import { prisma } from "../../lib/prisma.js";
import { UserContext } from "./ai.types.js";

export interface StemsLiveContext {
  todayDateStr: string;
  attendance: {
    totalEmployees: number;
    presentCount: number;
    absentCount: number;
    onLeaveCount: number;
    wfhCount: number;
    lateArrivalsCount: number;
    earlyDeparturesCount: number;
    attendancePercentage: number;
    presentEmployees: { name: string; department: string; checkInAt: string; isLate: boolean }[];
    absentEmployees: { name: string; department: string; designation?: string }[];
    onLeaveEmployees: { name: string; type: string; reason?: string }[];
    wfhEmployees: { name: string; department: string }[];
    lateCheckIns: { name: string; time: string; delayMinutes: number }[];
    maxLeaveTakerMonth: { name: string; daysTaken: number };
  };
  tasks: {
    totalTasks: number;
    completedToday: number;
    inProgressCount: number;
    pendingCount: number;
    delayedCount: number;
    reworkCount: number;
    completionRate: number;
    delayedTaskList: { title: string; client: string; assignedTo: string; deadline: string; priority: string }[];
    completedTodayList: { title: string; client: string; completedBy: string }[];
    employeeWorkload: { name: string; department: string; activeTasks: number; completedTasks: number; points: number; status: "OVERLOADED" | "BALANCED" | "AVAILABLE" }[];
    overloadedEmployees: string[];
    availableEmployees: string[];
    highestWorkloadEmployee: { name: string; activeTasks: number };
  };
  clients: {
    totalClients: number;
    activeClients: {
      name: string;
      package: string;
      postersCommitted: number;
      videosCommitted: number;
      postersDone: number;
      videosDone: number;
      accountManager: string;
      status: string;
      pendingDeliverables: number;
      delayedDeliverables: number;
    }[];
    delayedClientWork: { client: string; item: string; deadline: string }[];
  };
  departments: {
    design: {
      teamMembers: string[];
      postersCompleted: number;
      postersPending: number;
      videosCompleted: number;
      videosPending: number;
      reworkRate: string;
      topDesigner: string;
    };
    marketingSeo: {
      teamMembers: string[];
      top10Keywords: number;
      totalKeywords: number;
      page1Rate: string;
      activeCampaigns: number;
    };
    development: {
      teamMembers: string[];
      activeTasks: number;
      completedTasks: number;
      bugsReported: number;
      bugsResolved: number;
    };
  };
  employeesDirectory: {
    id: string;
    name: string;
    code: string;
    department: string;
    designation: string;
    manager: string;
    joiningDate: string;
    email: string;
    leaveBalance: { casual: number; sick: number; earned: number };
    todayStatus: string;
    activeTasks: string[];
    productivityScore: number;
  }[];
  businessInsights: {
    topPerformers: { name: string; department: string; score: number }[];
    needsAttention: { name: string; reason: string }[];
    operationalAlerts: string[];
  };
}

const fullName = (person: any) =>
  [person?.firstName, person?.middleName, person?.lastName].filter(Boolean).join(" ").trim() || "Unknown";

const dayLabel = (value: Date | string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-IN") : "Not recorded";

const minuteDelayAfter945 = (value: Date) =>
  Math.max(0, (value.getHours() - 9) * 60 + value.getMinutes() - 45);

const getLeaveBalance = (allocations: any[], employeeId: string) => {
  const currentYear = new Date().getFullYear();
  const remainingByType = (typeIncludes: string) => {
    const allocation = allocations.find((item) => (
      item.employeeId === employeeId &&
      Number(item.year) === currentYear &&
      String(item.leaveType || "").toLowerCase().includes(typeIncludes)
    ));
    if (!allocation) return 0;
    return Math.max(0, Number(allocation.maxDays || 0) - Number(allocation.usedDays || 0));
  };

  return {
    casual: remainingByType("casual"),
    sick: remainingByType("sick"),
    earned: remainingByType("earned")
  };
};

const withQueryTimeout = async <T>(query: Promise<T>, fallback: T, timeoutMs = 2500): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      query.catch(() => fallback),
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export const stemsContextService = {
  async getLiveContext(user: UserContext): Promise<StemsLiveContext> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const todayDateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    let dbEmployees: any[] = [];
    let dbAttendanceToday: any[] = [];
    let dbWorkCards: any[] = [];
    let dbClients: any[] = [];
    let dbWFHRequests: any[] = [];
    let dbLeaveAllocations: any[] = [];

    try {
      const dbAvailable = await withQueryTimeout(prisma.$queryRaw`SELECT 1`, null, 1000);

      if (!dbAvailable) {
        throw new Error("Local database is not responding");
      }

      [dbEmployees, dbAttendanceToday, dbWorkCards, dbClients, dbWFHRequests, dbLeaveAllocations] =
        await Promise.all([
          withQueryTimeout(prisma.employee.findMany({
            where: { status: "ACTIVE" },
            include: {
              department: true,
              designation: true,
              manager: true,
              user: true
            }
          }), []),
          withQueryTimeout(prisma.attendance.findMany({
            where: { workDate: { gte: todayStart, lte: todayEnd } },
            include: { employee: { include: { department: true } } }
          }), []),
          withQueryTimeout(prisma.workCard.findMany({
            include: {
              client: true,
              assignedTo: { include: { department: true } }
            }
          }), []),
          withQueryTimeout(prisma.client.findMany({
            include: { accountManager: true, workCards: true }
          }), []),
          withQueryTimeout(prisma.wFHRequest.findMany({
            where: {
              startDate: { lte: todayEnd },
              endDate: { gte: todayStart },
              status: "APPROVED"
            },
            include: { employee: { include: { department: true } } }
          }), []),
          withQueryTimeout(prisma.leaveAllocation.findMany({
            include: { employee: true }
          }), [])
        ]);
    } catch {
      // Return empty live data rather than inventing records.
    }

    const activeEmployees = dbEmployees;
    const totalEmployees = activeEmployees.length;
    const presentMap = new Map<string, any>();
    for (const attendance of dbAttendanceToday) {
      if (attendance.employeeId) presentMap.set(attendance.employeeId, attendance);
    }

    const wfhEmployeeIds = new Set(dbWFHRequests.map((request) => request.employeeId).filter(Boolean));
    const presentEmployees: StemsLiveContext["attendance"]["presentEmployees"] = [];
    const absentEmployees: StemsLiveContext["attendance"]["absentEmployees"] = [];
    const lateCheckIns: StemsLiveContext["attendance"]["lateCheckIns"] = [];
    const wfhEmployees: StemsLiveContext["attendance"]["wfhEmployees"] = [];
    const onLeaveEmployees: StemsLiveContext["attendance"]["onLeaveEmployees"] = [];

    for (const employee of activeEmployees) {
      const name = fullName(employee);
      const deptName = employee.department?.name || "General";
      const attendance = presentMap.get(employee.id);
      const isWFH = wfhEmployeeIds.has(employee.id);

      if (isWFH) wfhEmployees.push({ name, department: deptName });

      if (attendance) {
        const checkIn = attendance.checkInAt ? new Date(attendance.checkInAt) : null;
        const timeStr = checkIn
          ? checkIn.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "Punch recorded";
        const delayMinutes = checkIn ? minuteDelayAfter945(checkIn) : 0;
        const isLate = Boolean(attendance.isLate) || delayMinutes > 0;

        presentEmployees.push({
          name,
          department: deptName,
          checkInAt: isWFH ? `${timeStr} (Remote/WFH)` : timeStr,
          isLate
        });

        if (isLate && checkIn) {
          lateCheckIns.push({ name, time: timeStr, delayMinutes });
        }
      } else if (isWFH) {
        presentEmployees.push({
          name,
          department: deptName,
          checkInAt: "WFH approved; no punch recorded",
          isLate: false
        });
      } else {
        absentEmployees.push({
          name,
          department: deptName,
          designation: employee.designation?.title
        });
      }
    }

    const leaveUsage = dbLeaveAllocations
      .filter((item) => Number(item.year) === now.getFullYear())
      .map((item) => ({ name: fullName(item.employee), daysTaken: Number(item.usedDays || 0) }))
      .sort((a, b) => b.daysTaken - a.daysTaken);

    const tasksList = dbWorkCards;
    const totalTasks = tasksList.length;
    const delayedTaskList: StemsLiveContext["tasks"]["delayedTaskList"] = [];
    const completedTodayList: StemsLiveContext["tasks"]["completedTodayList"] = [];
    let completedTodayCount = 0;
    let completedTotalCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;
    let reworkCount = 0;

    const workloadMap = new Map<string, { active: number; completed: number; points: number; dept: string }>();
    for (const employee of activeEmployees) {
      workloadMap.set(fullName(employee), {
        active: 0,
        completed: 0,
        points: 0,
        dept: employee.department?.name || "General"
      });
    }

    for (const task of tasksList) {
      const assignee = task.assignedTo ? fullName(task.assignedTo) : "Unassigned";
      const statusUpper = String(task.status || "").toUpperCase();
      const isComplete = statusUpper === "APPROVED" || statusUpper === "FINISHED";
      const updatedAt = task.updatedAt ? new Date(task.updatedAt) : null;
      const completedToday = isComplete && updatedAt && updatedAt >= todayStart && updatedAt <= todayEnd;
      const isPastDeadline = task.deadline && new Date(task.deadline).getTime() < now.getTime();

      if (isComplete) {
        completedTotalCount++;
        if (completedToday) {
          completedTodayCount++;
          completedTodayList.push({
            title: task.title,
            client: task.client?.name || "Unassigned client",
            completedBy: assignee
          });
        }
        const workload = workloadMap.get(assignee);
        if (workload) {
          workload.completed++;
          workload.points += Number(task.pointsEarned || 0);
        }
        continue;
      }

      if (statusUpper === "IN_PROGRESS") inProgressCount++;
      else if (statusUpper === "REWORK") reworkCount++;
      else pendingCount++;

      const workload = workloadMap.get(assignee);
      if (workload) workload.active++;

      if (isPastDeadline || statusUpper === "DELAYED") {
        delayedTaskList.push({
          title: task.title,
          client: task.client?.name || "Unassigned client",
          assignedTo: assignee,
          deadline: dayLabel(task.deadline),
          priority: task.priority || "NORMAL"
        });
      }
    }

    const employeeWorkload = Array.from(workloadMap.entries())
      .map(([name, data]) => {
        const status: "OVERLOADED" | "BALANCED" | "AVAILABLE" =
          data.active >= 3 ? "OVERLOADED" : data.active === 0 ? "AVAILABLE" : "BALANCED";
        return {
          name,
          department: data.dept,
          activeTasks: data.active,
          completedTasks: data.completed,
          points: data.points,
          status
        };
      })
      .sort((a, b) => b.activeTasks - a.activeTasks || b.completedTasks - a.completedTasks);

    const overloadedEmployees = employeeWorkload.filter((employee) => employee.status === "OVERLOADED").map((employee) => employee.name);
    const availableEmployees = employeeWorkload.filter((employee) => employee.status === "AVAILABLE").map((employee) => employee.name);
    const highestWorkloadEmployee = employeeWorkload[0]
      ? { name: employeeWorkload[0].name, activeTasks: employeeWorkload[0].activeTasks }
      : { name: "No active assignee", activeTasks: 0 };

    const activeClientsList = dbClients.map((client) => {
      const clientTasks = tasksList.filter((task) => task.clientId === client.id);
      const completedClientTasks = clientTasks.filter((task) => ["APPROVED", "FINISHED"].includes(String(task.status || "").toUpperCase()));
      const delayedClientTasks = delayedTaskList.filter((task) => task.client === client.name);
      const pendingClientTasks = clientTasks.length - completedClientTasks.length;

      return {
        name: client.name,
        package: client.packageName || "Not recorded",
        postersCommitted: Number(client.postersCommitted || 0),
        videosCommitted: 0,
        postersDone: completedClientTasks.length,
        videosDone: 0,
        accountManager: client.accountManager ? fullName(client.accountManager) : "Unassigned",
        status: delayedClientTasks.length > 0 ? "Attention needed" : "Active",
        pendingDeliverables: Math.max(0, pendingClientTasks),
        delayedDeliverables: delayedClientTasks.length
      };
    });

    const delayedClientWork = delayedTaskList.map((task) => ({
      client: task.client,
      item: task.title,
      deadline: task.deadline
    }));

    const designMembers = activeEmployees
      .filter((employee) => employee.department?.name === "Design")
      .map(fullName);
    const seoMembers = activeEmployees
      .filter((employee) => ["SEO", "Growth"].includes(employee.department?.name || ""))
      .map(fullName);
    const devMembers = activeEmployees
      .filter((employee) => employee.department?.name === "Development")
      .map(fullName);

    const completedDesignTasks = tasksList.filter((task) =>
      ["APPROVED", "FINISHED"].includes(String(task.status || "").toUpperCase()) &&
      task.assignedTo?.department?.name === "Design"
    ).length;
    const pendingDesignTasks = tasksList.filter((task) =>
      !["APPROVED", "FINISHED"].includes(String(task.status || "").toUpperCase()) &&
      task.assignedTo?.department?.name === "Design"
    ).length;
    const developmentTasks = tasksList.filter((task) => task.assignedTo?.department?.name === "Development");
    const completedDevelopmentTasks = developmentTasks.filter((task) =>
      ["APPROVED", "FINISHED"].includes(String(task.status || "").toUpperCase())
    ).length;

    const employeesDirectory = activeEmployees.map((employee) => {
      const name = fullName(employee);
      const attendance = presentMap.get(employee.id);
      const assignedTasks = tasksList
        .filter((task) => task.assignedToId === employee.id)
        .map((task) => `${task.title} [${task.status}]`);
      const workload = workloadMap.get(name);

      let todayStatus = "Absent (no punch recorded)";
      if (wfhEmployeeIds.has(employee.id)) todayStatus = "Working Remotely (WFH)";
      if (attendance) {
        const checkIn = attendance.checkInAt ? new Date(attendance.checkInAt) : null;
        todayStatus = checkIn && minuteDelayAfter945(checkIn) > 0 ? "Present (Late Arrival)" : "Present in Office";
      }

      return {
        id: employee.id,
        name,
        code: employee.employeeCode || "Not recorded",
        department: employee.department?.name || "General",
        designation: employee.designation?.title || "Not recorded",
        manager: employee.manager ? fullName(employee.manager) : "Unassigned",
        joiningDate: dayLabel(employee.dateOfJoining || employee.createdAt),
        email: employee.user?.email || employee.personalEmail || "Not recorded",
        leaveBalance: getLeaveBalance(dbLeaveAllocations, employee.id),
        todayStatus,
        activeTasks: assignedTasks,
        productivityScore: Math.min(100, Math.round(((workload?.completed || 0) * 20) + ((workload?.points || 0) * 2)))
      };
    });

    const topPerformers = employeeWorkload
      .filter((employee) => employee.completedTasks > 0 || employee.points > 0)
      .sort((a, b) => b.points - a.points || b.completedTasks - a.completedTasks)
      .slice(0, 3)
      .map((employee) => ({ name: employee.name, department: employee.department, score: employee.points }));

    const needsAttention = [
      ...employeeWorkload
        .filter((employee) => employee.status === "OVERLOADED")
        .map((employee) => ({ name: employee.name, reason: `${employee.activeTasks} active tasks assigned.` })),
      ...delayedTaskList.map((task) => ({
        name: task.title,
        reason: `Delayed for ${task.client}; assigned to ${task.assignedTo}.`
      }))
    ].slice(0, 6);

    const operationalAlerts = [
      totalEmployees === 0 ? "No active employee records found." : "",
      dbAttendanceToday.length === 0 ? "No attendance punches found for today." : "",
      delayedTaskList.length > 0 ? `${delayedTaskList.length} deliverable(s) are past deadline or marked delayed.` : "",
      overloadedEmployees.length > 0 ? `${overloadedEmployees.length} employee(s) have overloaded task queues.` : "",
      dbClients.length === 0 ? "No active client records found." : ""
    ].filter(Boolean);

    return {
      todayDateStr,
      attendance: {
        totalEmployees,
        presentCount: presentEmployees.length,
        absentCount: absentEmployees.length,
        onLeaveCount: onLeaveEmployees.length,
        wfhCount: wfhEmployees.length,
        lateArrivalsCount: lateCheckIns.length,
        earlyDeparturesCount: dbAttendanceToday.filter((attendance) => Boolean(attendance.isEarlyLeave)).length,
        attendancePercentage: totalEmployees > 0 ? Math.round((presentEmployees.length / totalEmployees) * 100) : 0,
        presentEmployees,
        absentEmployees,
        onLeaveEmployees,
        wfhEmployees,
        lateCheckIns,
        maxLeaveTakerMonth: leaveUsage[0] || { name: "No leave usage recorded", daysTaken: 0 }
      },
      tasks: {
        totalTasks,
        completedToday: completedTodayCount,
        inProgressCount,
        pendingCount,
        delayedCount: delayedTaskList.length,
        reworkCount,
        completionRate: totalTasks > 0 ? Math.round((completedTotalCount / totalTasks) * 100) : 0,
        delayedTaskList,
        completedTodayList,
        employeeWorkload,
        overloadedEmployees,
        availableEmployees,
        highestWorkloadEmployee
      },
      clients: {
        totalClients: activeClientsList.length,
        activeClients: activeClientsList,
        delayedClientWork
      },
      departments: {
        design: {
          teamMembers: designMembers,
          postersCompleted: completedDesignTasks,
          postersPending: pendingDesignTasks,
          videosCompleted: 0,
          videosPending: 0,
          reworkRate: totalTasks > 0 ? `${Math.round((reworkCount / totalTasks) * 100)}%` : "0%",
          topDesigner: employeeWorkload.find((employee) => employee.department === "Design" && employee.completedTasks > 0)?.name || "No live design completions found"
        },
        marketingSeo: {
          teamMembers: seoMembers,
          top10Keywords: 0,
          totalKeywords: 0,
          page1Rate: "No live SEO ranking data connected",
          activeCampaigns: 0
        },
        development: {
          teamMembers: devMembers,
          activeTasks: Math.max(0, developmentTasks.length - completedDevelopmentTasks),
          completedTasks: completedDevelopmentTasks,
          bugsReported: tasksList.filter((task) => String(task.category || "").toLowerCase().includes("bug")).length,
          bugsResolved: tasksList.filter((task) =>
            String(task.category || "").toLowerCase().includes("bug") &&
            ["APPROVED", "FINISHED"].includes(String(task.status || "").toUpperCase())
          ).length
        }
      },
      employeesDirectory,
      businessInsights: {
        topPerformers,
        needsAttention,
        operationalAlerts: operationalAlerts.length > 0
          ? operationalAlerts
          : ["No live operational alerts found from current records."]
      }
    };
  }
};
