import { types } from "pg";
import { mapDocument, type DocumentRow } from "../documents.service";

// timeline_date is a Postgres `date`: a calendar day, no time, no zone. node-postgres hands it back
// as a Date at LOCAL midnight, so formatting it through toISOString() re-reads that instant in UTC
// and lands on the previous day at any positive offset. That shipped: under Europe/Brussels the
// 1958-07-10 marriage contract was served as "1958-07-09", contradicting its own summary and
// filename on the same screen. A day decides the order of acts and the start of prescription.
//
// This spec is only meaningful in a POSITIVE-OFFSET zone — the same bug passes cleanly under UTC,
// which is why it was never caught. The backend test script pins TZ=Europe/Brussels, the zone the
// app actually serves; running these under UTC would make this file green and worthless.

/** Exactly what the driver does with a `date` column, so the test exercises the real value. */
const parseDate = types.getTypeParser(1082, "text") as (v: string) => Date;

function row(timelineDate: string | null): DocumentRow {
  return {
    id: "d1",
    workspace_id: "ws-1",
    owner_email: "lawyer@example.com",
    filename: "CONTRAT MARIAGE PARENTS 10.07.1958.pdf",
    content_type: "application/pdf",
    size_bytes: "1000",
    s3_key: "k",
    s3_version_id: null,
    sha256: "abc",
    parse_status: "ready",
    lifecycle_state: "active",
    timeline_date: timelineDate === null ? null : parseDate(timelineDate),
    page_count: 4,
    summary: "Contrat de mariage établi le 10 juillet 1958.",
    language: "fr",
    key_names: [],
    tags: [],
    duration_seconds: null,
    duplicate_of: null,
    source_path: null,
    error: null,
    metadata: {},
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z")
  } as DocumentRow;
}

describe("timelineDate is the calendar day, not an instant", () => {
  it("returns the stored day for dates the whole corpus spans", () => {
    // Real values from the case file, including the two the screenshot showed one day early.
    for (const day of [
      "1958-07-10",
      "1989-04-29",
      "1992-01-05",
      "2024-12-31",
      "2025-01-01"
    ]) {
      expect(mapDocument(row(day)).timelineDate).toBe(day);
    }
  });

  it("does not shift across a DST boundary in either direction", () => {
    // Belgium switches on the last Sunday of March and October; midnight either side of those is
    // where a UTC round-trip is most likely to slip.
    for (const day of [
      "2025-03-29",
      "2025-03-30",
      "2025-03-31",
      "2025-10-25",
      "2025-10-26",
      "2025-10-27"
    ]) {
      expect(mapDocument(row(day)).timelineDate).toBe(day);
    }
  });

  it("keeps the first of January, where an off-by-one also moves the YEAR", () => {
    // The chronology's year rails group on the first four characters, so this one would file a 2020
    // document under 2019.
    expect(mapDocument(row("2020-01-01")).timelineDate).toBe("2020-01-01");
  });

  it("passes a null through", () => {
    expect(mapDocument(row(null)).timelineDate).toBeNull();
  });

  it("accepts a plain string unchanged, for a driver configured not to parse dates", () => {
    const r = row(null);
    (r as { timeline_date: unknown }).timeline_date = "1958-07-10";
    expect(mapDocument(r).timelineDate).toBe("1958-07-10");
  });
});
