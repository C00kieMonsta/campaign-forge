import {
  CONTACT_CANDIDATE_FIELDS,
  type ContactCandidate,
  type CreateContactRequest
} from "@packages/types";

/**
 * Pure helpers behind the contact assistant's review step: which candidates can be created, and
 * what the create call receives. Kept out of the dialog so they can be tested without a DOM.
 */

export type CandidateProblem =
  | "missingEmail"
  | "invalidEmail"
  | "duplicateInBatch"
  | "existing";

/** One "@", a non-empty local part, a domain with a dot, no whitespace. Not RFC 5322. */
export function isValidEmail(s: string): boolean {
  const v = s.trim();
  if (!v || /\s/.test(v)) return false;
  const at = v.indexOf("@");
  if (at <= 0 || at !== v.lastIndexOf("@")) return false;
  const domain = v.slice(at + 1);
  const dot = domain.indexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

/**
 * What stops this candidate from being created, in display order.
 *
 * `otherSelectedEmailsLower` are the lowercase emails of the OTHER selected candidates, so a
 * duplicate is reported on both halves of the pair and disappears as soon as one is unticked.
 */
export function candidateProblems(
  candidate: Pick<ContactCandidate, "email" | "existing">,
  otherSelectedEmailsLower: string[]
): CandidateProblem[] {
  const problems: CandidateProblem[] = [];
  const email = candidate.email.trim();
  if (!email) {
    problems.push("missingEmail");
  } else if (!isValidEmail(email)) {
    problems.push("invalidEmail");
  } else if (otherSelectedEmailsLower.includes(email.toLowerCase())) {
    problems.push("duplicateInBatch");
  }
  if (candidate.existing) problems.push("existing");
  return problems;
}

/**
 * One item for api.contacts.assistant.create: the email, the non-empty fields trimmed, the groups.
 * An email2 that is not an address is dropped: the server validates it and would refuse the batch.
 */
export function toCreatePayload(
  candidate: ContactCandidate,
  groupIds: string[]
): CreateContactRequest {
  const payload: CreateContactRequest = {
    email: candidate.email.trim(),
    status: "subscribed"
  };
  for (const field of CONTACT_CANDIDATE_FIELDS) {
    const value = candidate[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (field === "email2" && !isValidEmail(trimmed)) continue;
    payload[field] = trimmed;
  }
  payload.groups = groupIds.length ? groupIds : undefined;
  return payload;
}
