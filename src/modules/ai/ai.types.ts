export type AIIntent =
  | "SEO_KEYWORD_RANKINGS"
  | "SEO_PERFORMANCE"
  | "ACTIVE_CLIENTS_LIST"
  | "CLIENT_INTELLIGENCE"
  | "CLIENT_DELIVERABLES_STATUS"
  | "GENERATE_CLIENT_REPORT"
  | "GENERATE_PERFORMANCE_REPORT"
  | "GENERATE_PRODUCTIVITY_REPORT"
  | "TEAM_WORKLOAD_IMBALANCE"
  | "TEAM_PERFORMANCE"
  | "DELAYED_PROJECTS"
  | "PENDING_TEAM_APPROVALS"
  | "ATTENDANCE_SUMMARY"
  | "ATTENDANCE_COMPARISON"
  | "ATTENDANCE_ISSUES"
  | "PUNCTUALITY_ANALYSIS"
  | "TEAM_ATTENDANCE"
  | "LEAVE_BALANCE"
  | "LEAVE_HISTORY"
  | "PENDING_LEAVE_APPROVALS"
  | "LEAVE_TRENDS"
  | "MY_TASKS_SUMMARY"
  | "PENDING_TASKS"
  | "OVERDUE_TASKS"
  | "PRODUCTIVITY_RATE"
  | "COMPANY_OVERVIEW"
  | "COMPANY_ATTENDANCE_TRENDS"
  | "DRAFT_COMMUNICATION"
  | "GENERAL_WORKPLACE_QUERY";

export interface ExtractedEntities {
  clientName?: string;
  employeeName?: string;
  departmentName?: string;
  month?: string;
  year?: number;
  metric?: string;
  isReportRequested?: boolean;
}

export interface UserContext {
  userId: string;
  employeeId?: string;
  companyId?: string | null;
  role: string;
  name: string;
  email: string;
  department?: string;
  designation?: string;
}

export interface RecommendationItem {
  id: string;
  title: string;
  type: "warning" | "info" | "success" | "action";
  description: string;
  impact: string;
  suggestedAction?: string;
}

export interface AIResponsePayload {
  intent: AIIntent;
  markdown: string;
  spokenReply?: string; // Short conversational version for TTS (no markdown/tables)
  recommendations?: RecommendationItem[];
  suggestedFollowUps?: string[];
  reportTable?: {
    title: string;
    headers: string[];
    rows: string[][];
  };
  metrics?: Record<string, any>;
}
