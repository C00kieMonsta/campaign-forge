import {
  MAX_ASSISTANT_MESSAGES,
  type AssistantMessage,
  type CampaignDraft
} from "@packages/types";

const STORAGE_KEY = "campaign_assistant_session";
const VERSION = 1;

export interface CampaignAssistantSession {
  messages: AssistantMessage[];
  draft: CampaignDraft | null;
}

interface StoredSession extends CampaignAssistantSession {
  version: number;
}

/**
 * The chat and its draft survive a reload within the tab, nothing more. sessionStorage, not
 * localStorage: a half-written campaign from last week should not greet the next visit.
 */
export function loadCampaignAssistantSession(): CampaignAssistantSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession> | null;
    if (!parsed || parsed.version !== VERSION) return null;
    if (!Array.isArray(parsed.messages)) return null;
    return { messages: parsed.messages, draft: parsed.draft ?? null };
  } catch {
    return null;
  }
}

export function saveCampaignAssistantSession(
  session: CampaignAssistantSession
): void {
  try {
    const stored: StoredSession = {
      version: VERSION,
      messages: session.messages,
      draft: session.draft
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage full or blocked: the chat still works for this page view.
  }
}

export function clearCampaignAssistantSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Keeps the most recent `max` messages, oldest dropped first. */
export function trimHistory(
  messages: AssistantMessage[],
  max = MAX_ASSISTANT_MESSAGES
): AssistantMessage[] {
  if (max <= 0) return [];
  if (messages.length <= max) return messages;
  return messages.slice(messages.length - max);
}
