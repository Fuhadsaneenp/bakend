/** Assignment collections are sets of stable row IDs, never positional snapshots. */
export function mergeAssignmentSheetRows<T extends { notes?: string; updatedAt?: string; uploadedAt?: string; count: number; status: string }>(candidates: T[][]): T[] {
  const byId = new Map<string, T>();
  const timestamp = (row: T) => Date.parse(row.updatedAt || row.uploadedAt || "") || 0;
  for (const rows of candidates) {
    for (const row of rows) {
      // Preserve legacy rows without an ID separately rather than merging by position.
      const id = row.notes?.trim() || `legacy:${JSON.stringify(row)}`;
      const previous = byId.get(id);
      if (!previous || timestamp(row) > timestamp(previous) ||
          (timestamp(row) === timestamp(previous) && (previous.status !== "Deleted" || row.status === "Deleted"))) {
        byId.set(id, row);
      }
    }
  }
  return [...byId.values()].map((row, index) => ({ ...row, count: index + 1 }));
}
