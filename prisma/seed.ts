import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";

const scopeSeeds = [
  { code: "GLOBAL", name: "Global", description: "Full access across the platform." },
  { code: "COMPANY", name: "Company", description: "Access limited to a single company." },
  { code: "SELF", name: "Self", description: "Access limited to the current user or their own records." },
  { code: "DIRECT_REPORTS", name: "Direct Reports", description: "Access limited to direct reporting employees." },
  { code: "DEPARTMENT", name: "Department", description: "Access limited to one department." },
  { code: "TEAM", name: "Team", description: "Access limited to one team." },
  { code: "OFFICE", name: "Office", description: "Access limited to one office." },
  { code: "CLIENT", name: "Client", description: "Access limited to a specific client." },
  { code: "PROJECT", name: "Project", description: "Access limited to a specific project." },
  { code: "ASSIGNED_CLIENTS", name: "Assigned Clients", description: "Access limited to clients assigned to the user." },
  { code: "ASSIGNED_PROJECTS", name: "Assigned Projects", description: "Access limited to projects assigned to the user." },
  { code: "ASSIGNED_TO_ME", name: "Assigned To Me", description: "Access limited to work assigned to the current user." },
  { code: "CREATED_BY_ME", name: "Created By Me", description: "Access limited to records created by the current user." }
] as const;

const permissionSeeds = [
  // Settings & Authority
  ["settings.authority.view", "settings", "authority", "view", "View authority settings, access profiles, and audit logs.", true],
  ["settings.authority.manage", "settings", "authority", "manage", "Create and manage access profiles, user overrides, scopes, and workflows.", true],
  ["settings.company.manage", "settings", "company", "manage", "Manage company settings and preferences.", true],
  ["settings.office.manage", "settings", "office", "manage", "Manage offices and locations.", true],
  ["settings.audit.view", "settings", "audit", "view", "View security and authority audit logs.", true],

  // Dashboard
  ["dashboard.summary.view", "dashboard", "summary", "view", "View platform dashboard summaries and widgets.", false],
  ["dashboard.metrics.export", "dashboard", "metrics", "export", "Export dashboard summary metrics.", false],

  // Employees & Lifecycle
  ["employee.profile.view", "employees", "profile", "view", "View employee profile details.", false],
  ["employee.profile.create", "employees", "profile", "create", "Create new employee records.", true],
  ["employee.profile.edit", "employees", "profile", "edit", "Edit employee profile details.", true],
  ["employee.profile.delete", "employees", "profile", "delete", "Delete employee records.", true],
  ["employee.status.update", "employees", "status", "update", "Update employee employment status.", true],
  ["employee.document.view", "employees", "document", "view", "View employee documents.", false],
  ["employee.document.upload", "employees", "document", "upload", "Upload employee documents.", false],
  ["employee.document.verify", "employees", "document", "verify", "Verify employee documents.", true],
  ["employee.document.delete", "employees", "document", "delete", "Delete employee documents.", true],
  ["employee.letter.view", "employees", "letter", "view", "View generated employment letters.", false],
  ["employee.letter.generate", "employees", "letter", "generate", "Generate employment offer and experience letters.", true],
  ["employee.exit.initiate", "employees", "exit", "initiate", "Initiate employee exit/resignation workflow.", true],
  ["employee.exit.settle", "employees", "exit", "settle", "Process full and final settlement.", true],
  ["lifecycle.template.manage", "lifecycle", "template", "manage", "Manage onboarding/offboarding templates.", true],
  ["lifecycle.checklist.manage", "lifecycle", "checklist", "manage", "Manage checklist tasks.", false],

  // Attendance & Time
  ["attendance.record.view", "attendance", "record", "view", "View attendance records.", false],
  ["attendance.punch.manual", "attendance", "punch", "manual", "Create manual attendance punches.", true],
  ["attendance.regularize.approve", "attendance", "regularize", "approve", "Approve attendance regularization.", true],
  ["attendance.biometric.sync", "attendance", "biometric", "sync", "Sync biometric device data.", true],

  // Leave & WFH
  ["leave.request.view", "leave", "request", "view", "View leave applications.", false],
  ["leave.request.create", "leave", "request", "create", "Apply for leaves.", false],
  ["leave.request.approve", "leave", "request", "approve", "Approve or reject leave requests.", true],
  ["leave.policy.manage", "leave", "policy", "manage", "Configure leave policies and balances.", true],
  ["wfh.request.view", "wfh", "request", "view", "View WFH requests.", false],
  ["wfh.request.create", "wfh", "request", "create", "Submit WFH requests.", false],
  ["wfh.request.approve", "wfh", "request", "approve", "Approve or reject WFH requests.", true],
  ["wfh.allocation.manage", "wfh", "allocation", "manage", "Configure WFH allowances and quotas.", true],

  // Expenses & Advances
  ["expense.claim.view", "expenses", "claim", "view", "View expense claims.", false],
  ["expense.claim.create", "expenses", "claim", "create", "Submit expense reimbursement claims.", false],
  ["expense.claim.review", "expenses", "claim", "review", "Review and verify expense claims.", true],
  ["expense.claim.approve", "expenses", "claim", "approve", "Approve expense claims and reimbursements.", true],
  ["expense.advance.manage", "expenses", "advance", "manage", "Manage salary advances and deductions.", true],

  // Payroll
  ["payroll.run.view", "payroll", "run", "view", "View payroll runs and payslips.", true],
  ["payroll.run.manage", "payroll", "run", "manage", "Process payroll runs and salary outputs.", true],
  ["payroll.salary.edit", "payroll", "salary", "edit", "Edit employee salary structures.", true],
  ["payroll.payslip.generate", "payroll", "payslip", "generate", "Generate and distribute monthly payslips.", true],

  // CRM
  ["crm.client.view", "crm", "client", "view", "View clients and client summaries.", false],
  ["crm.client.create", "crm", "client", "create", "Create new client records.", true],
  ["crm.client.edit", "crm", "client", "edit", "Edit existing client records.", true],
  ["crm.client.delete", "crm", "client", "delete", "Delete client records.", true],
  ["crm.lead.view", "crm", "lead", "view", "View leads and pipeline records.", false],
  ["crm.lead.create", "crm", "lead", "create", "Create new leads.", false],
  ["crm.lead.edit", "crm", "lead", "edit", "Edit lead records and metadata.", false],
  ["crm.lead.convert", "crm", "lead", "convert", "Convert a lead into an active client.", true],

  // Work Track & Creative Operations
  ["worktrack.settings.view", "worktrack", "settings", "view", "View work track settings.", false],
  ["worktrack.settings.manage", "worktrack", "settings", "manage", "Manage work track settings and configuration.", true],
  ["worktrack.client.view", "worktrack", "client", "view", "View work track clients.", false],
  ["worktrack.client.create", "worktrack", "client", "create", "Create work track clients.", true],
  ["worktrack.client.edit", "worktrack", "client", "edit", "Edit work track client details.", true],
  ["worktrack.client.delete", "worktrack", "client", "delete", "Delete work track clients.", true],
  ["worktrack.task.view", "worktrack", "task", "view", "View work cards and task lists.", false],
  ["worktrack.task.create", "worktrack", "task", "create", "Create new work cards.", false],
  ["worktrack.task.edit", "worktrack", "task", "edit", "Edit work card fields.", false],
  ["worktrack.task.delete", "worktrack", "task", "delete", "Delete work cards.", true],
  ["worktrack.task.assign", "worktrack", "task", "assign", "Assign or reassign work cards.", true],
  ["worktrack.task.status.update", "worktrack", "task", "status.update", "Move work card status during execution.", false],
  ["worktrack.file.upload", "worktrack", "file", "upload", "Upload or attach work files to work cards.", false],
  ["worktrack.file.delete", "worktrack", "file", "delete", "Delete attachments from work cards.", true],
  ["worktrack.comment.create", "worktrack", "comment", "create", "Add comments on work cards.", false],
  ["worktrack.review.review", "worktrack", "review", "review", "Review submitted work before final approval.", true],
  ["worktrack.review.return", "worktrack", "review", "return", "Return work for rework from review stage.", true],
  ["worktrack.review.approve", "worktrack", "review", "approve", "Final approval of reviewed work.", true],
  ["worktrack.review.reject", "worktrack", "review", "reject", "Reject reviewed work.", true],
  ["worktrack.analytics.view", "worktrack", "analytics", "view", "View work track analytics and reports.", false],

  // Specific Vertical Permissions
  ["design.task.view", "design", "task", "view", "View assigned design tasks.", false],
  ["design.task.upload", "design", "task", "upload", "Upload design files and assets.", false],
  ["design.review.submit", "design", "review", "submit", "Submit design work for team lead review.", false],
  ["design.approve", "design", "review", "approve", "Approve design assets for client presentation.", true],

  ["video.task.view", "video", "task", "view", "View assigned video tasks.", false],
  ["video.task.upload", "video", "task", "upload", "Upload video drafts and renders.", false],
  ["video.review.submit", "video", "review", "submit", "Submit video for lead review.", false],
  ["video.approve", "video", "review", "approve", "Approve video edits and final cut.", true],

  ["seo.ranking.view", "seo", "ranking", "view", "View SEO ranking sheets.", false],
  ["seo.ranking.edit", "seo", "ranking", "edit", "Edit SEO keyword ranking sheets.", false],
  ["seo.backlink.view", "seo", "backlink", "view", "View backlink sheets.", false],
  ["seo.backlink.edit", "seo", "backlink", "edit", "Edit backlink sheets.", false],
  ["seo.report.view", "seo", "report", "view", "View SEO client audit and progress reports.", false],

  ["performance.campaign.view", "performance", "campaign", "view", "View ad campaigns.", false],
  ["performance.campaign.manage", "performance", "campaign", "manage", "Manage ad budgets and campaign setups.", true],
  ["performance.report.export", "performance", "report", "export", "Export ad performance reports.", false],

  ["dev.task.view", "dev", "task", "view", "View development issues and sprints.", false],
  ["dev.task.manage", "dev", "task", "manage", "Manage tasks and sprint backlog.", false],
  ["dev.pr.review", "dev", "pr", "review", "Review code PRs and test builds.", true],
  ["dev.deploy.approve", "dev", "deploy", "approve", "Approve releases and deployments.", true],

  // Performance Appraisals & Goals
  ["performance.cycle.manage", "performance", "cycle", "manage", "Manage appraisal cycles.", true],
  ["performance.kra.manage", "performance", "kra", "manage", "Manage KRAs and KPIs.", true],
  ["performance.goal.manage", "performance", "goal", "manage", "Set and update performance goals.", false],
  ["performance.appraisal.review", "performance", "appraisal", "review", "Conduct appraisal reviews.", true],
  ["performance.appraisal.approve", "performance", "appraisal", "approve", "Approve appraisal ratings.", true],

  // Recruitment
  ["recruitment.job.manage", "recruitment", "job", "manage", "Manage job postings and descriptions.", true],
  ["recruitment.applicant.view", "recruitment", "applicant", "view", "View job applicants and resumes.", false],
  ["recruitment.applicant.evaluate", "recruitment", "applicant", "evaluate", "Rate and evaluate candidate interviews.", true],
  ["recruitment.offer.create", "recruitment", "offer", "create", "Draft employment offers.", true],

  // Reports
  ["reports.module.view", "reports", "module", "view", "View reports module.", false],
  ["reports.attendance.export", "reports", "attendance", "export", "Export attendance summary reports.", false],
  ["reports.payroll.export", "reports", "payroll", "export", "Export payroll summaries.", true],
  ["reports.worktrack.export", "reports", "worktrack", "export", "Export work track analytics.", false],

  // Notifications
  ["notifications.send", "notifications", "message", "send", "Send broadcast and manual notifications.", true]
] as const;

const accessProfilesSeed = [
  // Platform
  { code: "platform-owner", name: "Platform Owner", category: "Platform", description: "Full cross-platform administrative access.", isSystem: true },
  { code: "company-admin", name: "Company Admin", category: "Platform", description: "Full operational and company-wide access.", isSystem: true },

  // HR
  { code: "hr-head", name: "HR Head", category: "HR", description: "Head of HR with full employee, payroll, and appraisal authority.", isSystem: true },
  { code: "hr-operations", name: "HR Operations", category: "HR", description: "HR generalist for daily attendance, leave, and records.", isSystem: true },

  // Finance
  { code: "finance-operations", name: "Finance Operations", category: "Finance", description: "Expense claim reviews and payroll preparation.", isSystem: true },
  { code: "finance-approver", name: "Finance Approver", category: "Finance", description: "Final financial approval for expenses, advances, and payroll.", isSystem: true },

  // Management
  { code: "department-manager", name: "Department Manager", category: "Management", description: "Department-wide visibility, assignments, and approvals.", isSystem: true },
  { code: "team-lead", name: "Team Lead", category: "Management", description: "Team-level work distribution and quality review.", isSystem: true },
  { code: "project-coordinator", name: "Project Coordinator", category: "Management", description: "Assigned client liaison, project tracking, and approval authority.", isSystem: true },

  // Creative
  { code: "designer", name: "Designer", category: "Creative", description: "Creative design task execution and asset upload.", isSystem: true },
  { code: "design-lead", name: "Design Lead", category: "Creative", description: "Design department review, assignment, and approval.", isSystem: true },
  { code: "video-editor", name: "Video Editor", category: "Creative", description: "Video editing and animation task execution.", isSystem: true },
  { code: "video-lead", name: "Video Lead", category: "Creative", description: "Video department quality review and assignment.", isSystem: true },

  // Marketing
  { code: "seo-specialist", name: "SEO Specialist", category: "Marketing", description: "Keyword ranking and backlink management for assigned clients.", isSystem: true },
  { code: "seo-lead", name: "SEO Lead", category: "Marketing", description: "SEO strategy, review, and client reports oversight.", isSystem: true },
  { code: "performance-marketer", name: "Performance Marketer", category: "Marketing", description: "Paid ad campaigns and lead management.", isSystem: true },
  { code: "performance-lead", name: "Performance Lead", category: "Marketing", description: "Ad strategy, campaign approvals, and analytics.", isSystem: true },

  // Development
  { code: "developer", name: "Developer", category: "Development", description: "Software development and sprint task execution.", isSystem: true },
  { code: "developer-lead", name: "Developer Lead", category: "Development", description: "Code review, architecture oversight, and deployments.", isSystem: true },

  // Operations & Data Entry
  { code: "data-entry-operator", name: "Data Entry Operator", category: "Operations", description: "Data entry and catalog task execution.", isSystem: true },
  { code: "data-entry-lead", name: "Data Entry Lead", category: "Operations", description: "Data entry quality review and task assignment.", isSystem: true },

  // Sales
  { code: "sales-operator", name: "Sales Operator", category: "Sales", description: "Lead qualification and CRM pipeline management.", isSystem: true },
  { code: "sales-lead", name: "Sales Lead", category: "Sales", description: "Deal approvals, team quotas, and client conversion.", isSystem: true },
  { code: "client-success-manager", name: "Client Success Manager", category: "Sales", description: "Client relationship and delivery coordination.", isSystem: true },

  // Base
  { code: "employee-basic", name: "Employee Basic", category: "Base", description: "Default self-service employee access.", isSystem: true }
] as const;

const profilePermissionMap: Record<string, Array<{ code: string; effect?: "ALLOW" | "DENY"; scopes?: string[] }>> = {
  "platform-owner": permissionSeeds.map(([code]) => ({ code, scopes: ["GLOBAL"] })),
  "company-admin": permissionSeeds.map(([code]) => ({ code, scopes: ["COMPANY"] })),

  "hr-head": [
    "dashboard.summary.view","employee.profile.view","employee.profile.create","employee.profile.edit","employee.profile.delete","employee.status.update","employee.document.view","employee.document.upload","employee.document.verify","employee.document.delete","employee.letter.view","employee.letter.generate","employee.exit.initiate","employee.exit.settle","attendance.record.view","attendance.punch.manual","attendance.regularize.approve","attendance.biometric.sync","leave.request.view","leave.request.approve","leave.policy.manage","wfh.request.view","wfh.request.approve","wfh.allocation.manage","expense.claim.view","expense.claim.approve","expense.advance.manage","payroll.run.view","payroll.run.manage","payroll.salary.edit","payroll.payslip.generate","performance.cycle.manage","performance.kra.manage","performance.appraisal.review","performance.appraisal.approve","recruitment.job.manage","recruitment.applicant.view","recruitment.applicant.evaluate","recruitment.offer.create","reports.module.view","reports.attendance.export","reports.payroll.export","notifications.send"
  ].map((code) => ({ code, scopes: ["COMPANY"] })),

  "hr-operations": [
    "dashboard.summary.view","employee.profile.view","employee.profile.create","employee.profile.edit","employee.document.view","employee.document.upload","employee.document.verify","employee.letter.view","employee.letter.generate","attendance.record.view","attendance.punch.manual","leave.request.view","leave.request.approve","wfh.request.view","wfh.request.approve","expense.claim.view","recruitment.applicant.view","reports.module.view","reports.attendance.export"
  ].map((code) => ({ code, scopes: ["COMPANY"] })),

  "finance-operations": [
    "dashboard.summary.view","expense.claim.view","expense.claim.create","expense.claim.review","payroll.run.view","reports.payroll.export"
  ].map((code) => ({ code, scopes: ["COMPANY"] })),

  "finance-approver": [
    "dashboard.summary.view","expense.claim.view","expense.claim.approve","expense.advance.manage","payroll.run.view","payroll.run.manage","payroll.salary.edit","payroll.payslip.generate","reports.payroll.export"
  ].map((code) => ({ code, scopes: ["COMPANY"] })),

  "department-manager": [
    { code: "dashboard.summary.view", scopes: ["DEPARTMENT"] },
    { code: "employee.profile.view", scopes: ["DEPARTMENT"] },
    { code: "attendance.record.view", scopes: ["DEPARTMENT"] },
    { code: "leave.request.view", scopes: ["DEPARTMENT"] },
    { code: "leave.request.approve", scopes: ["DEPARTMENT"] },
    { code: "wfh.request.view", scopes: ["DEPARTMENT"] },
    { code: "wfh.request.approve", scopes: ["DEPARTMENT"] },
    { code: "expense.claim.view", scopes: ["DEPARTMENT"] },
    { code: "expense.claim.review", scopes: ["DEPARTMENT"] },
    { code: "worktrack.task.view", scopes: ["DEPARTMENT"] },
    { code: "worktrack.task.create", scopes: ["DEPARTMENT"] },
    { code: "worktrack.task.assign", scopes: ["DEPARTMENT"] },
    { code: "worktrack.review.review", scopes: ["DEPARTMENT"] },
    { code: "worktrack.review.approve", scopes: ["DEPARTMENT"] },
    { code: "performance.appraisal.review", scopes: ["DEPARTMENT"] },
    { code: "reports.module.view", scopes: ["DEPARTMENT"] }
  ],

  "team-lead": [
    { code: "worktrack.task.view", scopes: ["TEAM"] },
    { code: "worktrack.task.create", scopes: ["TEAM"] },
    { code: "worktrack.task.assign", scopes: ["TEAM"] },
    { code: "worktrack.review.review", scopes: ["TEAM"] },
    { code: "worktrack.review.return", scopes: ["TEAM"] }
  ],

  "project-coordinator": [
    { code: "crm.client.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.client.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.task.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.task.create", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.task.assign", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.review.approve", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.review.reject", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.analytics.view", scopes: ["ASSIGNED_CLIENTS"] }
  ],

  "designer": [
    { code: "worktrack.task.view", scopes: ["ASSIGNED_TO_ME"] },
    { code: "worktrack.task.status.update", scopes: ["ASSIGNED_TO_ME"] },
    { code: "worktrack.file.upload", scopes: ["ASSIGNED_TO_ME"] },
    { code: "worktrack.comment.create", scopes: ["ASSIGNED_TO_ME"] },
    { code: "design.task.view", scopes: ["ASSIGNED_TO_ME"] },
    { code: "design.task.upload", scopes: ["ASSIGNED_TO_ME"] },
    { code: "design.review.submit", scopes: ["ASSIGNED_TO_ME"] }
  ],

  "design-lead": [
    { code: "worktrack.task.view", scopes: ["DEPARTMENT"] },
    { code: "worktrack.task.create", scopes: ["DEPARTMENT"] },
    { code: "worktrack.task.assign", scopes: ["DEPARTMENT"] },
    { code: "worktrack.review.review", scopes: ["DEPARTMENT"] },
    { code: "worktrack.review.return", scopes: ["DEPARTMENT"] },
    { code: "design.task.view", scopes: ["DEPARTMENT"] },
    { code: "design.approve", scopes: ["DEPARTMENT"] }
  ],

  "video-editor": [
    { code: "worktrack.task.view", scopes: ["ASSIGNED_TO_ME"] },
    { code: "worktrack.task.status.update", scopes: ["ASSIGNED_TO_ME"] },
    { code: "worktrack.file.upload", scopes: ["ASSIGNED_TO_ME"] },
    { code: "worktrack.comment.create", scopes: ["ASSIGNED_TO_ME"] },
    { code: "video.task.view", scopes: ["ASSIGNED_TO_ME"] },
    { code: "video.task.upload", scopes: ["ASSIGNED_TO_ME"] },
    { code: "video.review.submit", scopes: ["ASSIGNED_TO_ME"] }
  ],

  "video-lead": [
    { code: "worktrack.task.view", scopes: ["DEPARTMENT"] },
    { code: "worktrack.task.create", scopes: ["DEPARTMENT"] },
    { code: "worktrack.task.assign", scopes: ["DEPARTMENT"] },
    { code: "worktrack.review.review", scopes: ["DEPARTMENT"] },
    { code: "worktrack.review.return", scopes: ["DEPARTMENT"] },
    { code: "video.task.view", scopes: ["DEPARTMENT"] },
    { code: "video.approve", scopes: ["DEPARTMENT"] }
  ],

  "seo-specialist": [
    { code: "crm.client.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "seo.ranking.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "seo.ranking.edit", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "seo.backlink.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "seo.backlink.edit", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "seo.report.view", scopes: ["ASSIGNED_CLIENTS"] }
  ],

  "seo-lead": [
    { code: "crm.client.view", scopes: ["DEPARTMENT"] },
    { code: "seo.ranking.view", scopes: ["DEPARTMENT"] },
    { code: "seo.ranking.edit", scopes: ["DEPARTMENT"] },
    { code: "seo.backlink.view", scopes: ["DEPARTMENT"] },
    { code: "seo.backlink.edit", scopes: ["DEPARTMENT"] },
    { code: "seo.report.view", scopes: ["DEPARTMENT"] },
    { code: "worktrack.review.approve", scopes: ["DEPARTMENT"] }
  ],

  "performance-marketer": [
    { code: "crm.client.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "performance.campaign.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "performance.campaign.manage", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.task.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.task.status.update", scopes: ["ASSIGNED_CLIENTS"] }
  ],

  "performance-lead": [
    { code: "crm.client.view", scopes: ["DEPARTMENT"] },
    { code: "performance.campaign.view", scopes: ["DEPARTMENT"] },
    { code: "performance.campaign.manage", scopes: ["DEPARTMENT"] },
    { code: "performance.report.export", scopes: ["DEPARTMENT"] },
    { code: "worktrack.review.approve", scopes: ["DEPARTMENT"] }
  ],

  "developer": [
    { code: "worktrack.task.view", scopes: ["ASSIGNED_TO_ME"] },
    { code: "worktrack.task.status.update", scopes: ["ASSIGNED_TO_ME"] },
    { code: "dev.task.view", scopes: ["ASSIGNED_TO_ME"] }
  ],

  "developer-lead": [
    { code: "worktrack.task.view", scopes: ["DEPARTMENT"] },
    { code: "worktrack.task.assign", scopes: ["DEPARTMENT"] },
    { code: "dev.task.view", scopes: ["DEPARTMENT"] },
    { code: "dev.task.manage", scopes: ["DEPARTMENT"] },
    { code: "dev.pr.review", scopes: ["DEPARTMENT"] },
    { code: "dev.deploy.approve", scopes: ["DEPARTMENT"] }
  ],

  "data-entry-operator": [
    { code: "worktrack.task.view", scopes: ["ASSIGNED_TO_ME"] },
    { code: "worktrack.task.status.update", scopes: ["ASSIGNED_TO_ME"] },
    { code: "worktrack.comment.create", scopes: ["ASSIGNED_TO_ME"] }
  ],

  "data-entry-lead": [
    { code: "worktrack.task.view", scopes: ["DEPARTMENT"] },
    { code: "worktrack.task.assign", scopes: ["DEPARTMENT"] },
    { code: "worktrack.review.review", scopes: ["DEPARTMENT"] }
  ],

  "sales-operator": [
    { code: "crm.client.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "crm.lead.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "crm.lead.create", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "crm.lead.edit", scopes: ["ASSIGNED_CLIENTS"] }
  ],

  "sales-lead": [
    { code: "crm.client.view", scopes: ["DEPARTMENT"] },
    { code: "crm.client.create", scopes: ["DEPARTMENT"] },
    { code: "crm.client.edit", scopes: ["DEPARTMENT"] },
    { code: "crm.lead.view", scopes: ["DEPARTMENT"] },
    { code: "crm.lead.create", scopes: ["DEPARTMENT"] },
    { code: "crm.lead.edit", scopes: ["DEPARTMENT"] },
    { code: "crm.lead.convert", scopes: ["DEPARTMENT"] }
  ],

  "client-success-manager": [
    { code: "crm.client.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "crm.client.edit", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.client.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.task.view", scopes: ["ASSIGNED_CLIENTS"] },
    { code: "worktrack.analytics.view", scopes: ["ASSIGNED_CLIENTS"] }
  ],

  "employee-basic": [
    { code: "dashboard.summary.view", scopes: ["SELF"] },
    { code: "employee.profile.view", scopes: ["SELF"] },
    { code: "attendance.record.view", scopes: ["SELF"] },
    { code: "leave.request.view", scopes: ["SELF"] },
    { code: "leave.request.create", scopes: ["SELF"] },
    { code: "wfh.request.view", scopes: ["SELF"] },
    { code: "wfh.request.create", scopes: ["SELF"] },
    { code: "expense.claim.view", scopes: ["SELF"] },
    { code: "expense.claim.create", scopes: ["SELF"] }
  ]
};

const roleToProfileCodes: Record<Role, string[]> = {
  SUPER_ADMIN: ["platform-owner"],
  HR_ADMIN: ["hr-operations", "company-admin"],
  MANAGER: ["department-manager"],
  EMPLOYEE: ["employee-basic"]
};

async function main() {
  console.log("Cleaning up existing database records...");

  // Truncate all tables with CASCADE to handle foreign keys properly
  const tables = [
    "Salary", "EmployeeDocument", "EmployeeLetter", "Attendance", "WFHRequest",
    "ExpenseClaim", "ReworkLog", "Rating", "Comment", "PointsLedger",
    "StatusHistory", "WorkCard", "Client", "SpecialDay", "Payslip",
    "PayrollRun", "AuditLog", "Notification", "WorkTrackSetting", "Employee",
    "User", "Designation", "Department", "Company", "CompanySetting",
    "Office", "BiometricRawLog", "Shift", "AppraisalCycle", "KRA",
    "Goal", "Appraisal", "LifecycleTemplate", "LifecycleTemplateTask",
    "EmployeeChecklist", "EmployeeChecklistItem", "EmployeeAdvance",
    "LeaveAllocation", "JobOpening", "JobApplicant"
  ];
  for (const table of tables) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch (e) {
      console.warn(`Could not truncate table ${table}:`, e);
    }
  }

  console.log("Clean up completed successfully.");

  // 1. Create seed company
  const company = await prisma.company.create({
    data: {
      id: "seed-company",
      name: "Second Tales EMS",
      legalName: "Second Tales EMS LLC"
    }
  });
  console.log(`Created Company: ${company.name}`);

  // Helper arrays of employee details (3 Designers, 3 Project Coordinators, 3 Core Team)
  const employeeDetails = [
    // ─── 3 CORE TEAM ───
    {
      code: "ST001",
      firstName: "Fuhad Saneen",
      lastName: "P K",
      email: "hr@example.com", // Default login email
      role: Role.SUPER_ADMIN,
      deptCode: "CORE",
      deptName: "Core Team",
      title: "Core Team",
      gender: "Male",
      phone: "15551234567"
    },
    {
      code: "ST003",
      firstName: "Nithin",
      lastName: "Bhaskar",
      email: "nithin@secondtales.com",
      role: Role.MANAGER,
      deptCode: "CORE",
      deptName: "Core Team",
      title: "Core Team",
      gender: "Male",
      phone: "15551234569"
    },
    {
      code: "ST004",
      firstName: "Muhammed Rashid",
      lastName: "AK",
      email: "rashid@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "CORE",
      deptName: "Core Team",
      title: "Core Team",
      gender: "Male",
      phone: "15551234570"
    },

    // ─── 1. DESIGN TEAM (2 Members) ───
    {
      code: "ST002",
      firstName: "Hashim",
      lastName: "VP",
      email: "hashim@secondtales.com",
      role: Role.MANAGER,
      deptCode: "DESIGN",
      deptName: "Design Team",
      title: "Designer",
      gender: "Male",
      phone: "15551234568"
    },
    {
      code: "ST006",
      firstName: "Muhammed",
      lastName: "Swadique",
      email: "swadique@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "DESIGN",
      deptName: "Design Team",
      title: "Designer",
      gender: "Male",
      phone: "15551234572"
    },

    // ─── 2. VIDEO EDITING TEAM (2 Members) ───
    {
      code: "ST011",
      firstName: "Rahul",
      lastName: "Krishna",
      email: "rahul@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "VIDEO",
      deptName: "Video Editing",
      title: "Video Editor",
      gender: "Male",
      phone: "15551234581"
    },
    {
      code: "ST012",
      firstName: "Anjali",
      lastName: "Menon",
      email: "anjali@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "VIDEO",
      deptName: "Video Editing",
      title: "Motion Graphic Artist",
      gender: "Female",
      phone: "15551234582"
    },

    // ─── 3. SEO TEAM (2 Members) ───
    {
      code: "ST013",
      firstName: "Akhil",
      lastName: "Ramesh",
      email: "akhil@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "SEO",
      deptName: "SEO",
      title: "SEO Analyst",
      gender: "Male",
      phone: "15551234583"
    },
    {
      code: "ST014",
      firstName: "Sneha",
      lastName: "Nair",
      email: "sneha@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "SEO",
      deptName: "SEO",
      title: "SEO Specialist",
      gender: "Female",
      phone: "15551234584"
    },

    // ─── 4. PERFORMANCE MARKETING (2 Members) ───
    {
      code: "ST015",
      firstName: "Vivek",
      lastName: "Sharma",
      email: "vivek@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "PERF_MKT",
      deptName: "Performance Marketing",
      title: "Ads Campaign Manager",
      gender: "Male",
      phone: "15551234585"
    },
    {
      code: "ST016",
      firstName: "Pooja",
      lastName: "Hegde",
      email: "pooja@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "PERF_MKT",
      deptName: "Performance Marketing",
      title: "Performance Marketer",
      gender: "Female",
      phone: "15551234586"
    },

    // ─── 5. DEVELOPMENT TEAM (2 Members) ───
    {
      code: "ST017",
      firstName: "Arjun",
      lastName: "Pillai",
      email: "arjun@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "DEV",
      deptName: "Development",
      title: "Full Stack Developer",
      gender: "Male",
      phone: "15551234587"
    },
    {
      code: "ST018",
      firstName: "Meera",
      lastName: "Thomas",
      email: "meera@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "DEV",
      deptName: "Development",
      title: "Frontend Engineer",
      gender: "Female",
      phone: "15551234588"
    },

    // ─── 6. DATA ENTRY TEAM (2 Members) ───
    {
      code: "ST005",
      firstName: "Fathima",
      lastName: "Sherin",
      email: "fathima@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "DATA",
      deptName: "Data Entry",
      title: "Data Entry Specialist",
      gender: "Female",
      phone: "15551234571"
    },
    {
      code: "ST019",
      firstName: "Deepak",
      lastName: "Kumar",
      email: "deepak@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "DATA",
      deptName: "Data Entry",
      title: "Data Entry Operator",
      gender: "Male",
      phone: "15551234589"
    },

    // ─── PROJECT COORDINATORS ───
    {
      code: "ST007",
      firstName: "Salahudeen Ayoobi",
      lastName: "C M",
      email: "salahudeen@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "COORD",
      deptName: "Project Coordination",
      title: "Project Coordinator",
      gender: "Male",
      phone: "15551234573"
    },
    {
      code: "ST008",
      firstName: "Shoukath Shabeeth",
      lastName: "K",
      email: "shoukath@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "COORD",
      deptName: "Project Coordination",
      title: "Project Coordinator",
      gender: "Male",
      phone: "15551234574"
    },
    {
      code: "ST010",
      firstName: "Naseeha",
      lastName: "-",
      email: "naseeha@secondtales.com",
      role: Role.EMPLOYEE,
      deptCode: "COORD",
      deptName: "Project Coordination",
      title: "Project Coordinator",
      gender: "Female",
      phone: "15551234576"
    }
  ];

  const passwordHash = await bcrypt.hash("Password123!", 12);
  const createdEmployees: any[] = [];

  // Seed employees in sequence
  for (const item of employeeDetails) {
    // 2. Create or find department
    const department = await prisma.department.upsert({
      where: { companyId_code: { companyId: company.id, code: item.deptCode } },
      update: {},
      create: { companyId: company.id, code: item.deptCode, name: item.deptName }
    });

    // 3. Create or find designation
    let designation = await prisma.designation.findFirst({
      where: { departmentId: department.id, title: item.title }
    });
    if (!designation) {
      designation = await prisma.designation.create({
        data: { departmentId: department.id, title: item.title }
      });
    }

    // 4. Create user account
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        email: item.email,
        passwordHash,
        role: item.role
      }
    });

    // 5. Create employee profile
    const employee = await prisma.employee.create({
      data: {
        companyId: company.id,
        userId: user.id,
        employeeCode: item.code,
        firstName: item.firstName,
        lastName: item.lastName,
        phone: item.phone,
        personalEmail: item.email,
        gender: item.gender,
        dateOfJoining: new Date("2026-06-08"),
        departmentId: department.id,
        designationId: designation.id,
        salary: {
          create: {
            basic: 8000,
            allowances: 1500,
            deductions: 500,
            effectiveFrom: new Date("2026-06-08")
          }
        }
      }
    });

    createdEmployees.push(employee);
    console.log(`Seeded employee: ${item.firstName} ${item.lastName} [${item.code}]`);
  }

  // 6. Set Manager Relations (ST001 as manager for all others)
  const managerEmployee = createdEmployees.find(e => e.employeeCode === "ST001");
  if (managerEmployee) {
    for (const employee of createdEmployees) {
      if (employee.employeeCode !== "ST001") {
        await prisma.employee.update({
          where: { id: employee.id },
          data: { managerId: managerEmployee.id }
        });
      }
    }
    console.log("Set ST001 (Fuhad Saneen P K) as manager for all other employees.");
  }

  // 7. Seed dummy clients matching Figma Site data
  console.log("\nSeeding dummy clients...");
  const dummyClientsData = [
    {
      name: "Clearpath Logistics",
      details: "Logistics · UAE & GCC",
      contacts: "John Doe (john@clearpath.com)",
      packageName: "Enterprise Growth Plan",
      postersCommitted: 24,
      videoSeo: "Full channel optimization & weekly upload",
      digitalMarketingActivities: "Google Ads: $1000/mo spend, monthly SEO audit"
    },
    {
      name: "Solstice Studios",
      details: "Media & Entertainment",
      contacts: "Alice Rivera (alice@solstice.com)",
      packageName: "Premium Branding",
      postersCommitted: 12,
      videoSeo: "YouTube SEO optimization",
      digitalMarketingActivities: "Facebook & Instagram Reels campaign"
    },
    {
      name: "Apex Ventures",
      details: "Finance & Venture Capital",
      contacts: "Bob Vance (bob@apex.vc)",
      packageName: "Standard Package",
      postersCommitted: 8,
      videoSeo: "None",
      digitalMarketingActivities: "LinkedIn lead generation campaign"
    },
    {
      name: "NovaBrands Co.",
      details: "E-commerce & Retail",
      contacts: "Jessica Taylor (jessica@novabrands.co)",
      packageName: "Growth Package",
      postersCommitted: 16,
      videoSeo: "TikTok video SEO & tags optimization",
      digitalMarketingActivities: "Google shopping ads, influencer marketing"
    },
    {
      name: "Meridian Health",
      details: "Healthcare & Wellness",
      contacts: "David Kim (david@meridian.com)",
      packageName: "Starter Pack",
      postersCommitted: 6,
      videoSeo: "Basic channel setup",
      digitalMarketingActivities: "SEO blog writing, local business listings"
    },
    {
      name: "Pinnacle Group",
      details: "Real Estate & Development",
      contacts: "Sarah Connor (sarah@pinnacle.com)",
      packageName: "Custom Branding",
      postersCommitted: 20,
      videoSeo: "Full channel optimization",
      digitalMarketingActivities: "Virtual tour production, local SEO"
    }
  ];

  const seededClients = [];
  for (const clientItem of dummyClientsData) {
    const client = await prisma.client.create({
      data: {
        companyId: "seed-company",
        name: clientItem.name,
        details: clientItem.details,
        contacts: clientItem.contacts,
        packageName: clientItem.packageName,
        postersCommitted: clientItem.postersCommitted,
        videoSeo: clientItem.videoSeo,
        digitalMarketingActivities: clientItem.digitalMarketingActivities,
        accountManagerId: managerEmployee ? managerEmployee.id : undefined
      }
    });
    seededClients.push(client);
    console.log(`Seeded client: ${client.name}`);
  }

  // 8. Seed dummy work cards matching Figma Site deadlines
  console.log("\nSeeding dummy work cards...");
  const dummyWorkCardsData = [
    {
      title: "Website Redesign Approval",
      brief: "Review and approve the new website layout mockups and responsive designs.",
      category: "Website",
      priority: "HIGH",
      complexity: "MEDIUM",
      deadline: "2026-08-13",
      status: "PENDING",
      clientName: "Clearpath Logistics"
    },
    {
      title: "TikTok Reel Edit",
      brief: "Edit 3 promotional videos for the upcoming winter campaign.",
      category: "Video",
      priority: "CRITICAL",
      complexity: "COMPLEX",
      deadline: "2026-08-16",
      status: "IN_PROGRESS",
      clientName: "Solstice Studios"
    },
    {
      title: "Google Ads Campaign Setup",
      brief: "Initialize keywords research and set up ad groups for finance services search ads.",
      category: "SEO",
      priority: "NORMAL",
      complexity: "SIMPLE",
      deadline: "2026-08-17",
      status: "FINISHED",
      clientName: "Apex Ventures"
    },
    {
      title: "Brand Identity Deck",
      brief: "Create style guides, color palettes, and presentation deck for pitch meetings.",
      category: "Poster",
      priority: "NORMAL",
      complexity: "MEDIUM",
      deadline: "2026-08-18",
      status: "OUT_TO_DELIVER",
      clientName: "Apex Ventures"
    },
    {
      title: "Instagram Campaign Kit",
      brief: "Design 5 launch posters for e-commerce products.",
      category: "Poster",
      priority: "LOW",
      complexity: "SIMPLE",
      deadline: "2026-08-20",
      status: "APPROVED",
      clientName: "NovaBrands Co."
    }
  ];

  for (const cardItem of dummyWorkCardsData) {
    const clientObj = seededClients.find(c => c.name === cardItem.clientName);
    if (clientObj) {
      const card = await prisma.workCard.create({
        data: {
          companyId: "seed-company",
          clientId: clientObj.id,
          workId: `W-${Math.floor(1000 + Math.random() * 9000)}`,
          title: cardItem.title,
          brief: cardItem.brief,
          category: cardItem.category,
          priority: cardItem.priority,
          complexity: cardItem.complexity,
          deadline: new Date(cardItem.deadline),
          status: cardItem.status,
          assignedById: managerEmployee ? managerEmployee.id : undefined,
          assignedToId: managerEmployee ? managerEmployee.id : undefined
        }
      });
      console.log(`Seeded work card: ${card.title} (${card.workId})`);
    }
  }

  console.log("\nSeeding authority scopes, permissions, access profiles, and workflow...");

  for (const scope of scopeSeeds) {
    await prisma.accessScope.upsert({
      where: { code: scope.code as any },
      update: { name: scope.name, description: scope.description },
      create: { code: scope.code as any, name: scope.name, description: scope.description }
    });
  }

  const permissionMap = new Map<string, string>();
  for (const [code, module, feature, action, description, isSensitive] of permissionSeeds) {
    const permission = await prisma.permission.upsert({
      where: { code },
      update: { module, feature, action, description, isSensitive },
      create: { code, module, feature, action, description, isSensitive }
    });
    permissionMap.set(code, permission.id);
  }

  const profileMap = new Map<string, string>();
  for (const profile of accessProfilesSeed) {
    const existing = await prisma.accessProfile.findFirst({
      where: { companyId: null, code: profile.code }
    });
    const saved = existing
      ? await prisma.accessProfile.update({
          where: { id: existing.id },
          data: {
            name: profile.name,
            description: profile.description,
            category: profile.category,
            isSystem: profile.isSystem,
            isActive: true
          }
        })
      : await prisma.accessProfile.create({
          data: {
            code: profile.code,
            name: profile.name,
            description: profile.description,
            category: profile.category,
            isSystem: profile.isSystem,
            isActive: true
          }
        });
    profileMap.set(profile.code, saved.id);
  }

  for (const [profileCode, grants] of Object.entries(profilePermissionMap)) {
    const accessProfileId = profileMap.get(profileCode);
    if (!accessProfileId) continue;

    for (const grant of grants) {
      const permissionId = permissionMap.get(grant.code);
      if (!permissionId) continue;

      const link = await prisma.accessProfilePermission.upsert({
        where: { accessProfileId_permissionId: { accessProfileId, permissionId } },
        update: { effect: (grant.effect || "ALLOW") as any },
        create: {
          accessProfileId,
          permissionId,
          effect: (grant.effect || "ALLOW") as any
        }
      });

      if (grant.scopes?.length) {
        for (const scopeCode of grant.scopes) {
          const existingScope = await prisma.profilePermissionScope.findFirst({
            where: {
              accessProfilePermissionId: link.id,
              scopeType: scopeCode as any
            }
          });
          if (!existingScope) {
            await prisma.profilePermissionScope.create({
              data: {
                accessProfilePermissionId: link.id,
                permissionId,
                scopeType: scopeCode as any
              }
            });
          }
        }
      }
    }
  }

  const designWorkflow = await prisma.approvalWorkflow.upsert({
    where: { companyId_code: { companyId: company.id, code: "design-worktrack" } },
    update: {
      name: "Design Work Track Approval",
      module: "worktrack",
      feature: "design-review",
      description: "Designer -> Design Lead -> Project Coordinator approval workflow.",
      isActive: true
    },
    create: {
      companyId: company.id,
      code: "design-worktrack",
      name: "Design Work Track Approval",
      module: "worktrack",
      feature: "design-review",
      description: "Designer -> Design Lead -> Project Coordinator approval workflow.",
      isActive: true
    }
  });

  const workflowStages = [
    { stageOrder: 1, stageName: "Designer Execution", permissionCode: "worktrack.task.status.update", approverScopeType: "ASSIGNED_TO_ME", isFinal: false, canReturn: false, canReject: false },
    { stageOrder: 2, stageName: "Design Lead Review", permissionCode: "worktrack.review.review", approverScopeType: "DEPARTMENT", isFinal: false, canReturn: true, canReject: true },
    { stageOrder: 3, stageName: "Coordinator Approval", permissionCode: "worktrack.review.approve", approverScopeType: "ASSIGNED_CLIENTS", isFinal: true, canReturn: true, canReject: true, finalStatus: "APPROVED" }
  ];

  for (const stage of workflowStages) {
    await prisma.approvalWorkflowStage.upsert({
      where: { workflowId_stageOrder: { workflowId: designWorkflow.id, stageOrder: stage.stageOrder } },
      update: {
        stageName: stage.stageName,
        requiredPermissionId: permissionMap.get(stage.permissionCode),
        approverScopeType: stage.approverScopeType as any,
        isFinal: stage.isFinal,
        canReturn: stage.canReturn,
        canReject: stage.canReject,
        finalStatus: stage.finalStatus || null
      },
      create: {
        workflowId: designWorkflow.id,
        stageOrder: stage.stageOrder,
        stageName: stage.stageName,
        requiredPermissionId: permissionMap.get(stage.permissionCode),
        approverScopeType: stage.approverScopeType as any,
        isFinal: stage.isFinal,
        canReturn: stage.canReturn,
        canReject: stage.canReject,
        finalStatus: stage.finalStatus || null
      }
    });
  }

  const seededUsers = await prisma.user.findMany();
  for (const user of seededUsers) {
    for (const profileCode of roleToProfileCodes[user.role] || []) {
      const accessProfileId = profileMap.get(profileCode);
      if (!accessProfileId) continue;

      const existingAssignment = await prisma.userAccessProfile.findFirst({
        where: {
          userId: user.id,
          accessProfileId,
          isActive: true
        }
      });

      if (!existingAssignment) {
        await prisma.userAccessProfile.create({
          data: {
            userId: user.id,
            accessProfileId,
            assignedById: managerEmployee?.userId || user.id,
            isActive: true
          }
        });
      }
    }
  }

  console.log("\nDatabase seeding completed successfully!");
  console.log("Default admin login: hr@example.com / Password123!");
}

main().finally(() => prisma.$disconnect());
