import { UserContext, AIResponsePayload } from "./ai.types.js";
import { geminiClient } from "./gemini-client.service.js";
import { ollamaClient } from "./ollama-client.service.js";
import { stemsContextService, StemsLiveContext } from "./stems-context.service.js";
import { operationsReasoningService, ResolvedContextMemory, OperationsAnalysis } from "./operations-reasoning.service.js";

function buildOperationsAnalystPrompt(
  user: UserContext,
  ctx: StemsLiveContext,
  memory: ResolvedContextMemory,
  analysis: OperationsAnalysis,
  language: string = "en"
): string {
  const isML = language === "ml";
  const langRule = isML
    ? "CRITICAL: The user has selected Malayalam. You MUST write your entire response in natural Malayalam (മലയാളം) script. Specific names, URLs, or technical terms can remain in English."
    : "Reply in clear, professional, executive English.";

  const targetedInfo = memory.targetEmployee
    ? `TARGET EMPLOYEE IN CONTEXT: ${JSON.stringify(ctx.employeesDirectory.find(e => e.name.toLowerCase().includes(memory.targetEmployee!.toLowerCase())), null, 2)}`
    : memory.targetClient
    ? `TARGET CLIENT IN CONTEXT: ${JSON.stringify(ctx.clients.activeClients.find(c => c.name.toLowerCase().includes(memory.targetClient!.toLowerCase())), null, 2)}`
    : `GENERAL OPERATIONS CONTEXT IN SCOPE`;

  return `You are Tale Buddy, the Operations Analyst & AI Assistant for Second Tales (STEMS Platform).
Current Date: ${ctx.todayDateStr}
Active User: ${user.name} (Role: ${user.role})

YOUR ROLE & IDENTITY:
- Name: Tale Buddy
- Company: Second Tales
- Creator: Second Tales (NEVER mention Google, OpenAI, Gemini, or third parties)
- Attitude: Direct, data-accurate, professional, and concise.

FORMATTING & CONTENT RULES:
1. ALWAYS make the main heading bold: ### **Employee Daily Task Allocation Report** (NEVER include square brackets [ ] around titles)
2. ALWAYS make section titles bold: **Summary:**, **Detailed Report:**
3. MANDATORY BOLDING: You MUST bold all employee names, roles, department names, client names, counts, deadlines, and key numbers that appear in the live data.
4. NO UNNECESSARY SECTIONS: Do NOT include "Insights:" or "Recommended Actions:" or "Recommendations:". ONLY provide the detailed report for what the user specifically asked.
5. In bullet points, format items as: - **Category / Name / Department:** Detailed facts with **bold** highlights.
6. Keep answers direct, accurate, and completely free of filler words.
7. DATA ACCURACY: Use only records from FULL LIVE STEMS DATA. If a section has no records, say that no live records were found. Do not invent employees, clients, tasks, rankings, quotas, attendance, or percentages.

MANDATORY BUSINESS REPORT STRUCTURE:

### **Descriptive Report Title**

**Summary:**
Use the exact live counts from FULL LIVE STEMS DATA.



CONTEXT MEMORY:
- Target Entity: ${memory.activeEntityName || "Company-wide"}
- Multi-turn Follow-up: ${memory.isFollowUp ? "YES" : "NO"}

OPERATIONS DATA:
${targetedInfo}

FULL LIVE STEMS DATA:
${JSON.stringify(ctx, null, 2)}

${langRule}`;
}

function autoEnrichMarkdownBolding(text: string): string {
  if (!text) return text;
  let lines = text.split("\n");

  // 1. Ensure first line title has bolding if it starts with # or is a standalone title
  if (lines.length > 0) {
    let firstLine = lines[0].trim();
    if (firstLine.startsWith("#")) {
      const clean = firstLine.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/^\[+|\]+$/g, "").trim();
      lines[0] = `### **${clean}**`;
    } else if (
      !firstLine.startsWith("•") &&
      !firstLine.startsWith("-") &&
      !firstLine.startsWith("*") &&
      firstLine.length < 80 &&
      !firstLine.toLowerCase().startsWith("hello") &&
      !firstLine.toLowerCase().startsWith("hi")
    ) {
      const clean = firstLine.replace(/\*\*/g, "").replace(/^\[+|\]+$/g, "").trim();
      lines[0] = `### **${clean}**`;
    }
  }

  return lines
    .map((line) => {
      let l = line;

      // 2. Ensure section labels are bold
      if (
        /^(Summary|Detailed Report|Key Points|Breakdown|Operations Status|Task Pipeline|Attendance Status):?$/i.test(
          l.replace(/\*\*/g, "").trim()
        )
      ) {
        const label = l.replace(/\*\*/g, "").replace(/:?$/, "");
        return `**${label}:**`;
      }

      // 3. Bullet line category bolding
      if (l.trim().startsWith("- ") || l.trim().startsWith("• ") || l.trim().startsWith("* ")) {
        const bulletChar = l.trim().substring(0, 2);
        let content = l.trim().substring(2).trim();

        if (!content.startsWith("**") && content.includes(":")) {
          const colonIdx = content.indexOf(":");
          const prefix = content.substring(0, colonIdx).trim();
          const rest = content.substring(colonIdx + 1);
          if (prefix.length < 70) {
            content = `**${prefix}:**${rest}`;
          }
        }
        l = `${bulletChar} ${content}`;
      }

      // 4. Auto-bold key statuses if not already bolded
      const statusWords = [
        "AVAILABLE",
        "OVERLOADED",
        "BALANCED",
        "DELAYED",
        "IN PROGRESS",
        "FINISHED",
        "APPROVED",
        "REWORK",
        "Casual Leave",
        "Sick Leave",
        "Earned Leave",
        "Late Arrival",
        "Working Remotely",
        "WFH"
      ];

      for (const sw of statusWords) {
        const regex = new RegExp(`(?<!\\*\\*)\\b(${sw})\\b(?!\\*\\*)`, "gi");
        l = l.replace(regex, "**$1**");
      }

      // 5. Auto-bold counts like "X active tasks", "X completed tasks", "Out of X", "X employees", "X% attendance"
      l = l.replace(
        /(?<!\*\*)\b(\d+)\s*(total company employees|total employees|employees|active tasks?|completed tasks?|tasks?|delayed tasks?|delayed deliverables?|deliverables?|points?|days?|hours?|%)\b(?!\*\*)/gi,
        "**$1 $2**"
      );
      l = l.replace(/(?<!\*\*)\b(with\s+)(\d+)(\s+active\s+tasks?)\b(?!\*\*)/gi, "$1**$2$3**");
      l = l.replace(/(?<!\*\*)\b(with\s+)(\d+)(\s+completed\s+tasks?)\b(?!\*\*)/gi, "$1**$2$3**");
      l = l.replace(/(?<!\*\*)\b(at\s+)(\d{1,2}:\d{2}\s*(?:AM|PM))\b(?!\*\*)/gi, "$1**$2**");
      l = l.replace(/(?<!\*\*)\b(Out of\s+)(\d+)\b(?!\*\*)/gi, "$1**$2**");

      return l;
    })
    .join("\n");
}

function containsPlaceholderOperationsData(text: string): boolean {
  const lower = text.toLowerCase();
  const blockedTerms = [
    "apex realty",
    "healthfirst clinics",
    "zenith cloud",
    "vanity living",
    "kitewave fintech",
    "spiceroute",
    "rahul nair",
    "sneha menon",
    "devika pillai",
    "naveen kumar",
    "pooja mohan"
  ];
  const blockedPatterns = [
    /\b88%\s+attendance\b/i,
    /\b20%\s+task\s+completion\b/i,
    /\b38\/48\s+keywords\b/i,
    /\b79\.1%\s+page\s+1\b/i,
    /\b12\s+active\s+client\s+retainers\b/i
  ];

  return blockedTerms.some((term) => lower.includes(term)) || blockedPatterns.some((pattern) => pattern.test(text));
}

export const aiService = {
  async processQuestion(
    user: UserContext,
    question: string,
    language: string = "en",
    history: { role: "user" | "assistant"; text: string }[] = []
  ): Promise<AIResponsePayload> {
    const rawLower = question.toLowerCase().trim();
    const isSeoRankingQuestion =
      rawLower.includes("seo") ||
      rawLower.includes("keyword") ||
      rawLower.includes("ranking") ||
      rawLower.includes("google position") ||
      rawLower.includes("page 1");

    // ── 0. GREETINGS & IDENTITY (0ms LATENCY) ──
    if (rawLower.match(/^(hi|hello|hey|hellow|good morning|good afternoon|good evening|namaskaram|namaste|hai)$/i)) {
      const userName = user.name || "there";
      const isML = language === "ml" || rawLower === "namaskaram";

      const text = isML
        ? `നമസ്കാരം **${userName}**! ഞാൻ സെക്കൻഡ് ടെയിൽസിന്റെ **Tale Buddy**.

എന്താണ് ഇന്ന് അറിയേണ്ടത്?
• **ഇന്നത്തെ റിപ്പോർട്ട്:** "Show me today's company status."
• **ടാസ്കുകൾ:** "Who is working on what today?" / "Which tasks are pending?"
• **വർക്ക് ലോഡ്:** "Who has the highest workload?" / "Who can take a new task?"
• **അറ്റൻഡൻസ്:** "Who is present today?" / "Who is on leave today?"`
        : `Hello **${userName}**! Namaskaram 🙏 I am **Tale Buddy**, your Operations Assistant at **Second Tales**.

How can I assist you with company operations today?
• **Daily Status:** "Show me today's company status." or "Today report"
• **Task Intelligence:** "Who is working on what today?" or "Which tasks are pending?"
• **Workload & Capacity:** "Who has the highest workload?" or "Who can take a new task?"
• **Attendance & Availability:** "Who is present today?" or "Who is on leave today?"`;

      return {
        intent: "GENERAL_WORKPLACE_QUERY",
        markdown: text,
        suggestedFollowUps: [
          "Show me today's company status.",
          "Who is working on what today?",
          "Who has the highest workload?",
          "Which tasks are pending?"
        ]
      };
    }

    if (rawLower.match(/(who (are you|created you|made you|invented you|built you)|what is your name)/i)) {
      return {
        intent: "GENERAL_WORKPLACE_QUERY",
        markdown: `### **Second Tales Operations Assistant**

**Summary:**
I am **Tale Buddy**, the AI Operations Assistant built by **Second Tales** to provide detailed reports on company attendance, team tasks, workload distribution, and client deliverables.

**Detailed Report:**
- **System Role:** **AI Operations & Workforce Management Assistant**
- **Connected Systems:** Live **Biometric Attendance**, **WorkTrack Tasks**, **Client Deliverables**, and **Leave Management**
- **Platform:** **Second Tales Enterprise Management System (STEMS)**`,
        suggestedFollowUps: [
          "Show me today's company status.",
          "Who has the highest workload?",
          "Who can take a new task?",
          "Show active clients"
        ]
      };
    }

    if (isSeoRankingQuestion) {
      return {
        intent: "GENERAL_WORKPLACE_QUERY",
        markdown: `### **SEO Keyword Rankings**

**Summary:**
No live SEO keyword ranking source is connected to Tale Buddy yet.

**Detailed Report:**
- **Keyword Rankings:** **0** live ranking records available
- **Top 10 Keywords:** **0** live ranking records available
- **Google Page 1 Rate:** **Not available**
- **Data Safety:** No placeholder SEO clients, keywords, ranking counts, or traffic metrics were generated`,
        suggestedFollowUps: [
          "Show active clients",
          "Show me today's company status.",
          "Who is working on what today?"
        ]
      };
    }

    // ── 1. RETRIEVE LIVE STEMS DATA CONTEXT ──
    const liveContext = await stemsContextService.getLiveContext(user);

    // ── 2. CONTEXT MEMORY & INTENT RESOLUTION ──
    const memory = operationsReasoningService.resolveIntentAndMemory(question, history, liveContext);
    const analysis = operationsReasoningService.computeOperationsAnalysis(liveContext);

    const operationsIntents = new Set<ResolvedContextMemory["intentCategory"]>([
      "COMPANY_DAILY_OVERVIEW",
      "EMPLOYEE_DEEP_DIVE",
      "TASK_INTELLIGENCE",
      "WORKLOAD_AND_BOTTLENECK",
      "PROJECT_CLIENT_REPORT",
      "TEAM_DEPARTMENT_STATUS",
      "ATTENDANCE_LEAVE_STATUS",
      "DECISION_AND_RECOMMENDATIONS"
    ]);

    if (operationsIntents.has(memory.intentCategory)) {
      const deterministicResponse = this.generateOperationsAnalystResponse(question, memory, liveContext, analysis, user);
      return {
        intent: "GENERAL_WORKPLACE_QUERY",
        markdown: autoEnrichMarkdownBolding(deterministicResponse),
        suggestedFollowUps: this.getSmartFollowUps(question, memory, liveContext)
      };
    }

    // ── 3. GEMINI GENERAL INTELLIGENCE ENGINE ──
    if (geminiClient.isConfigured()) {
      try {
        const systemPrompt = buildOperationsAnalystPrompt(user, liveContext, memory, analysis, language);
        const geminiAnswer = await geminiClient.generateWithHistory({
          systemContext: systemPrompt,
          history,
          message: question,
          maxTokens: 1200,
          temperature: 0.2
        });

        if (geminiAnswer && geminiAnswer.trim().length > 20 && !containsPlaceholderOperationsData(geminiAnswer)) {
          return {
            intent: "GENERAL_WORKPLACE_QUERY",
            markdown: autoEnrichMarkdownBolding(geminiAnswer.trim()),
            suggestedFollowUps: this.getSmartFollowUps(question, memory, liveContext)
          };
        }
      } catch (err) {
        console.warn("Gemini Operations Analyst generation failed, falling back to local reasoning engine:", err);
      }
    }

    // ── 4. OLLAMA FALLBACK (IF CONFIGURED) ──
    if (ollamaClient.isConfigured()) {
      try {
        const systemPrompt = buildOperationsAnalystPrompt(user, liveContext, memory, analysis, language);
        const llmAnswer = await ollamaClient.generate({
          prompt: question,
          systemContext: systemPrompt
        });
        if (llmAnswer && llmAnswer.trim().length > 20 && !containsPlaceholderOperationsData(llmAnswer)) {
          return {
            intent: "GENERAL_WORKPLACE_QUERY",
            markdown: autoEnrichMarkdownBolding(llmAnswer.trim()),
            suggestedFollowUps: this.getSmartFollowUps(question, memory, liveContext)
          };
        }
      } catch {
        // Fall through
      }
    }

    // ── 5. DETERMINISTIC OPERATIONS ANALYST REASONING ENGINE ──
    const fallbackResponse = this.generateOperationsAnalystResponse(question, memory, liveContext, analysis, user);
    return {
      intent: "GENERAL_WORKPLACE_QUERY",
      markdown: autoEnrichMarkdownBolding(fallbackResponse),
      suggestedFollowUps: this.getSmartFollowUps(question, memory, liveContext)
    };
  },


  generateOperationsAnalystResponse(
    question: string,
    memory: ResolvedContextMemory,
    ctx: StemsLiveContext,
    analysis: OperationsAnalysis,
    user: UserContext
  ): string {
    const q = question.toLowerCase();

    // ── A. INDIVIDUAL EMPLOYEE DEEP DIVE ──
    if (memory.targetEmployee) {
      const emp = ctx.employeesDirectory.find(e => e.name.toLowerCase().includes(memory.targetEmployee!.toLowerCase()));
      if (!emp) {
        return `### **Employee Operations Report**

**Summary:**
No live employee record matched **${memory.targetEmployee}**.

**Detailed Report:**
- **Available Employee Records:** **${ctx.employeesDirectory.length}** active employee record(s) found in the local database.`;
      }

      const workloadInfo = ctx.tasks.employeeWorkload.find(w => w.name.toLowerCase().includes(emp.name.toLowerCase())) || { activeTasks: 0, completedTasks: 0, points: 0, status: "AVAILABLE" as const };
      const activeTaskList = emp.activeTasks.length > 0 ? emp.activeTasks : ["No active assigned work found"];
      const isCompletingOnTime = workloadInfo.activeTasks < 3;

      if (q.includes("completing on time") || q.includes("on time")) {
        return `### **Performance & Deadline Status: ${emp.name}**

**Summary:**
**${emp.name}** is currently **${isCompletingOnTime ? "on track and meeting deliverable deadlines" : "facing deadline risk due to peak workload"}** with an on-time completion score of **${emp.productivityScore}%**.

**Detailed Report:**
- **Employee Name & Role:** **${emp.name}** — **${emp.designation}** (**${emp.department} Department**)
- **Active Assigned Deliverables:** ${activeTaskList.map(t => `**${t}**`).join(", ")}
- **Workload Status:** **${workloadInfo.activeTasks} active tasks** (Team average is **${analysis.teamAverageTasks} tasks**)
- **Attendance Today:** **${emp.todayStatus}**`;
      }

      return `### **Employee Operations Report: ${emp.name}**

**Summary:**
**${emp.name}** (**${emp.designation}**) is currently **${emp.todayStatus}** managing **${workloadInfo.activeTasks} active deliverables** with **${workloadInfo.completedTasks} completed tasks** this cycle.

**Detailed Report:**
- **Designation & Department:** **${emp.designation}** — **${emp.department}** (Reporting to **${emp.manager}**)
- **Active Assigned Work:**
${activeTaskList.map(t => `  - **${t}**`).join("\n")}
- **Workload Classification:** **${workloadInfo.status}** (**${workloadInfo.activeTasks} tasks** vs team average **${analysis.teamAverageTasks}**)
- **Productivity & On-Time SLA:** **${emp.productivityScore}%**
- **Leave Balance:** **${emp.leaveBalance.casual} Casual**, **${emp.leaveBalance.sick} Sick**, **${emp.leaveBalance.earned} Earned Days**`;
    }

    // ── B. TASK INTELLIGENCE & DELAYED WORK ──
    if (memory.intentCategory === "TASK_INTELLIGENCE" || q.includes("who is working on what") || q.includes("pending tasks") || q.includes("delayed") || q.includes("pending work")) {
      const delayedList = ctx.tasks.delayedTaskList.length > 0
        ? ctx.tasks.delayedTaskList.map(d => `- **${d.title}** (**${d.client}**) — Assigned to **${d.assignedTo}** [Priority: **${d.priority}**, Deadline: **${d.deadline}**]`).join("\n")
        : "- **No overdue deliverables currently in the queue.**";

      const inProgressList = ctx.employeesDirectory
        .filter(e => e.activeTasks.length > 0 && e.activeTasks[0] !== "Regular Operations & Queue Standby")
        .slice(0, 6)
        .map(e => `- **${e.name}** (**${e.department}**): ${e.activeTasks.map(t => `*${t}*`).join(", ")}`)
        .join("\n") || "- **No active assigned tasks found in live WorkTrack records.**";

      return `### **WorkTrack Deliverables & Pending Tasks Report**

**Summary:**
Second Tales currently has **${ctx.tasks.inProgressCount} tasks in progress**, **${ctx.tasks.delayedCount} delayed/overdue deliverables**, and **${ctx.tasks.completedToday} tasks completed today**.

**Detailed Report:**
- **Delayed & Overdue Deliverables (${ctx.tasks.delayedCount} items):**
${delayedList}
- **Active Workflows in Progress:**
${inProgressList}
- **Task Pipeline Summary:** **${ctx.tasks.inProgressCount} In Progress**, **${ctx.tasks.pendingCount} Pending Review**, **${ctx.tasks.reworkCount} In Rework**
- **Workload Concentration:** **${ctx.tasks.highestWorkloadEmployee.name}** is managing **${ctx.tasks.highestWorkloadEmployee.activeTasks} active tasks**`;
    }

    // ── C. WORKLOAD & CAPACITY ──
    if (memory.intentCategory === "WORKLOAD_AND_BOTTLENECK" || q.includes("who can take a new task") || q.includes("highest workload") || q.includes("overloaded") || q.includes("less workload")) {
      const workloadRanking = ctx.tasks.employeeWorkload.slice(0, 6).map(e => `- **${e.name}** (**${e.department}**): **${e.activeTasks} active tasks**, **${e.completedTasks} completed** [Status: **${e.status}**]`).join("\n") || "- **No employee workload records found.**";

      return `### **Team Workload & Capacity Analysis**

**Summary:**
Company workload average is **${analysis.teamAverageTasks} active tasks per person**. **${ctx.tasks.highestWorkloadEmployee.name}** carries the highest workload (**${ctx.tasks.highestWorkloadEmployee.activeTasks} active tasks**), while **${ctx.tasks.availableEmployees.join(", ") || "no available employees found"}** have available bandwidth.

**Detailed Report:**
- **Workload Distribution by Team Member:**
${workloadRanking}
- **Overloaded Personnel (≥3 tasks):** **${ctx.tasks.overloadedEmployees.join(", ") || "None"}**
- **Available Bandwidth (0–1 tasks):** **${ctx.tasks.availableEmployees.join(", ") || "None"}**`;
    }

    // ── D. PROJECT & CLIENT REPORT ──
    if (memory.intentCategory === "PROJECT_CLIENT_REPORT" || memory.targetClient || q.includes("client update")) {
      const targetClient = memory.targetClient
        ? ctx.clients.activeClients.find(c => c.name.toLowerCase().includes(memory.targetClient!.toLowerCase()))
        : ctx.clients.activeClients[0];

      if (targetClient) {
        const completedDeliverables = targetClient.postersDone + targetClient.videosDone;
        const committedDeliverables = targetClient.postersCommitted + targetClient.videosCommitted;
        const quotaSummary = committedDeliverables > 0
          ? `${Math.round((completedDeliverables / committedDeliverables) * 100)}% monthly quota achieved`
          : "No monthly quota recorded";

        return `### **Client Deliverables Report: ${targetClient.name}**

**Summary:**
**${targetClient.name}** is on the **${targetClient.package}** retainer. Deliverable completion is at **${targetClient.postersDone}/${targetClient.postersCommitted} Posters** and **${targetClient.videosDone}/${targetClient.videosCommitted} Videos** (**${quotaSummary}**).

**Detailed Report:**
- **Client Name:** **${targetClient.name}**
- **Account Manager:** **${targetClient.accountManager}**
- **Retainer Status:** **${targetClient.status}**
- **Posters Delivered:** **${targetClient.postersDone}** of **${targetClient.postersCommitted}**
- **Videos Delivered:** **${targetClient.videosDone}** of **${targetClient.videosCommitted}**
- **Pending Deliverables:** **${targetClient.pendingDeliverables} items**
- **Delayed Items:** **${targetClient.delayedDeliverables} items**`;
      }

      return `### **Client Deliverables Report**

**Summary:**
No live client record matched the request.

**Detailed Report:**
- **Active Client Records:** **${ctx.clients.totalClients}** client record(s) found in the local database.`;
    }

    // ── E. ATTENDANCE & LEAVE STATUS ──
    if (memory.intentCategory === "ATTENDANCE_LEAVE_STATUS" || q.includes("leave") || q.includes("attendance") || q.includes("who is present") || q.includes("who is on leave")) {
      const presentList = ctx.attendance.presentEmployees.slice(0, 6).map(p => `- **${p.name}** (**${p.department}**) — Clock-in: **${p.checkInAt}**${p.isLate ? " (**Late**)" : ""}`).join("\n") || "- **No present punch records found for today.**";
      const leaveList = ctx.attendance.onLeaveEmployees.map(l => `- **${l.name}** — **${l.type}**`).join("\n") || "- **None (all active staff accounted for)**";

      return `### **Workforce Attendance & Leave Report**

**Summary:**
Today's company attendance is **${ctx.attendance.attendancePercentage}%** with **${ctx.attendance.presentCount} of ${ctx.attendance.totalEmployees} employees present** in office, **${ctx.attendance.onLeaveCount} on approved leave**, and **${ctx.attendance.wfhCount} working remotely**.

**Detailed Report:**
- **Present in Office (${ctx.attendance.presentCount} employees):**
${presentList}
- **On Approved Leave (${ctx.attendance.onLeaveCount} employees):**
${leaveList}
- **Remote Workers (WFH):** **${ctx.attendance.wfhEmployees.map(w => w.name).join(", ") || "None"}**
- **Late Arrivals (>9:45 AM threshold):** **${ctx.attendance.lateArrivalsCount} employee(s)** (${ctx.attendance.lateCheckIns.map(l => `**${l.name}** at ${l.time}`).join(", ") || "None"})
- **Leave Usage Leader This Year:** **${ctx.attendance.maxLeaveTakerMonth.name}** (${ctx.attendance.maxLeaveTakerMonth.daysTaken} day(s) used)`;
    }

    // ── F. DAILY COMPANY OVERVIEW (Default) ──
    const activeClientList = ctx.clients.activeClients.length > 0
      ? ctx.clients.activeClients.slice(0, 5).map(c => `**${c.name}**`).join(", ")
      : "**No active clients found**";
    const hasAnyLiveOperationsData = ctx.attendance.totalEmployees > 0 || ctx.tasks.totalTasks > 0 || ctx.clients.totalClients > 0;

    if (!hasAnyLiveOperationsData) {
      return `### **Daily Company Operations Overview**

**Summary:**
No live EMS records were available for this request, so Tale Buddy cannot calculate today's company status.

**Detailed Report:**
- **Active Workforce:** **0** live employee records available
- **Task Pipeline:** **0** live WorkTrack records available
- **Active Clients:** **0** live client records available
- **SEO Rankings:** **No live SEO ranking source connected**
- **Data Safety:** No placeholder clients, employees, attendance, task counts, or SEO rankings were generated`;
    }

    return `### **Daily Company Operations Overview**

**Summary:**
Second Tales operations are running at **${ctx.attendance.attendancePercentage}% attendance** with **${ctx.tasks.completionRate}% task completion rate** across **${ctx.clients.totalClients} active client retainers**.

**Detailed Report:**
- **Active Workforce:** **${ctx.attendance.presentCount} present**, **${ctx.attendance.onLeaveCount} on leave**, **${ctx.attendance.wfhCount} remote (WFH)**
- **Task Pipeline:** **${ctx.tasks.inProgressCount} in progress**, **${ctx.tasks.completedToday} completed today**, **${ctx.tasks.delayedCount} delayed**
- **Active Clients (${ctx.clients.totalClients}):** ${activeClientList}
- **SEO Rankings:** **${ctx.departments.marketingSeo.top10Keywords}/${ctx.departments.marketingSeo.totalKeywords} keywords** on Google Page 1 (**${ctx.departments.marketingSeo.page1Rate}**)
- **Workload Concentration:** **${ctx.tasks.highestWorkloadEmployee.name}** holds the highest load with **${ctx.tasks.highestWorkloadEmployee.activeTasks} active deliverables**`;
  },

  getSmartFollowUps(query: string, memory: ResolvedContextMemory, ctx: StemsLiveContext): string[] {
    if (memory.targetEmployee) {
      return [
        `Is ${memory.targetEmployee.split(" ")[0]} completing on time?`,
        `What tasks did ${memory.targetEmployee.split(" ")[0]} complete this week?`,
        "Who can take a new task?",
        "Show me today's company status."
      ];
    }

    if (memory.targetClient) {
      return [
        `Which ${memory.targetClient.split(" ")[0]} deliverables are delayed?`,
        "Who has the highest workload?",
        "Show me today's company status.",
        "Who is working on what today?"
      ];
    }

    const q = query.toLowerCase();
    if (q.includes("attendance") || q.includes("present") || q.includes("leave")) {
      return [
        "Who is on leave today?",
        "Who came in late today?",
        "Who is working on what today?",
        "Show me today's company status."
      ];
    }

    if (q.includes("task") || q.includes("workload") || q.includes("delayed") || q.includes("pending")) {
      return [
        "Who can take a new task?",
        "Who has the highest workload?",
        "Which tasks are pending?",
        "Show me today's company status."
      ];
    }

    return [
      "Who is working on what today?",
      "Who has the highest workload?",
      "Which tasks are pending?",
      "Show me today's company status."
    ];
  },

  getSuggestedPrompts(role: string): string[] {
    const r = (role || "").toUpperCase();
    if (r === "SUPER_ADMIN" || r === "HR_ADMIN") {
      return [
        "Show me today's company status.",
        "Who is working on what today?",
        "Who has the highest workload?",
        "Which tasks are pending?",
        "Who is present today?"
      ];
    }
    if (r === "MANAGER" || r === "TEAM_LEAD") {
      return [
        "Who can take a new task?",
        "Who is working on what today?",
        "What tasks are delayed?",
        "Show me today's company status.",
        "Which tasks are pending?"
      ];
    }
    return [
      "Show my pending tasks and workload",
      "How many days did I work this month?",
      "Who is present today in my team?",
      "Show top SEO keyword rankings",
      "Show me today's company status."
    ];
  }
};
