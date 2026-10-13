export const sourceTypes = ["Auto", "Official API", "RSS Feed", "XML Feed", "Sitemap", "JSON endpoint", "JSON-LD / structured data", "HTML webpage scraping"] as const;
export const statuses = ["New", "Pending Review", "Assigned", "Verified", "Approved", "Rejected", "Duplicate", "Possible Duplicate", "Published", "Expired"] as const;
export type Source = {
  postingWebsite?: "Medbiomate" | "Trikonet"; id: string; companyId: string; name: string; website: string; url: string; type: typeof sourceTypes[number]; country: string; category: string;
  priority: "High" | "Normal" | "Low"; frequencyHours: number; active: boolean;
  config: { listPath?: string; fields?: Record<string, string>; jobLinkPattern?: string; jobSelector?: string; employer?: string };
  createdAt: string; updatedAt: string; lastAutomaticCheck?: string; lastSuccessfulCheck?: string; lastChangeDetected?: string;
  lastHumanCheck?: string; lastCheckedBy?: string; lastError?: string; health: "Working" | "Warning" | "Failed" | "Inactive" | "Not checked";
  contentHash?: string; previousJobIds?: string[]; previousUrls?: string[]; totalListings: number; jobsDetected: number; nextCheckAt: string; etag?: string; lastModified?: string;
};
export type Listing = {
  title: string; employer: string; location: string; emirate: string; country: string; category: string; designation: string; department: string;
  description: string; requirements: string; experience: string; qualification: string; salary: string; employmentType: string;
  postedDate: string; closingDate: string; originalUrl: string; canonicalUrl: string; sourceJobId: string; raw: unknown;
};
export type Job = Listing & { unqualifiedAt?:string; unqualifiedExpiresAt?:string; id: string; companyId: string; sourceId: string; sourceWebsite: string; sourceUrl: string; detectedAt: string; importedAt: string;
  postingWebsite?: "Medbiomate" | "Trikonet"; status: typeof statuses[number]; assignedToId?: string | null; assignedToName?: string; departmentId?: string | null; assignedAt?: string | null;
  startedAt?: string | null; completedAt?: string | null; duplicateOf?: string; duplicateReason?: string; updatedAt: string; version: number };
export type Actor = { id: string; name: string };

export function jobPostingWebsite(j: Job): "Medbiomate" | "Trikonet" {
  if (j.postingWebsite) return j.postingWebsite;
  return /health|pharma|medic|nurs|doctor|physician|therap|radiolog|clinical|dentist|surgeon|specialist ent/i.test(`${j.category} ${j.title}`) ? "Medbiomate" : "Trikonet";
}

export function jobVisibleInCollection(j:Job,now=Date.now()):boolean {const start=Date.parse(j.assignedToId?(j.assignedAt||j.detectedAt):j.detectedAt);return !Number.isFinite(start)||now<start+(j.assignedToId?24:168)*3600000;}
