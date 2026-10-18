import {
  CONTACT_CANDIDATE_FIELDS,
  emailSchema,
  type ContactCandidateField,
  type ContactCandidateFields,
  type CreateContactRequest
} from "@packages/types";
import { CSV_COLUMNS, parseCsv } from "./contactCsv";

/**
 * Pure rules behind the import review: which rows are new, which are complete, how a missing
 * name is filled, and what the create call receives. Shared by the Apple archive and CSV paths.
 */

/** One source record before the batch rules: every email it carries, in preference order. */
export interface RawCandidate {
  id: string;
  emails: string[];
  fields: ContactCandidateFields;
  groupNames: string[];
  isCompany: boolean;
}

/** One row of the review list: a new contact with its primary email settled. */
export interface ImportCandidate {
  id: string;
  email: string;
  fields: ContactCandidateFields;
  groupNames: string[];
  isCompany: boolean;
  /** Missing a first or last name in the source; such rows stay editable after autofill. */
  needsName: boolean;
}

export interface ImportBatch {
  candidates: ImportCandidate[];
  alreadyPresent: number;
  withoutEmail: number;
  duplicatesInFile: number;
  newGroupNames: string[];
}

/** Mailbox words that are not a person's name. */
export const GENERIC_MAILBOXES: ReadonlySet<string> = new Set([
  "info",
  "contact",
  "hello",
  "bonjour",
  "hallo",
  "admin",
  "administratie",
  "office",
  "bureau",
  "kantoor",
  "secretariat",
  "secretariaat",
  "secretaire",
  "direction",
  "accueil",
  "reception",
  "receptie",
  "onthaal",
  "sales",
  "vente",
  "verkoop",
  "support",
  "noreply",
  "no-reply",
  "webmaster",
  "service",
  "compta",
  "facturation",
  "shop",
  "winkel",
  "team",
  "mail",
  "newsletter"
]);

/** The zod maxima of packages/types/src/dto/contacts.ts, applied before the server sees a value. */
const MAX_LENGTH: Partial<Record<ContactCandidateField, number>> = {
  firstName: 100,
  lastName: 100,
  displayName: 200,
  homePhone: 50,
  businessPhone: 50,
  mobilePhone: 50,
  homeStreet: 200,
  homeAddress2: 200,
  homeCity: 100,
  homePostalCode: 20,
  homeCountry: 100,
  businessAddress: 200,
  businessAddress2: 200,
  businessCity: 100,
  businessState: 100,
  businessPostalCode: 20,
  businessCountry: 100,
  organization: 200,
  notes: 2000
};

const BIRTHDAY = /^\d{4}-\d{2}-\d{2}$/;
/** Local-part separators and digit runs; what remains between them are the name tokens. */
const LOCAL_PART_SEPARATORS = /[._+-]+|\d+/;
const LETTERS_ONLY = /^\p{L}+$/u;

const CANDIDATE_FIELD_SET: ReadonlySet<string> = new Set(
  CONTACT_CANDIDATE_FIELDS
);

function isBlank(value: string | undefined): boolean {
  return !value || !value.trim();
}

function isCandidateField(field: string): field is ContactCandidateField {
  return CANDIDATE_FIELD_SET.has(field);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function localPart(email: string): string {
  const at = email.indexOf("@");
  return (at < 0 ? email : email.slice(0, at)).toLowerCase();
}

/** Trimmed, non-empty, unique ignoring case; the first spelling is the one kept. */
function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const lower = name.toLowerCase();
    if (!name || seen.has(lower)) continue;
    seen.add(lower);
    out.push(name);
  }
  return out;
}

/** The address the server would accept, trimmed and unwrapped, or null. */
export function cleanEmail(value: string): string | null {
  let v = value.trim().replace(/^mailto:/i, "");
  const open = v.indexOf("<");
  if (open >= 0) {
    const close = v.indexOf(">", open + 1);
    v = close >= 0 ? v.slice(open + 1, close) : v.slice(open + 1);
  }
  v = v
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/\s*@\s*/, "@")
    .trim();
  return emailSchema.safeParse(v).success ? v : null;
}

/** Copies the later record into an earlier candidate that shares one of its addresses. */
function mergeInto(
  earlier: ImportCandidate,
  later: RawCandidate,
  laterEmails: string[],
  laterGroupNames: string[]
): void {
  for (const key of CONTACT_CANDIDATE_FIELDS) {
    const value = later.fields[key];
    if (isBlank(earlier.fields[key]) && !isBlank(value))
      earlier.fields[key] = value;
  }
  if (isBlank(earlier.fields.email2)) {
    const primary = earlier.email.toLowerCase();
    const extra = laterEmails.find((e) => e.toLowerCase() !== primary);
    if (extra) earlier.fields.email2 = extra;
  }
  earlier.groupNames = uniqueNames([...earlier.groupNames, ...laterGroupNames]);
  earlier.isCompany = earlier.isCompany || later.isCompany;
  earlier.needsName = earlier.needsName && !isComplete(earlier);
}

/** Settles emails, drops what exists, merges repeats, collects the group names to create. */
export function buildBatch(
  raw: RawCandidate[],
  existingEmails: Set<string>,
  existingGroupNamesLower: Set<string>
): ImportBatch {
  const candidates: ImportCandidate[] = [];
  const byEmail = new Map<string, ImportCandidate>();
  const newGroups = new Map<string, string>();
  let alreadyPresent = 0;
  let withoutEmail = 0;
  let duplicatesInFile = 0;

  const register = (candidate: ImportCandidate, emails: string[]) => {
    for (const e of emails) byEmail.set(e.toLowerCase(), candidate);
    const email2 = candidate.fields.email2
      ? cleanEmail(candidate.fields.email2)
      : null;
    if (email2) byEmail.set(email2.toLowerCase(), candidate);
  };

  for (const record of raw) {
    const emails = uniqueNames(
      record.emails.map(cleanEmail).filter((e): e is string => e !== null)
    );
    if (!emails.length) {
      withoutEmail++;
      continue;
    }
    if (emails.some((e) => existingEmails.has(e.toLowerCase()))) {
      alreadyPresent++;
      continue;
    }

    const groupNames = uniqueNames(record.groupNames);
    for (const name of groupNames) {
      const lower = name.toLowerCase();
      if (!existingGroupNamesLower.has(lower) && !newGroups.has(lower))
        newGroups.set(lower, name);
    }

    // Every earlier candidate this record touches; a second one is the same person seen twice.
    const hits: ImportCandidate[] = [];
    for (const e of emails) {
      const hit = byEmail.get(e.toLowerCase());
      if (hit && !hits.includes(hit)) hits.push(hit);
    }
    if (hits.length > 0) {
      const target = hits[0];
      duplicatesInFile++;
      mergeInto(target, record, emails, groupNames);
      for (const extra of hits.slice(1)) {
        duplicatesInFile++;
        mergeInto(
          target,
          { ...extra, emails: [extra.email] },
          [extra.email],
          extra.groupNames
        );
        candidates.splice(candidates.indexOf(extra), 1);
        for (const [key, owner] of byEmail) {
          if (owner === extra) byEmail.set(key, target);
        }
      }
      register(target, emails);
      continue;
    }

    const fields: ContactCandidateFields = { ...record.fields };
    if (isBlank(fields.email2) && emails[1]) fields.email2 = emails[1];
    const candidate: ImportCandidate = {
      id: record.id,
      email: emails[0],
      fields,
      groupNames,
      isCompany: record.isCompany,
      needsName: !isComplete({ fields })
    };
    candidates.push(candidate);
    register(candidate, emails);
  }

  return {
    candidates,
    alreadyPresent,
    withoutEmail,
    duplicatesInFile,
    newGroupNames: [...newGroups.values()]
  };
}

/** First and last name both present. */
export function isComplete(c: { fields: ContactCandidateFields }): boolean {
  return !isBlank(c.fields.firstName) && !isBlank(c.fields.lastName);
}

/** A first and last name guessed from the local part of an address. */
export function nameFromEmail(email: string): {
  firstName?: string;
  lastName?: string;
} {
  const local = localPart(email);
  if (GENERIC_MAILBOXES.has(local.replace(/[._+\-\d]/g, ""))) return {};
  const tokens = local
    .split(LOCAL_PART_SEPARATORS)
    .filter(
      (t) => t.length >= 2 && LETTERS_ONLY.test(t) && !GENERIC_MAILBOXES.has(t)
    );
  if (tokens.length >= 2) {
    return {
      firstName: capitalize(tokens[0]),
      lastName: capitalize(tokens[tokens.length - 1])
    };
  }
  if (tokens.length === 1 && tokens[0].length >= 3)
    return { lastName: capitalize(tokens[0]) };
  return {};
}

/** Fills the blank name fields only; returns the same object when nothing is missing. */
export function autofillNames(
  c: ImportCandidate,
  salutation: string
): ImportCandidate {
  if (isComplete(c)) return c;
  const fields: ContactCandidateFields = { ...c.fields };

  // A mailbox word kept as a name ("Info"), or an earlier salutation, is no name at all.
  const salutationLower = salutation.trim().toLowerCase();
  for (const key of ["firstName", "lastName"] as const) {
    const value = (fields[key] ?? "").trim().toLowerCase();
    if (value && (GENERIC_MAILBOXES.has(value) || value === salutationLower))
      fields[key] = "";
  }

  // A full name typed into one of the two fields is split at its last space.
  const first = (fields.firstName ?? "").trim();
  const last = (fields.lastName ?? "").trim();
  if (!first !== !last) {
    const whole = first || last;
    const cut = whole.lastIndexOf(" ");
    // A last name starting with a particle ("van Dijk") stays whole.
    const particle = !first && /^\p{Ll}/u.test(whole);
    if (cut > 0 && !particle) {
      fields.firstName = whole.slice(0, cut).trim();
      fields.lastName = whole.slice(cut + 1).trim();
    }
  }

  const organization = (fields.organization ?? "").trim();
  if (c.isCompany && organization) {
    if (isBlank(fields.lastName)) fields.lastName = organization;
    if (isBlank(fields.firstName)) fields.firstName = salutation;
    return { ...c, fields };
  }

  const guess = nameFromEmail(c.email);
  if (isBlank(fields.firstName) && guess.firstName)
    fields.firstName = guess.firstName;
  if (isBlank(fields.lastName) && guess.lastName)
    fields.lastName = guess.lastName;
  if (isBlank(fields.lastName) && organization) fields.lastName = organization;
  if (isBlank(fields.firstName)) fields.firstName = salutation;
  if (isBlank(fields.lastName)) {
    const word = localPart(c.email).replace(/[._+\-\d]/g, "");
    fields.lastName =
      word.length >= 3 && !GENERIC_MAILBOXES.has(word)
        ? capitalize(word)
        : salutation;
  }
  return { ...c, fields };
}

/** The create payload: trimmed, truncated to the server maxima, invalid optional values dropped. */
export function toCreateRequest(
  c: ImportCandidate,
  groupIds: string[]
): CreateContactRequest {
  const payload: CreateContactRequest = {
    email: c.email.trim(),
    status: "subscribed"
  };
  for (const field of CONTACT_CANDIDATE_FIELDS) {
    const value = c.fields[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (field === "email2") {
      const cleaned = cleanEmail(trimmed);
      if (cleaned) payload.email2 = cleaned;
      continue;
    }
    if (field === "birthday") {
      if (BIRTHDAY.test(trimmed)) payload.birthday = trimmed;
      continue;
    }
    const max = MAX_LENGTH[field];
    payload[field] = max ? trimmed.slice(0, max) : trimmed;
  }
  if (groupIds.length) payload.groups = groupIds;
  return payload;
}

/** Rows of the CSV template as raw candidates. An empty or header-only file gives []. */
export function csvToRawCandidates(text: string): RawCandidate[] {
  return parseCsv(text).map((row, index) => {
    const byHeader = new Map<string, string>();
    for (const [header, value] of Object.entries(row)) {
      byHeader.set(header.trim().toLowerCase(), value);
    }
    const cell = (header: string) =>
      (byHeader.get(header.toLowerCase()) ?? "").trim();

    const fields: ContactCandidateFields = {};
    let email = "";
    let email2 = "";
    let groupNames: string[] = [];
    for (const column of CSV_COLUMNS) {
      const value = cell(column.header);
      if (!value) continue;
      if (column.field === "email") email = value;
      else if (column.field === "email2") email2 = value;
      else if (column.field === "group") groupNames = value.split(";");
      else if (isCandidateField(column.field)) fields[column.field] = value;
    }
    return {
      id: `csv-${index}`,
      emails: [email, email2].filter(Boolean),
      fields,
      groupNames: uniqueNames(groupNames),
      isCompany: false
    };
  });
}
