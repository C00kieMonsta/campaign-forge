import type { ContactCandidateFields } from "@packages/types";
import { isPersonRecordPath, type ArchiveEntry } from "./archiveIntake";
import {
  parseBinaryPlist,
  PlistUid,
  type PlistDict,
  type PlistValue
} from "./bplist";
import { isValidEmail } from "./contactCandidates";
import type { RawCandidate } from "./importCandidates";

/**
 * Apple Contacts archive records (one binary plist per person) into raw import candidates.
 */

/** Records parsed between two yields to the event loop, so the progress text can repaint. */
const YIELD_EVERY = 200;

const ANGLE_GROUP = /<([^<>]*)>/g;
/** The `_$!<Home>!$_` wrapper Apple puts around its label constants. */
const LABEL_WRAPPER = /^_\$!<(.*)>!\$_$/;
const FAX_LABEL = /fax/;
const MOBILE_LABEL = /mobile|iphone|gsm|portable|cell/;
const BUSINESS_LABEL = /work|main|bureau|travail|werk|\bpro\b/;
const BELGIAN_MOBILE = /^(0032|32|0)4[5-9]\d{7}$/;

type PhoneSlot = "mobilePhone" | "homePhone" | "businessPhone";
const PHONE_SLOTS: PhoneSlot[] = ["mobilePhone", "homePhone", "businessPhone"];

/** One Apple multi-value property, values paired with labels by index. */
interface MultiValue {
  values: PlistValue[];
  labels: PlistValue[];
  identifiers: PlistValue[];
  primary: string | null;
}

function isDict(value: PlistValue): value is PlistDict {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array) &&
    !(value instanceof PlistUid)
  );
}

function text(value: PlistValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function multiValue(value: PlistValue | undefined): MultiValue | null {
  if (value === undefined || !isDict(value)) return null;
  const values = value.values;
  if (!Array.isArray(values)) return null;
  const labels = value.labels;
  const identifiers = value.identifiers;
  return {
    values,
    labels: Array.isArray(labels) ? labels : [],
    identifiers: Array.isArray(identifiers) ? identifiers : [],
    primary: typeof value.primary === "string" ? value.primary : null
  };
}

/** Indexes of a multi-value, the Apple-primary one first. */
function primaryFirst(mv: MultiValue): number[] {
  const order = mv.values.map((_, i) => i);
  if (mv.primary === null) return order;
  const primary = mv.identifiers.indexOf(mv.primary);
  if (primary < 0) return order;
  return [primary, ...order.filter((i) => i !== primary)];
}

function normalizeLabel(value: PlistValue | undefined): string {
  return text(value).replace(LABEL_WRAPPER, "$1").trim().toLowerCase();
}

/** The addresses inside one Apple email value, which may be "Name <a@b.c>" or "mailto:a@b.c". */
export function emailsFromValue(value: string): string[] {
  const v = value.trim().replace(/^mailto:/i, "");
  const parts: string[] = [];
  if (v.includes("<")) {
    ANGLE_GROUP.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ANGLE_GROUP.exec(v)) !== null) parts.push(match[1]);
  } else {
    parts.push(v);
  }
  const out: string[] = [];
  for (const part of parts) {
    const email = part
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/\s*@\s*/, "@")
      .trim();
    if (isValidEmail(email)) out.push(email);
  }
  return out;
}

/** True for a Belgian mobile number (04[5-9]…), whatever the label says. */
export function isBelgianMobile(value: string): boolean {
  const digits = value
    .replace(/\(0\)/g, "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
  return BELGIAN_MOBILE.test(digits);
}

function phoneSlotFor(label: string, value: string): PhoneSlot | null {
  if (FAX_LABEL.test(label)) return null;
  if (MOBILE_LABEL.test(label)) return "mobilePhone";
  if (BUSINESS_LABEL.test(label)) return "businessPhone";
  return isBelgianMobile(value) ? "mobilePhone" : "homePhone";
}

function readPhones(record: PlistDict, fields: ContactCandidateFields): void {
  const mv = multiValue(record.Phone);
  if (!mv) return;
  mv.values.forEach((raw, i) => {
    const value = text(raw);
    if (!value) return;
    const target = phoneSlotFor(normalizeLabel(mv.labels[i]), value);
    if (!target) return;
    const slot = fields[target] ? PHONE_SLOTS.find((s) => !fields[s]) : target;
    if (slot) fields[slot] = value;
  });
}

function streetLines(value: PlistValue | undefined): {
  first: string;
  rest: string;
} {
  const lines = text(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { first: lines[0] ?? "", rest: lines.slice(1).join(", ") };
}

function readAddresses(
  record: PlistDict,
  fields: ContactCandidateFields
): void {
  const mv = multiValue(record.Address);
  if (!mv) return;
  let home = false;
  let business = false;
  mv.values.forEach((raw, i) => {
    if (!isDict(raw)) return;
    const street = streetLines(raw.Street);
    if (normalizeLabel(mv.labels[i]) === "work") {
      if (business) return;
      business = true;
      fields.businessAddress = street.first;
      fields.businessAddress2 = street.rest;
      fields.businessCity = text(raw.City);
      fields.businessState = text(raw.State);
      fields.businessPostalCode = text(raw.ZIP);
      fields.businessCountry = text(raw.Country);
    } else {
      if (home) return;
      home = true;
      fields.homeStreet = street.first;
      fields.homeAddress2 = street.rest;
      fields.homeCity = text(raw.City);
      fields.homePostalCode = text(raw.ZIP);
      fields.homeCountry = text(raw.Country);
    }
  });
}

/** The UTC calendar day; Apple stores a fixed UTC hour, and a year before 1900 means "no year". */
function birthday(value: PlistValue | undefined): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const year = value.getUTCFullYear();
  if (year < 1900) return "";
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Maps one decoded person record. Null when the value is not a dictionary. */
export function personRecordToRaw(
  record: PlistValue,
  id: string
): RawCandidate | null {
  if (!isDict(record)) return null;
  const fields: ContactCandidateFields = {};
  const emails: string[] = [];
  const seen = new Set<string>();
  const addEmail = (email: string) => {
    const lower = email.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    emails.push(email);
  };

  const emailValues = multiValue(record.Email);
  if (emailValues) {
    for (const i of primaryFirst(emailValues)) {
      const value = emailValues.values[i];
      if (typeof value !== "string") continue;
      emailsFromValue(value).forEach(addEmail);
    }
  }

  // An address typed into a name field is an Apple Mail artefact: not a name, maybe an email.
  const names: [keyof ContactCandidateFields, string][] = [
    ["firstName", text(record.First)],
    ["lastName", text(record.Last)]
  ];
  for (const [field, value] of names) {
    if (!value) continue;
    if (value.includes("@")) {
      if (isValidEmail(value)) addEmail(value);
      continue;
    }
    fields[field] = value;
  }

  fields.organization = text(record.Organization);
  fields.notes = text(record.Note);
  fields.birthday = birthday(record.Birthday);
  readPhones(record, fields);
  readAddresses(record, fields);

  for (const key of Object.keys(fields) as (keyof ContactCandidateFields)[]) {
    if (!fields[key]) delete fields[key];
  }

  const flags =
    typeof record.ABPersonFlags === "number" ? record.ABPersonFlags : 0;
  return { id, emails, fields, groupNames: [], isCompany: (flags & 1) === 1 };
}

function recordId(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Reads every entry; a record that fails to decode is counted, never fatal. */
export async function readAbbu(
  entries: ArchiveEntry[],
  onProgress?: (done: number, total: number) => void
): Promise<{ raw: RawCandidate[]; unreadable: number }> {
  const records = entries.filter((entry) => isPersonRecordPath(entry.path));
  const total = records.length;
  const raw: RawCandidate[] = [];
  let unreadable = 0;
  let done = 0;
  onProgress?.(done, total);
  for (const entry of records) {
    try {
      const value = parseBinaryPlist(await entry.read());
      const candidate = personRecordToRaw(value, recordId(entry.path));
      if (candidate) raw.push(candidate);
      else unreadable++;
    } catch {
      unreadable++;
    }
    done++;
    onProgress?.(done, total);
    if (done % YIELD_EVERY === 0)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { raw, unreadable };
}
