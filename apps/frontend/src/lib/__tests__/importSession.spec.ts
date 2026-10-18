import type { ImportCandidate } from "../importCandidates";
import {
  clearImportSession,
  hasImportSession,
  IMPORT_SESSION_KEY,
  loadImportSession,
  MAX_SESSION_CHARS,
  restoreRows,
  saveImportSession,
  type ImportSessionRow,
  type SessionStore
} from "../importSession";

function memoryStore(): SessionStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k)
  };
}

function candidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    id: "c1",
    email: "jean.dupont@x.be",
    fields: { firstName: "Jean", lastName: "Dupont" },
    groupNames: [],
    isCompany: false,
    needsName: false,
    ...overrides
  };
}

function row(overrides: Partial<ImportSessionRow> = {}): ImportSessionRow {
  return { c: candidate(), selected: true, serverError: null, ...overrides };
}

const session = {
  source: "abbu" as const,
  summary: {
    alreadyPresent: 2,
    withoutEmail: 3,
    duplicatesInFile: 1,
    newGroupNames: ["VIP"]
  },
  rows: [row(), row({ c: candidate({ id: "c2", email: "b@x.be" }) })],
  page: 2,
  focusIndex: 101
};

const DAY = 24 * 60 * 60 * 1000;

describe("saveImportSession / loadImportSession", () => {
  it("round-trips the review state with a timestamp", () => {
    const store = memoryStore();
    const now = new Date("2026-10-18T16:40:00Z");
    expect(saveImportSession(session, store, now)).toBe(true);
    const loaded = loadImportSession(store, now);
    expect(loaded).toMatchObject({ ...session, version: 1 });
    expect(loaded?.savedAt).toBe("2026-10-18T16:40:00.000Z");
    expect(hasImportSession(store)).toBe(true);
  });

  it("gives null when nothing is saved, the JSON is garbage or the shape is off", () => {
    const store = memoryStore();
    expect(loadImportSession(store)).toBeNull();
    store.setItem(IMPORT_SESSION_KEY, "{not json");
    expect(loadImportSession(store)).toBeNull();
    store.setItem(IMPORT_SESSION_KEY, JSON.stringify({ version: 0, rows: [] }));
    expect(loadImportSession(store)).toBeNull();
    store.setItem(
      IMPORT_SESSION_KEY,
      JSON.stringify({ ...session, version: 1, savedAt: "x", rows: [{}] })
    );
    expect(loadImportSession(store)).toBeNull();
    expect(hasImportSession(store)).toBe(false);
  });

  it("drops a list saved more than 30 days ago and keeps a younger one", () => {
    const store = memoryStore();
    const savedAt = new Date("2026-10-18T16:40:00Z");
    saveImportSession(session, store, savedAt);
    expect(
      loadImportSession(store, new Date(savedAt.getTime() + 29 * DAY))
    ).toMatchObject({ ...session, version: 1 });
    expect(store.data.has(IMPORT_SESSION_KEY)).toBe(true);
    expect(
      loadImportSession(store, new Date(savedAt.getTime() + 31 * DAY))
    ).toBeNull();
    expect(store.data.has(IMPORT_SESSION_KEY)).toBe(false);
  });

  it("drops a list whose timestamp cannot be read", () => {
    const store = memoryStore();
    store.setItem(
      IMPORT_SESSION_KEY,
      JSON.stringify({ ...session, version: 1, savedAt: "not a date" })
    );
    expect(loadImportSession(store)).toBeNull();
    expect(store.data.has(IMPORT_SESSION_KEY)).toBe(false);
  });

  it("reports a full or missing storage instead of throwing", () => {
    const full: SessionStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined
    };
    expect(saveImportSession(session, full)).toBe(false);
    expect(saveImportSession(session, null)).toBe(false);
    expect(loadImportSession(null)).toBeNull();
    expect(() => clearImportSession(null)).not.toThrow();
  });

  it("keeps the previous list when a later save throws, so the dialog must clear first", () => {
    const store = memoryStore();
    saveImportSession(session, store);
    const setItem = jest.spyOn(store, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const later = { ...session, rows: [row({ c: candidate({ id: "c9" }) })] };
    expect(saveImportSession(later, store)).toBe(false);
    setItem.mockRestore();
    expect(loadImportSession(store)?.rows.map((r) => r.c.id)).toEqual([
      "c1",
      "c2"
    ]);
  });

  it("refuses a list over the size budget without touching the store", () => {
    const store = memoryStore();
    saveImportSession(session, store);
    const setItem = jest.spyOn(store, "setItem");
    const huge = {
      ...session,
      rows: [
        row({
          c: candidate({ fields: { lastName: "x".repeat(MAX_SESSION_CHARS) } })
        })
      ]
    };
    expect(saveImportSession(huge, store)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(loadImportSession(store)?.rows).toHaveLength(2);
  });

  it("clears what it saved", () => {
    const store = memoryStore();
    saveImportSession(session, store);
    clearImportSession(store);
    expect(store.data.has(IMPORT_SESSION_KEY)).toBe(false);
    expect(hasImportSession(store)).toBe(false);
  });
});

describe("restoreRows", () => {
  it("drops the rows written before the refresh, matching the address ignoring case", () => {
    const out = restoreRows(session.rows, new Set(["jean.dupont@x.be"]));
    expect(out.rows.map((r) => r.c.id)).toEqual(["c2"]);
    expect(out.dropped).toBe(1);
  });

  it("drops a row whose second address is now known, as buildBatch would", () => {
    const rows = [
      row({
        c: candidate({
          fields: {
            firstName: "Jean",
            lastName: "Dupont",
            email2: "Jean.Dupont@old.be"
          }
        })
      }),
      row({ c: candidate({ id: "c2", email: "b@x.be" }) })
    ];
    const out = restoreRows(rows, new Set(["jean.dupont@old.be"]));
    expect(out.rows.map((r) => r.c.id)).toEqual(["c2"]);
    expect(out.dropped).toBe(1);
  });

  it("keeps everything when nothing was written", () => {
    const out = restoreRows(session.rows, new Set());
    expect(out.rows).toHaveLength(2);
    expect(out.dropped).toBe(0);
  });

  it("can leave nothing while the session itself is still saved", () => {
    const store = memoryStore();
    saveImportSession(session, store);
    const out = restoreRows(
      session.rows,
      new Set(["jean.dupont@x.be", "b@x.be"])
    );
    expect(out.rows).toEqual([]);
    expect(out.dropped).toBe(2);
    expect(hasImportSession(store)).toBe(true);
  });
});
