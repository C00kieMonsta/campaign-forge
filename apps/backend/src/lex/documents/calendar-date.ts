/**
 * A calendar date as YYYY-MM-DD, read from the LOCAL parts — never through toISOString().
 *
 * timeline_date is a Postgres `date`: a calendar day with no time and no zone. node-postgres parses
 * it into a Date at LOCAL midnight, so toISOString() re-reads that instant in UTC and, at any
 * positive offset, lands on the previous day. Under Europe/Brussels the marriage contract of
 * 1958-07-10 was served to the client as "1958-07-09" — contradicting, on the same screen, both its
 * own summary ("établi le 10 juillet 1958") and its filename.
 *
 * A day is not a rounding error in a succession file: it orders the acts, and it is what
 * prescription and filing deadlines are counted from.
 *
 * Its own module because three call sites need it now — the document mapper, the case-file manifest
 * and the task runner's per-document header — and the other two must not import documents.service
 * to reach it. That import would drag DocumentsService and IngestionWorker in behind it, which is
 * the coupling CaseFileModule exists to avoid.
 */
export function dateOnly(v: Date | string | null): string | null {
  if (v === null) return null;
  if (!(v instanceof Date)) return String(v).slice(0, 10);
  const month = String(v.getMonth() + 1).padStart(2, "0");
  const day = String(v.getDate()).padStart(2, "0");
  return `${v.getFullYear()}-${month}-${day}`;
}
