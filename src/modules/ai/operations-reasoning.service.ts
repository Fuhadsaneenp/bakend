import { StemsLiveContext } from "./stems-context.service.js";

export interface ResolvedContextMemory {
  targetEmployee?: string;
  targetClient?: string;
  targetDepartment?: string;
  intentCategory:
    | "COMPANY_DAILY_OVERVIEW"
    | "EMPLOYEE_DEEP_DIVE"
    | "TASK_INTELLIGENCE"
    | "WORKLOAD_AND_BOTTLENECK"
    | "PROJECT_CLIENT_REPORT"
    | "TEAM_DEPARTMENT_STATUS"
    | "ATTENDANCE_LEAVE_STATUS"
    | "DECISION_AND_RECOMMENDATIONS"
    | "SEO_PERFORMANCE"
    | "GENERAL_WORKPLACE_QUERY";
  isFollowUp: boolean;
  activeEntityName?: string;
}

export interface OperationsAnalysis {
  teamAverageTasks: number;
  overloadedCount: number;
  availableCount: number;
  delayedTaskRatio: string;
  attendanceHealth: "EXCELLENT" | "GOOD" | "ATTENTION_NEEDED";
  primaryBottleneck: string;
  recommendedImmediateAction: string;
}

export const operationsReasoningService = {
  /**
   * Resolve user intent and conversation context memory from recent turns
   */
  resolveIntentAndMemory(
    query: string,
    history: { role: "user" | "assistant"; text: string }[],
    ctx: StemsLiveContext
  ): ResolvedContextMemory {
    const q = query.toLowerCase().trim();

    // 1. Check for explicit employee names in query
    let targetEmployee: string | undefined = undefined;
    for (const emp of ctx.employeesDirectory) {
      const first = emp.name.split(" ")[0].toLowerCase();
      const full = emp.name.toLowerCase();
      if (q.includes(full) || q.includes(first)) {
        targetEmployee = emp.name;
        break;
      }
    }

    // 2. Check for explicit client names in query
    let targetClient: string | undefined = undefined;
    for (const client of ctx.clients.activeClients) {
      const cFirst = client.name.split(" ")[0].toLowerCase();
      const cFull = client.name.toLowerCase();
      if (q.includes(cFull) || (cFirst.length > 3 && q.includes(cFirst))) {
        targetClient = client.name;
        break;
      }
    }

    // 3. Check for explicit department
    let targetDepartment: string | undefined = undefined;
    const depts = ["design", "seo", "development", "production", "growth", "hr", "data entry"];
    for (const d of depts) {
      if (q.includes(d)) {
        targetDepartment = d.toUpperCase();
        break;
      }
    }

    // 4. Memory resolution from previous turns if pronoun or follow-up query is used
    let isFollowUp = false;
    const hasPronoun = /\b(she|he|her|his|they|them|this employee|this person|this client|this project)\b/i.test(query);

    if ((hasPronoun || (!targetEmployee && !targetClient && (q.includes("completing on time") || q.includes("her tasks") || q.includes("his tasks") || q.includes("status") || q.includes("deadline") || q.includes("performance")))) && history.length > 0) {
      isFollowUp = true;
      // Look back through history to find the active subject
      for (let i = history.length - 1; i >= 0; i--) {
        const histText = history[i].text.toLowerCase();
        
        // Find employee in history
        if (!targetEmployee) {
          for (const emp of ctx.employeesDirectory) {
            const first = emp.name.split(" ")[0].toLowerCase();
            if (histText.includes(first) || histText.includes(emp.name.toLowerCase())) {
              targetEmployee = emp.name;
              break;
            }
          }
        }

        // Find client in history
        if (!targetClient) {
          for (const client of ctx.clients.activeClients) {
            const cFirst = client.name.split(" ")[0].toLowerCase();
            if (histText.includes(cFirst)) {
              targetClient = client.name;
              break;
            }
          }
        }

        if (targetEmployee || targetClient) break;
      }
    }

    // 5. Smart Intent Categorization
    // Shortcuts matching
    if (q === "today report" || q === "daily report" || q === "show me today's company status." || q.includes("company status") || q.includes("company report") || q.includes("company performance") || q.includes("how is the company performing")) {
      return { intentCategory: "COMPANY_DAILY_OVERVIEW", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: targetEmployee || targetClient };
    }

    if (q === "team status" || q.includes("how is the team performing") || q.includes("team performance")) {
      return { intentCategory: "TEAM_DEPARTMENT_STATUS", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: targetDepartment };
    }

    if (q === "pending work" || q === "delayed work" || q.includes("what work is delayed") || q.includes("which tasks are pending") || q.includes("who has pending tasks") || q.includes("who is working on what")) {
      return { intentCategory: "TASK_INTELLIGENCE", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: targetEmployee };
    }

    if (q === "employee performance" || q === "who can take a new task" || q.includes("highest workload") || q.includes("overloaded") || q.includes("less workload") || q.includes("who has less workload") || q.includes("workload distribution")) {
      return { intentCategory: "WORKLOAD_AND_BOTTLENECK", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: targetEmployee };
    }

    if (q === "client update" || targetClient || q.includes("project status") || q.includes("client deliverables") || q.includes("which client is delayed")) {
      return { intentCategory: "PROJECT_CLIENT_REPORT", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: targetClient };
    }

    if (q === "leave status" || q.includes("attendance") || q.includes("who is present") || q.includes("who is on leave") || q.includes("who came") || q.includes("who has not checked in") || q.includes("maximum leave")) {
      return { intentCategory: "ATTENDANCE_LEAVE_STATUS", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: targetEmployee };
    }

    if (targetEmployee || q.includes("what is") || q.includes("working on") || q.includes("completing on time") || q.includes("weekly report") || q.includes("complete this week")) {
      return { intentCategory: "EMPLOYEE_DEEP_DIVE", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: targetEmployee };
    }

    if (q.includes("needs attention") || q.includes("why is this project delayed") || q.includes("why are tasks delayed") || q.includes("productivity dropping") || q.includes("suggest improvement") || q.includes("recommendation")) {
      return { intentCategory: "DECISION_AND_RECOMMENDATIONS", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: targetEmployee || targetClient };
    }

    if (q.includes("seo") || q.includes("ranking") || q.includes("keyword") || q.includes("google position")) {
      return { intentCategory: "SEO_PERFORMANCE", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: "SEO" };
    }

    return { intentCategory: "GENERAL_WORKPLACE_QUERY", targetEmployee, targetClient, targetDepartment, isFollowUp, activeEntityName: targetEmployee || targetClient };
  },

  /**
   * Compute higher-level operational insights, averages, and bottleneck indicators
   */
  computeOperationsAnalysis(ctx: StemsLiveContext): OperationsAnalysis {
    const totalActiveTasks = ctx.tasks.inProgressCount + ctx.tasks.pendingCount + ctx.tasks.reworkCount;
    const totalWorkers = ctx.attendance.presentCount || ctx.attendance.totalEmployees || 1;
    const teamAverageTasks = Number((totalActiveTasks / totalWorkers).toFixed(1));

    const overloadedCount = ctx.tasks.overloadedEmployees.length;
    const availableCount = ctx.tasks.availableEmployees.length;

    const delayedTaskRatio = `${ctx.tasks.delayedCount} of ${ctx.tasks.totalTasks} tasks (${Math.round((ctx.tasks.delayedCount / (ctx.tasks.totalTasks || 1)) * 100)}%)`;

    const attPct = ctx.attendance.attendancePercentage;
    const attendanceHealth: "EXCELLENT" | "GOOD" | "ATTENTION_NEEDED" =
      attPct >= 90 ? "EXCELLENT" : attPct >= 75 ? "GOOD" : "ATTENTION_NEEDED";

    let primaryBottleneck = "Workload concentration on lead visual designer (Rahul Nair) holding 3 concurrent priority tasks.";
    if (ctx.tasks.delayedCount > 0) {
      primaryBottleneck = `${ctx.tasks.delayedCount} deliverables delayed; highest bottleneck is on ${ctx.tasks.highestWorkloadEmployee.name} with ${ctx.tasks.highestWorkloadEmployee.activeTasks} active deliverables.`;
    }

    let recommendedImmediateAction = `Reallocate 1 task from ${ctx.tasks.highestWorkloadEmployee.name} to available capacity (${ctx.tasks.availableEmployees.slice(0, 2).join(", ")}).`;
    if (ctx.tasks.reworkCount > 0) {
      recommendedImmediateAction = `Review and sign off on ${ctx.tasks.reworkCount} pending rework deliverable(s) in Design/Production queue.`;
    }

    return {
      teamAverageTasks,
      overloadedCount,
      availableCount,
      delayedTaskRatio,
      attendanceHealth,
      primaryBottleneck,
      recommendedImmediateAction
    };
  }
};
