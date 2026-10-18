import { cleanEmail, type ImportCandidate } from "./importCandidates";

/**
 * The review step of a contact import, kept in localStorage so a page refresh or a closed tab
 * does not lose a parsed archive, the ticks and the typed names. One session at a time.
 */

export const IMPORT_SESSION_KEY = "contact_import_session";
const VERSION = 1;
/** A forgotten list is dropped after this long. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Serialized size budget in UTF-16 units: 4 MB in storage, under the 5 MB origin quota with room
 * for the other keys. The owner's whole 6373-record archive serializes to 1.6 million characters.
 */
export const MAX_SESSION_CHARS = 2_000_000;

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

/** The saved session, or null when there is none, it is unreadable or it is older than MAX_AGE_MS. */
export function loadImportSession(
  store: SessionStore | null = defaultStore(),
  now: Date = new Date()
): ImportSession | null {
  if (!store) return null;
  try {
    const raw = store.getItem(IMPORT_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSession(parsed)) return null;
    const age = now.getTime() - Date.parse(parsed.savedAt);
    if (Number.isNaN(age) || age > MAX_AGE_MS) {
      store.removeItem(IMPORT_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Writes the session; false when storage is unavailable or full, or the list is over MAX_SESSION_CHARS. */
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
  let json: string;
  try {
    json = JSON.stringify(full);
  } catch {
    return false;
  }
  // Too big to store: the last good write stays and the dialog shows notSaved.
  if (json.length > MAX_SESSION_CHARS) return false;
  try {
    store.setItem(IMPORT_SESSION_KEY, json);
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
 * The rows still worth reviewing: a row whose primary or second address now exists in the list
 * is dropped, as buildBatch would have counted it, so a resumed import never offers it again.
 */
export function restoreRows(
  rows: ImportSessionRow[],
  existingEmails: Set<string>
): { rows: ImportSessionRow[]; dropped: number } {
  const known = (r: ImportSessionRow): boolean => {
    if (existingEmails.has(r.c.email.toLowerCase())) return true;
    const second = r.c.fields.email2 ? cleanEmail(r.c.fields.email2) : null;
    return second !== null && existingEmails.has(second.toLowerCase());
  };
  const kept = rows.filter((r) => !known(r));
  return { rows: kept, dropped: rows.length - kept.length };
}
