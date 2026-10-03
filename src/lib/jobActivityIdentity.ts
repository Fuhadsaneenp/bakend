type ActivityRow = { sourceUrl: string; postId?: string | number; jobTitle?: string; companyName?: string; uploadedBy?: string; uploadedAt?: string; updatedAt?: string; editedAt?: string; [key: string]: unknown };

// Post IDs are scoped to the source host. Legacy rows can recover identity only
// when their title, employer, operator and publication time identify one post.
export function deduplicateJobActivity<T extends ActivityRow>(rows: T[]): T[] {
  const host = (row: T) => { try { return new URL(row.sourceUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
  const post = (row: T) => {
    let id = row.postId;
    try { id ||= new URL(row.sourceUrl).searchParams.get("p") || undefined; } catch {}
    return id ? `${host(row)}:post:${id}` : "";
  };
  const fingerprint = (row: T) => row.jobTitle?.trim() && row.companyName?.trim() && row.uploadedBy?.trim() && row.uploadedAt
    ? JSON.stringify([host(row), row.jobTitle.trim().toLowerCase(), row.companyName.trim().toLowerCase(), row.uploadedBy.trim().toLowerCase(), Date.parse(row.uploadedAt)]) : "";
  const identities = new Map<string, Set<string>>();
  const urls = new Map<string, string>();
  for (const row of rows) {
    const id = post(row); if (!id) continue;
    urls.set(row.sourceUrl, id);
    const fp = fingerprint(row); if (fp) { const ids = identities.get(fp) || new Set<string>(); ids.add(id); identities.set(fp, ids); }
  }
  const unique = new Map<string, T>();
  const timestamp = (row: T) => Date.parse(row.updatedAt || row.editedAt || row.uploadedAt || "") || 0;
  for (const row of rows) {
    const matches = identities.get(fingerprint(row));
    const id = post(row) || urls.get(row.sourceUrl) || (matches?.size === 1 ? [...matches][0] : "") || row.sourceUrl;
    const previous = unique.get(id);
    if (!previous || timestamp(row) >= timestamp(previous)) unique.set(id, { ...previous, ...row });
  }
  return [...unique.values()];
}
