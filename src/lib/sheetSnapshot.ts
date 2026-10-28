import { createHash } from "node:crypto";
const snapshots = new WeakMap<object, { version: string; sheets: object }>();
/** Hash each immutable cached snapshot once, rather than serialize it per poll. */
export function sheetSnapshot(sheets: object, knownVersion?: string) {
  let snapshot = snapshots.get(sheets);
  if (!snapshot) {
    snapshot = { version: createHash("sha256").update(JSON.stringify(sheets)).digest("hex"), sheets };
    snapshots.set(sheets, snapshot);
  }
  return snapshot.version === knownVersion ? { version: snapshot.version, unchanged: true as const } : snapshot;
}
