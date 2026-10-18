import type { ImportCandidate } from "./importCandidates";

/**
 * The review step of a contact import, kept in localStorage so a page refresh or a closed tab
 * does not lose a parsed archive, the ticks and the typed names. One session at a time.
 */

export const IMPORT_SESSION_KEY = "contact_import_session";
const VERSION = 1;

export interface ImportSessionRow {
  c: ImportCandidate;
  selected: boolean;
  serverError: string | null;
}

export interface ImportSession {
  version: typeof VERSION;
  /** ISO timestamp of the last save. */
  savedAt: string;
  source: "abbu" | "csv";
  summary: {
    alreadyPresent: number;
    withoutEmail: number;
    duplicatesInFile: number;
    newGroupNames: string[];
  };
  rows: ImportSessionRow[];
  page: number;
  focusIndex: number;
}

export type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): SessionStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRow(value: unknown): value is ImportSessionRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ImportSessionRow>;
  const c = row.c as Partial<ImportCandidate> | undefined;
  return (
    typeof row.selected === "boolean" &&
    (row.serverError === null || typeof row.serverError === "string") &&
    !!c &&
    typeof c.id === "string" &&
    typeof c.email === "string" &&
    !!c.fields &&
    typeof c.fields === "object" &&
    Array.isArray(c.groupNames) &&
    typeof c.isCompany === "boolean" &&
    typeof c.needsName === "boolean"
  );
}

function isSession(value: unknown): value is ImportSession {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<ImportSession>;
  return (
    s.version === VERSION &&
    typeof s.savedAt === "string" &&
    (s.source === "abbu" || s.source === "csv") &&
    !!s.summary &&
    typeof s.summary === "object" &&
    Array.isArray(s.summary.newGroupNames) &&
    Array.isArray(s.rows) &&
    s.rows.every(isRow) &&
    typeof s.page === "number" &&
    typeof s.focusIndex === "number"
  );
}

/** The saved session, or null when there is none or it is unreadable. */
export function loadImportSession(
  store: SessionStore | null = defaultStore()
): ImportSession | null {
  if (!store) return null;
  try {
    const raw = store.getItem(IMPORT_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes the session; false when storage is unavailable or full. */
export function saveImportSession(
  session: Omit<ImportSession, "version" | "savedAt">,
  store: SessionStore | null = defaultStore(),
  now: Date = new Date()
): boolean {
  if (!store) return false;
  const full: ImportSession = {
    version: VERSION,
    savedAt: now.toISOString(),
    ...session
  };
  try {
    store.setItem(IMPORT_SESSION_KEY, JSON.stringify(full));
    return true;
  } catch {
    return false;
  }
}

export function clearImportSession(
  store: SessionStore | null = defaultStore()
): void {
  try {
    store?.removeItem(IMPORT_SESSION_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function hasImportSession(
  store: SessionStore | null = defaultStore()
): boolean {
  return loadImportSession(store) !== null;
}

/**
 * The rows still worth reviewing: a contact written before the refresh now exists in the list and
 * is dropped, so a resumed import never offers it again.
 */
export function restoreRows(
  rows: ImportSessionRow[],
  existingEmails: Set<string>
): { rows: ImportSessionRow[]; dropped: number } {
  const kept = rows.filter((r) => !existingEmails.has(r.c.email.toLowerCase()));
  return { rows: kept, dropped: rows.length - kept.length };
}
