import { AIIntent, ExtractedEntities } from "./ai.types.js";

const CLIENT_NAMES = [
  "HealthFirst Clinics",
  "Apex Realty UAE",
  "Zenith Cloud Technologies",
  "KiteWave Digital FinTech",
  "Bloomfield International School",
  "SpiceRoute Heritage Resorts",
  "Medbiomate",
  "Trikonet"
];

const DEPARTMENTS = ["Design", "SEO", "Production", "Video", "Growth", "Development", "Data Entry", "Sales", "HR"];

export const intentEngine = {
  detectIntent(query: string): { intent: AIIntent; entities: ExtractedEntities } {
    const text = query.toLowerCase().trim();
    const entities = this.extractEntities(query);

    // 1. SEO & KEYWORD RANKING INTENTS (Priority Match)
    if (
      text.includes("seo") ||
      text.includes("keyword") ||
      text.includes("ranking") ||
      text.includes("search rank") ||
      text.includes("google position") ||
      text.includes("page 1") ||
      text.includes("backlink")
    ) {
      if (text.includes("report") && (entities.clientName || text.includes("client"))) {
        return { intent: "GENERATE_CLIENT_REPORT", entities };
      }
      return { intent: "SEO_KEYWORD_RANKINGS", entities };
    }

    // 2. REPORT GENERATION INTENTS
    if (
      text.includes("generate report") ||
      text.includes("monthly report") ||
      text.includes("performance report") ||
      text.includes("client report") ||
      text.includes("productivity report") ||
      (text.includes("report") && (text.includes("create") || text.includes("make") || text.includes("download") || text.includes("give me")))
    ) {
      if (entities.clientName || text.includes("client") || text.includes("apex") || text.includes("healthfirst")) {
        return { intent: "GENERATE_CLIENT_REPORT", entities };
      }
      if (text.includes("performance") || entities.employeeName) {
        return { intent: "GENERATE_PERFORMANCE_REPORT", entities };
      }
      return { intent: "GENERATE_PRODUCTIVITY_REPORT", entities };
    }

    // 3. CLIENT INTELLIGENCE & ACTIVE CLIENTS
    if (
      text.includes("active client") ||
      text.includes("show clients") ||
      text.includes("list clients") ||
      text.includes("all clients") ||
      text.includes("client status") ||
      text.includes("how are clients performing") ||
      text.includes("which client needs attention") ||
      text.includes("client list")
    ) {
      if (entities.clientName) {
        return { intent: "CLIENT_DELIVERABLES_STATUS", entities };
      }
      return { intent: "ACTIVE_CLIENTS_LIST", entities };
    }

    if (entities.clientName && (text.includes("status") || text.includes("quota") || text.includes("deliverable") || text.includes("poster") || text.includes("video"))) {
      return { intent: "CLIENT_DELIVERABLES_STATUS", entities };
    }

    // 4. ATTENDANCE INTENTS
    if (
      text.includes("attendance") ||
      text.includes("days did i work") ||
      text.includes("working days") ||
      text.includes("late arrival") ||
      text.includes("late punch") ||
      text.includes("late mark") ||
      text.includes("check-in") ||
      text.includes("clock-in") ||
      text.includes("punctual") ||
      text.includes("grace period") ||
      text.includes("who came") ||
      text.includes("who is present") ||
      text.includes("who is absent")
    ) {
      // Team/company-wide attendance (has plural indicators OR role is admin/manager)
      const isTeamQuery =
        text.includes("employees") ||
        text.includes("staff") ||
        text.includes("all employee") ||
        text.includes("everyone") ||
        text.includes("who came") ||
        text.includes("who is present") ||
        text.includes("who is absent") ||
        text.includes("team attendance") ||
        text.includes("company attendance") ||
        text.includes("today attendance") ||
        text.includes("all members") ||
        text.includes("all staff");

      if (isTeamQuery) {
        return { intent: "TEAM_ATTENDANCE", entities };
      }

      if (text.includes("better than") || text.includes("compare") || text.includes("previous month") || text.includes("last month") || text.includes("vs")) {
        return { intent: "ATTENDANCE_COMPARISON", entities };
      }
      if (text.includes("issue") || text.includes("problem") || text.includes("late") || text.includes("penalty") || text.includes("deduction")) {
        return { intent: "ATTENDANCE_ISSUES", entities };
      }
      if (text.includes("pattern") || text.includes("trend") || text.includes("time")) {
        return { intent: "PUNCTUALITY_ANALYSIS", entities };
      }
      return { intent: "ATTENDANCE_SUMMARY", entities };
    }

    // 5. LEAVE & WFH INTENTS
    if (
      text.includes("leave") ||
      text.includes("wfh") ||
      text.includes("remote day") ||
      text.includes("vacation") ||
      text.includes("sick leave") ||
      text.includes("casual leave")
    ) {
      if (text.includes("balance") || text.includes("remaining") || text.includes("how many") || text.includes("left")) {
        return { intent: "LEAVE_BALANCE", entities };
      }
      if (text.includes("pending") || text.includes("status") || text.includes("approval")) {
        return { intent: "PENDING_LEAVE_APPROVALS", entities };
      }
      if (text.includes("history") || text.includes("taken") || text.includes("applied")) {
        return { intent: "LEAVE_HISTORY", entities };
      }
      return { intent: "LEAVE_TRENDS", entities };
    }

    // 6. MANAGER & TEAM INTELLIGENCE
    if (
      text.includes("team") ||
      text.includes("who is overloaded") ||
      text.includes("workload") ||
      text.includes("who needs support") ||
      text.includes("who completed the most") ||
      text.includes("team performance") ||
      text.includes("designer workload") ||
      text.includes("design team") ||
      text.includes("delayed project") ||
      text.includes("show me delayed")
    ) {
      if (text.includes("overload") || text.includes("imbalance") || text.includes("support") || text.includes("capacity")) {
        return { intent: "TEAM_WORKLOAD_IMBALANCE", entities };
      }
      if (text.includes("delay") || text.includes("stuck") || text.includes("bottleneck")) {
        return { intent: "DELAYED_PROJECTS", entities };
      }
      if (text.includes("pending approval") || text.includes("review")) {
        return { intent: "PENDING_TEAM_APPROVALS", entities };
      }
      return { intent: "TEAM_PERFORMANCE", entities };
    }

    // 7. WORK TRACK & TASKS
    if (
      text.includes("task") ||
      text.includes("deliverable") ||
      text.includes("work completion") ||
      text.includes("overdue") ||
      text.includes("productivity") ||
      text.includes("work track") ||
      text.includes("pending work")
    ) {
      if (text.includes("overdue") || text.includes("delayed") || text.includes("late")) {
        return { intent: "OVERDUE_TASKS", entities };
      }
      if (text.includes("pending") || text.includes("in progress") || text.includes("remaining")) {
        return { intent: "PENDING_TASKS", entities };
      }
      if (text.includes("productivity") || text.includes("percentage") || text.includes("rate") || text.includes("score")) {
        return { intent: "PRODUCTIVITY_RATE", entities };
      }
      return { intent: "MY_TASKS_SUMMARY", entities };
    }

    // 8. ADMIN & COMPANY OVERVIEW
    if (
      text.includes("company overview") ||
      text.includes("headcount") ||
      text.includes("total employees") ||
      text.includes("company status") ||
      text.includes("organization") ||
      text.includes("operational efficiency")
    ) {
      return { intent: "COMPANY_OVERVIEW", entities };
    }

    // 9. DRAFTING
    if (text.includes("draft") || text.includes("write email") || text.includes("compose") || text.includes("message to")) {
      return { intent: "DRAFT_COMMUNICATION", entities };
    }

    return { intent: "GENERAL_WORKPLACE_QUERY", entities };
  },

  extractEntities(query: string): ExtractedEntities {
    const text = query.toLowerCase();
    const entities: ExtractedEntities = {};

    // Find client
    for (const client of CLIENT_NAMES) {
      const parts = client.toLowerCase().split(" ");
      if (text.includes(client.toLowerCase()) || text.includes(parts[0])) {
        entities.clientName = client;
        break;
      }
    }

    // Find department
    for (const dept of DEPARTMENTS) {
      if (text.includes(dept.toLowerCase())) {
        entities.departmentName = dept;
        break;
      }
    }

    // Detect month
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    for (const m of months) {
      if (text.includes(m)) {
        entities.month = m;
        break;
      }
    }

    if (text.includes("report")) {
      entities.isReportRequested = true;
    }

    return entities;
  }
};
