import { z } from "zod";
import type { Contact, ContactStatus } from "../entities/contact";

// ── Shared ────────────────────────────────────────────────────────────────────────────
// The two Campaigns-app assistants: a chat that writes a whole campaign, and an extractor that
// turns a photo, a recording or a pasted text into contacts. Both are stateless HTTP calls; the
// chat's history lives in the browser and is sent back in full on every turn.

/** The UI language, which is also the language the assistants reply in. */
export const assistantLanguageSchema = z.enum(["fr", "nl"]);
export type AssistantLanguage = z.infer<typeof assistantLanguageSchema>;

/**
 * Ceiling on a photo or a recording sent to an assistant. nginx allows 12 MB on these routes
 * (scripts/ec2-bootstrap.sh); the API stops a little under so the rejection is ours, with a
 * message, rather than nginx's bare 413. The client downsizes photos well below this.
 */
export const MAX_ASSISTANT_UPLOAD_BYTES = 10 * 1024 * 1024;
/** A dictated contact or a campaign brief is a few sentences, not a deposition. */
export const MAX_ASSISTANT_VOICE_SECONDS = 3 * 60;
/**
 * Turns kept in the stateless chat. The client trims the oldest before sending. Together with
 * the per-message cap this keeps a turn well under the API's JSON body limit (see main.ts).
 */
export const MAX_ASSISTANT_MESSAGES = 24;
export const MAX_ASSISTANT_MESSAGE_CHARS = 8000;
/** Pasted text for contact extraction: a long sign-up sheet fits, a book does not. */
export const MAX_ASSISTANT_TEXT_CHARS = 20000;

export interface AssistantTranscribeResponse {
  text: string;
  durationSeconds: number | null;
}

// ── Campaign assistant ────────────────────────────────────────────────────────────────

/**
 * A spot in the draft where a photo belongs. The html carries a labelled placeholder image for it;
 * the UI lists the slots so the user can fill them, and warns when some are still empty.
 */
export const campaignImageSlotSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slot id must be a lowercase slug"),
  label: z.string().min(1).max(120),
  description: z.string().max(400).optional()
});
export type CampaignImageSlot = z.infer<typeof campaignImageSlotSchema>;

export const campaignDraftSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(500000),
  /** Existing group ids. Empty means every subscribed contact, as in the editor. */
  targetGroupIds: z.array(z.string().min(1)).max(50).default([]),
  imageSlots: z.array(campaignImageSlotSchema).max(20).default([])
});
export type CampaignDraft = z.infer<typeof campaignDraftSchema>;

export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_ASSISTANT_MESSAGE_CHARS)
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const campaignAssistantTurnRequestSchema = z.object({
  messages: z.array(assistantMessageSchema).min(1).max(MAX_ASSISTANT_MESSAGES),
  /** The draft as the user currently sees it, so a revision edits rather than restarts. */
  draft: campaignDraftSchema.nullable().optional(),
  language: assistantLanguageSchema.default("fr")
});
export type CampaignAssistantTurnRequest = z.infer<
  typeof campaignAssistantTurnRequestSchema
>;

export interface CampaignAssistantTurnResponse {
  /** The assistant's chat reply, Markdown, short. */
  reply: string;
  /** The full draft after this turn, or null when the assistant only asked a question. */
  draft: CampaignDraft | null;
}

// ── Contact assistant ─────────────────────────────────────────────────────────────────

export const contactConfidenceSchema = z.enum(["high", "medium", "low"]);
export type ContactConfidence = z.infer<typeof contactConfidenceSchema>;

/** The contact fields an extraction may fill. Every one optional: a business card has no birthday. */
export const CONTACT_CANDIDATE_FIELDS = [
  "firstName",
  "lastName",
  "displayName",
  "email2",
  "homePhone",
  "businessPhone",
  "mobilePhone",
  "homeStreet",
  "homeAddress2",
  "homeCity",
  "homePostalCode",
  "homeCountry",
  "businessAddress",
  "businessAddress2",
  "businessCity",
  "businessState",
  "businessPostalCode",
  "businessCountry",
  "organization",
  "notes",
  "birthday"
] as const;
export type ContactCandidateField = (typeof CONTACT_CANDIDATE_FIELDS)[number];
export type ContactCandidateFields = Partial<
  Pick<Contact, ContactCandidateField>
>;

/** What the review step shows about a contact that is already in the address book. */
export interface ExistingContactSummary {
  firstName?: string;
  lastName?: string;
  status: ContactStatus;
  groups: string[];
}

/** One contact the extractor found, as the review step shows it. */
export interface ContactCandidate extends ContactCandidateFields {
  /** Stable key for the review list; not a database id. */
  id: string;
  /** Empty when none was readable. The review step makes the user type one. */
  email: string;
  /** Existing groups the source named, matched case-insensitively on name. */
  groupIds: string[];
  /** Group names the source named that match no existing group; created on confirm. */
  newGroupNames: string[];
  confidence: ContactConfidence;
  /** What to check before creating, in the user's language: an unreadable digit, a guessed domain. */
  issues: string[];
  /** A contact with this email already exists. Shown, not created. */
  existing: boolean;
  /** Who that is, when `existing`; null otherwise. */
  existingContact: ExistingContactSummary | null;
}

export const contactAssistantExtractFieldsSchema = z.object({
  text: z.string().max(MAX_ASSISTANT_TEXT_CHARS).optional(),
  language: assistantLanguageSchema.default("fr")
});
export type ContactAssistantExtractFields = z.infer<
  typeof contactAssistantExtractFieldsSchema
>;

/**
 * The confirmed candidates. Same validation as the ordinary create endpoint, but written
 * conditionally: a row that already exists is reported, never replaced.
 */
export const contactAssistantCreateRequestSchema = z.object({
  // Items are validated one by one server-side (createContactRequestSchema), so one bad row is
  // reported in `errors` instead of rejecting the whole batch.
  contacts: z.array(z.unknown()).min(1).max(100),
  /** "admin" from the assistant dialog, "import" from the archive and CSV import. */
  source: z.enum(["admin", "import"]).default("admin")
});
export type ContactAssistantCreateRequest = z.infer<
  typeof contactAssistantCreateRequestSchema
>;

export interface ContactAssistantCreateResponse {
  created: Contact[];
  /** Lowercase emails that already had a contact and were left untouched. */
  existing: string[];
  errors: { email: string; reason: string }[];
}

export interface ContactAssistantExtractResponse {
  candidates: ContactCandidate[];
  /** What speech-to-text heard, when the source was a recording; shown so a misheard name is caught. */
  transcript: string | null;
  /** One sentence on what was found, in the user's language. */
  summary: string;
  /** Union of the candidates' newGroupNames, de-duplicated, in first-seen order. */
  newGroupNames: string[];
}
