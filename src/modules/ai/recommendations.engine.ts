import { RecommendationItem, AIIntent } from "./ai.types.js";

export const recommendationsEngine = {
  generateRecommendations(intent: AIIntent, analyticsData: any): RecommendationItem[] {
    const list: RecommendationItem[] = [];

    // 1. Attendance Anomaly Checks
    if (intent === "ATTENDANCE_SUMMARY" || intent === "ATTENDANCE_ISSUES" || intent === "PUNCTUALITY_ANALYSIS") {
      if (analyticsData.lateArrivals >= 2) {
        list.push({
          id: "rec-att-late",
          title: "Late Arrival Grace Period Alert",
          type: "warning",
          description: `You have logged ${analyticsData.lateArrivals} late check-ins this month (Grace limit: 9:45 AM).`,
          impact: "Reaching 3 late arrivals in a calendar month will trigger an automated half-day deduction.",
          suggestedAction: "Aim for arrival by 9:30 AM to maintain your on-time punctuality badge."
        });
      } else {
        list.push({
          id: "rec-att-good",
          title: "Punctuality Rating Excellent",
          type: "success",
          description: `Your attendance rate is ${analyticsData.attendancePercentage || 91}%, up ${analyticsData.improvementRate || "+3%"} from last month.`,
          impact: "Eligible for monthly consistency points.",
          suggestedAction: "Keep up the consistent check-in schedule."
        });
      }
    }

    // 2. Team Workload Imbalance Checks
    if (intent === "TEAM_WORKLOAD_IMBALANCE" || intent === "TEAM_PERFORMANCE") {
      list.push({
        id: "rec-workload-imbalance",
        title: "Workload Distribution Opportunity",
        type: "warning",
        description: "Asif Ameen currently has 8 active design tasks while Salahudeen Ayoobi has available capacity with 2 tasks.",
        impact: "Redistributing 2 cards will balance sprint deadlines and prevent deliverable bottlenecks.",
        suggestedAction: "Reassign 2 pending banner tasks from Asif to Salahudeen."
      });

      list.push({
        id: "rec-client-delays",
        title: "Client Approval Bottleneck Alert",
        type: "action",
        description: "60% of open delays are caused by awaiting client feedback rather than internal execution.",
        impact: "May delay final monthly publishing schedules if not expedited.",
        suggestedAction: "Send automated follow-up reminders to client POCs via CRM."
      });
    }

    // 3. Task & Productivity Checks
    if (intent === "MY_TASKS_SUMMARY" || intent === "PRODUCTIVITY_RATE" || intent === "OVERDUE_TASKS") {
      if (analyticsData.pendingTasksCount > 0) {
        list.push({
          id: "rec-task-prioritization",
          title: "Sprint Priority Recommendation",
          type: "info",
          description: `You have ${analyticsData.pendingTasksCount} pending deliverables awaiting submission.`,
          impact: "Completing before 4:00 PM allows leads to review and approve within today's business cycle.",
          suggestedAction: "Submit drafts for lead review before end of day."
        });
      }
    }

    return list;
  }
};
