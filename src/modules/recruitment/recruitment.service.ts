import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

type JobOpeningInput = {
  departmentId?: string | null;
  hiringManagerId?: string | null;
  title: string;
  employmentType?: string;
  location?: string | null;
  openings?: number;
  status?: string;
  priority?: string;
  description?: string | null;
  targetDate?: Date | null;
};

type ApplicantInput = {
  jobOpeningId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  stage?: string;
  source?: string | null;
  currentCompany?: string | null;
  experienceYears?: number | null;
  rating?: number | null;
  noticePeriodDays?: number | null;
  expectedCompensation?: number | null;
  summary?: string | null;
};

export const recruitmentService = {
  async getSummary(companyId: string) {
    const [openings, applicants, recentApplicants, stageGroups] = await Promise.all([
      prisma.jobOpening.findMany({
        where: { companyId },
        include: {
          department: true,
          hiringManager: true,
          _count: { select: { applicants: true } }
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 6
      }),
      prisma.jobApplicant.count({ where: { companyId } }),
      prisma.jobApplicant.findMany({
        where: { companyId },
        include: {
          jobOpening: { select: { id: true, title: true, status: true } }
        },
        orderBy: { updatedAt: "desc" },
        take: 8
      }),
      prisma.jobApplicant.groupBy({
        by: ["stage"],
        where: { companyId },
        _count: { _all: true }
      })
    ]);

    const totalOpenings = openings.length;
    const openCount = openings.filter((opening) => opening.status === "OPEN").length;
    const closedCount = openings.filter((opening) => opening.status === "CLOSED").length;

    return {
      totalApplicants: applicants,
      totalOpenings,
      openOpenings: openCount,
      closedOpenings: closedCount,
      stageBreakdown: stageGroups.map((group) => ({
        stage: group.stage,
        count: group._count._all
      })),
      openings,
      recentApplicants
    };
  },

  getOpenings(companyId: string) {
    return prisma.jobOpening.findMany({
      where: { companyId },
      include: {
        department: true,
        hiringManager: {
          include: {
            designation: true
          }
        },
        _count: { select: { applicants: true } }
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
    });
  },

  async createOpening(companyId: string, data: JobOpeningInput) {
    if (data.departmentId) {
      const department = await prisma.department.findFirst({
        where: { id: data.departmentId, companyId }
      });
      if (!department) throw new ApiError(404, "Department not found");
    }

    if (data.hiringManagerId) {
      const manager = await prisma.employee.findFirst({
        where: { id: data.hiringManagerId, companyId }
      });
      if (!manager) throw new ApiError(404, "Hiring manager not found");
    }

    return prisma.jobOpening.create({
      data: {
        companyId,
        departmentId: data.departmentId || null,
        hiringManagerId: data.hiringManagerId || null,
        title: data.title,
        employmentType: data.employmentType || "FULL_TIME",
        location: data.location || null,
        openings: data.openings ?? 1,
        status: data.status || "DRAFT",
        priority: data.priority || "MEDIUM",
        description: data.description || null,
        targetDate: data.targetDate || null
      }
    });
  },

  async updateOpening(companyId: string, id: string, data: Partial<JobOpeningInput>) {
    const opening = await prisma.jobOpening.findFirst({
      where: { id, companyId }
    });
    if (!opening) throw new ApiError(404, "Job opening not found");

    if (data.departmentId) {
      const department = await prisma.department.findFirst({
        where: { id: data.departmentId, companyId }
      });
      if (!department) throw new ApiError(404, "Department not found");
    }

    if (data.hiringManagerId) {
      const manager = await prisma.employee.findFirst({
        where: { id: data.hiringManagerId, companyId }
      });
      if (!manager) throw new ApiError(404, "Hiring manager not found");
    }

    return prisma.jobOpening.update({
      where: { id },
      data: {
        departmentId: data.departmentId === undefined ? undefined : data.departmentId || null,
        hiringManagerId: data.hiringManagerId === undefined ? undefined : data.hiringManagerId || null,
        title: data.title,
        employmentType: data.employmentType,
        location: data.location === undefined ? undefined : data.location || null,
        openings: data.openings,
        status: data.status,
        priority: data.priority,
        description: data.description === undefined ? undefined : data.description || null,
        targetDate: data.targetDate === undefined ? undefined : data.targetDate || null
      }
    });
  },

  getApplicants(companyId: string, jobOpeningId?: string) {
    return prisma.jobApplicant.findMany({
      where: {
        companyId,
        ...(jobOpeningId ? { jobOpeningId } : {})
      },
      include: {
        jobOpening: {
          select: {
            id: true,
            title: true,
            status: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
  },

  async createApplicant(companyId: string, data: ApplicantInput) {
    const opening = await prisma.jobOpening.findFirst({
      where: { id: data.jobOpeningId, companyId }
    });
    if (!opening) throw new ApiError(404, "Job opening not found");

    return prisma.jobApplicant.create({
      data: {
        companyId,
        jobOpeningId: data.jobOpeningId,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone || null,
        stage: data.stage || "APPLIED",
        source: data.source || null,
        currentCompany: data.currentCompany || null,
        experienceYears: data.experienceYears ?? null,
        rating: data.rating ?? null,
        noticePeriodDays: data.noticePeriodDays ?? null,
        expectedCompensation: data.expectedCompensation ?? null,
        summary: data.summary || null
      }
    });
  },

  async updateApplicant(companyId: string, id: string, data: Partial<ApplicantInput>) {
    const applicant = await prisma.jobApplicant.findFirst({
      where: { id, companyId }
    });
    if (!applicant) throw new ApiError(404, "Applicant not found");

    if (data.jobOpeningId) {
      const opening = await prisma.jobOpening.findFirst({
        where: { id: data.jobOpeningId, companyId }
      });
      if (!opening) throw new ApiError(404, "Job opening not found");
    }

    return prisma.jobApplicant.update({
      where: { id },
      data: {
        jobOpeningId: data.jobOpeningId,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone === undefined ? undefined : data.phone || null,
        stage: data.stage,
        source: data.source === undefined ? undefined : data.source || null,
        currentCompany: data.currentCompany === undefined ? undefined : data.currentCompany || null,
        experienceYears: data.experienceYears === undefined ? undefined : data.experienceYears,
        rating: data.rating === undefined ? undefined : data.rating,
        noticePeriodDays: data.noticePeriodDays === undefined ? undefined : data.noticePeriodDays,
        expectedCompensation: data.expectedCompensation === undefined ? undefined : data.expectedCompensation,
        summary: data.summary === undefined ? undefined : data.summary || null
      }
    });
  }
};
