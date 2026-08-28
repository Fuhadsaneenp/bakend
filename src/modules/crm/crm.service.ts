import { prisma } from "../../lib/prisma.js";

const CRM_DATA_SETTING_KEY = "crm_shared_workspace_data_v1";

const DEFAULT_INITIAL_CRM_CLIENTS = [
  {
    id: 101,
    leadId: 201,
    company: "Adept",
    contact: "Mohammed Ali",
    phone: "+91 98470 12345",
    email: "contact@adept.in",
    industry: "Marketing & Creative",
    location: "Kerala, India",
    services: ["Creative Posters", "Editing"],
    value: 15000,
    paymentStatus: "Pending",
    manager: "Fathima Sherin PT",
    team: ["Fathima Sherin PT", "Muhammed Swadique Kozhikkoden", "Salahudeen Ayoobi CM"],
    status: "Active",
    startDate: "2026-08-01",
    onboardingProgress: 100,
    postersCommitted: 6,
    videoSeo: "2 Videos",
    onboardingChecklist: [
      { label: "Brief & assets received", done: true },
      { label: "Editing workflows aligned", done: true }
    ],
    projects: [
      {
        name: "Creative Posters & Video Editing",
        service: "Design & Video",
        progress: 50,
        deadline: "2026-08-31",
        status: "In Progress"
      }
    ],
    documents: [],
    history: [
      { date: "2026-08-01", type: "Note", note: "Account active with Fathima Sherin PT." }
    ]
  },
  {
    id: 102,
    leadId: 202,
    company: "Spencer Mobiles",
    contact: "Jamshi",
    phone: "+91 98950 54321",
    email: "contact@spencermobiles.com",
    industry: "Retail / Mobiles",
    location: "Kerala, India",
    services: ["Creative Posters", "Video"],
    value: 18000,
    paymentStatus: "Pending",
    manager: "Fathima Sherin PT",
    team: ["Fathima Sherin PT", "Muhammed Shamil PT", "Asif Ameen MP"],
    status: "Active",
    startDate: "2026-08-01",
    onboardingProgress: 100,
    postersCommitted: 8,
    videoSeo: "4 Videos",
    onboardingChecklist: [
      { label: "Mobile store launch assets scheduled", done: true }
    ],
    projects: [
      {
        name: "Video & Ad Campaigns",
        service: "Video & Social",
        progress: 60,
        deadline: "2026-08-31",
        status: "In Progress"
      }
    ],
    documents: [],
    history: [
      { date: "2026-08-01", type: "Note", note: "Account managed by Fathima Sherin PT." }
    ]
  },
  {
    id: 1,
    leadId: 101,
    company: "SLF",
    contact: "Operations Team",
    phone: "+971 50 123 4567",
    email: "contact@slf.ae",
    industry: "Retail & Brands",
    location: "Dubai, UAE",
    services: ["Creative Posters (3)", "Moment Marketing (1)", "Ad Posters (1)"],
    value: 5000,
    paymentStatus: "Paid",
    manager: "Fuhad",
    team: ["Fuhad", "Muhammed Swadique Kozhikkoden", "Salahudeen Ayoobi CM"],
    status: "Active",
    startDate: "2026-08-01",
    onboardingProgress: 100,
    postersCommitted: 5,
    videoSeo: "0 Videos",
    onboardingChecklist: [
      { label: "Design style guide received", done: true },
      { label: "Creative & Ad deliverables scheduled", done: true }
    ],
    projects: [
      {
        name: "Creative & Ad Posters",
        service: "Design & Video",
        progress: 60,
        deadline: "2026-08-31",
        status: "In Progress"
      }
    ],
    documents: [],
    history: [
      { date: "2026-08-01", type: "Note", note: "Retainer active: 5 deliverables (5 Posters, 0 Videos)." }
    ]
  },
  {
    id: 2,
    leadId: 102,
    company: "Doner Club",
    contact: "Marketing Lead",
    phone: "+971 52 987 6543",
    email: "marketing@donerclub.ae",
    industry: "F&B / Restaurant",
    location: "Dubai, UAE",
    services: ["Creative Posters (4)", "Moment Marketing (2)", "Ad Posters (2)", "Editing (4)"],
    value: 13000,
    paymentStatus: "Paid",
    manager: "Fuhad",
    team: ["Fuhad", "Muhammed Shamil PT", "Asif Ameen MP"],
    status: "Active",
    startDate: "2026-08-01",
    onboardingProgress: 100,
    postersCommitted: 4,
    videoSeo: "9 Videos",
    onboardingChecklist: [
      { label: "Menu & video shoot planned", done: true },
      { label: "Monthly reels schedule locked", done: true }
    ],
    projects: [
      {
        name: "Omnichannel Video & Social Deliverables",
        service: "Design & Video",
        progress: 70,
        deadline: "2026-08-31",
        status: "In Progress"
      }
    ],
    documents: [],
    history: [
      { date: "2026-08-01", type: "Note", note: "Monthly Retainer Active." }
    ]
  },
  {
    id: 3,
    leadId: 103,
    company: "Nizar Hospital",
    contact: "Administration / Dr. Nizar",
    phone: "+91 483 283 0000",
    email: "admin@nizarhospital.com",
    industry: "Healthcare / Hospital",
    location: "Kerala, India",
    services: ["Creative Posters (10)", "Ad Posters (5)", "Video Shooting (2)", "Editing (2)"],
    value: 10000,
    paymentStatus: "Paid",
    manager: "Fuhad",
    team: ["Fuhad", "Muhammed Swadique Kozhikkoden", "Muhammed Shamil PT", "Salahudeen Ayoobi CM"],
    status: "Active",
    startDate: "2026-08-01",
    onboardingProgress: 100,
    postersCommitted: 15,
    videoSeo: "2 Videos",
    onboardingChecklist: [
      { label: "Doctors directory & departments mapped", done: true },
      { label: "Emergency & awareness campaigns active", done: true }
    ],
    projects: [
      {
        name: "Healthcare Awareness & Ad Creative Suite",
        service: "Design & Video",
        progress: 65,
        deadline: "2026-08-31",
        status: "In Progress"
      }
    ],
    documents: [],
    history: [
      { date: "2026-08-01", type: "Note", note: "Hospital awareness monthly deliverables active." }
    ]
  },
  {
    id: 4,
    leadId: 104,
    company: "Salty Fresh",
    contact: "Operations Manager",
    phone: "+91 98470 99887",
    email: "orders@saltyfresh.in",
    industry: "F&B / Seafood Retail",
    location: "Kerala, India",
    services: ["Creative Posters (8)", "Moment Marketing (2)", "Video Shooting (1)", "Editing (1)"],
    value: 7000,
    paymentStatus: "Paid",
    manager: "Fuhad",
    team: ["Fuhad", "Asif Ameen MP", "Salahudeen Ayoobi CM"],
    status: "Active",
    startDate: "2026-08-01",
    onboardingProgress: 100,
    postersCommitted: 10,
    videoSeo: "1 Video",
    onboardingChecklist: [
      { label: "Brand identity assets mapped", done: true },
      { label: "Daily catch promotion templates active", done: true }
    ],
    projects: [
      {
        name: "Daily Promotions & Creative Social Feed",
        service: "Design & Video",
        progress: 55,
        deadline: "2026-08-31",
        status: "In Progress"
      }
    ],
    documents: [],
    history: [
      { date: "2026-08-01", type: "Note", note: "Retail social & ad feed active." }
    ]
  },
  {
    id: 5,
    leadId: 105,
    company: "Turbit",
    contact: "Product Lead",
    phone: "+971 55 443 2211",
    email: "team@turbit.tech",
    industry: "Technology / SaaS",
    location: "Dubai, UAE",
    services: ["Creative Posters (4)", "Video (2)"],
    value: 4000,
    paymentStatus: "Paid",
    manager: "Fuhad",
    team: ["Fuhad", "Muhammed Swadique Kozhikkoden"],
    status: "Active",
    startDate: "2026-08-01",
    onboardingProgress: 100,
    postersCommitted: 4,
    videoSeo: "2 Videos",
    onboardingChecklist: [
      { label: "Feature visual library defined", done: true },
      { label: "Product release announcements scheduled", done: true }
    ],
    projects: [
      {
        name: "Product Highlights & Release Creatives",
        service: "Design & Video",
        progress: 80,
        deadline: "2026-08-31",
        status: "In Progress"
      }
    ],
    documents: [],
    history: [
      { date: "2026-08-01", type: "Note", note: "Tech branding & release campaign active." }
    ]
  }
];

export class CrmService {
  private async getResolvedCompanyId(companyId?: string | null): Promise<string> {
    if (companyId) return companyId;
    const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
    if (company) return company.id;
    const created = await prisma.company.create({
      data: { name: "Second Tales LLP", legalName: "Second Tales LLP" }
    });
    return created.id;
  }

  async getCrmData(companyId?: string | null) {
    const resolvedCompanyId = await this.getResolvedCompanyId(companyId);

    const setting = await prisma.companySetting.findUnique({
      where: {
        companyId_key: {
          companyId: resolvedCompanyId,
          key: CRM_DATA_SETTING_KEY
        }
      }
    });

    if (!setting || !setting.value || typeof setting.value !== "object") {
      const initialData = {
        clients: DEFAULT_INITIAL_CRM_CLIENTS,
        leads: [],
        lastUpdated: new Date().toISOString()
      };

      await prisma.companySetting.upsert({
        where: {
          companyId_key: {
            companyId: resolvedCompanyId,
            key: CRM_DATA_SETTING_KEY
          }
        },
        create: {
          companyId: resolvedCompanyId,
          key: CRM_DATA_SETTING_KEY,
          value: initialData as any
        },
        update: {
          value: initialData as any
        }
      });

      return initialData;
    }

    const val: any = setting.value;
    const clients = Array.isArray(val?.clients) ? val.clients : DEFAULT_INITIAL_CRM_CLIENTS;
    const leads = Array.isArray(val?.leads) ? val.leads : [];

    // Ensure initial default clients are present and sanitized
    const existingCompanyNames = new Set(clients.map((c: any) => String(c?.company || "").toLowerCase().trim()));
    const missingDefaults = DEFAULT_INITIAL_CRM_CLIENTS.filter(
      d => !existingCompanyNames.has(d.company.toLowerCase().trim())
    );

    let finalClients = clients.map((c: any) => {
      // Fix any placeholder manager names
      if (c.manager === "Rahul Mehta") {
        return { ...c, manager: "Fathima Sherin PT" };
      }
      return c;
    });

    if (missingDefaults.length > 0) {
      finalClients = [...missingDefaults, ...finalClients];
      await this.saveCrmData(resolvedCompanyId, { clients: finalClients, leads });
    }

    return {
      clients: finalClients,
      leads,
      lastUpdated: val?.lastUpdated || new Date().toISOString()
    };
  }

  async saveCrmData(companyId: string | null | undefined, data: { clients?: any[]; leads?: any[] }) {
    const resolvedCompanyId = await this.getResolvedCompanyId(companyId);

    const existing = await this.getCrmData(resolvedCompanyId);
    const sanitizedClients = (Array.isArray(data.clients) ? data.clients : existing.clients).map((c: any) => {
      if (c.manager === "Rahul Mehta") {
        return { ...c, manager: "Fathima Sherin PT" };
      }
      return c;
    });

    const updatedData = {
      clients: sanitizedClients,
      leads: Array.isArray(data.leads) ? data.leads : existing.leads,
      lastUpdated: new Date().toISOString()
    };

    await prisma.companySetting.upsert({
      where: {
        companyId_key: {
          companyId: resolvedCompanyId,
          key: CRM_DATA_SETTING_KEY
        }
      },
      create: {
        companyId: resolvedCompanyId,
        key: CRM_DATA_SETTING_KEY,
        value: updatedData as any
      },
      update: {
        value: updatedData as any
      }
    });

    return updatedData;
  }
}

export const crmService = new CrmService();
