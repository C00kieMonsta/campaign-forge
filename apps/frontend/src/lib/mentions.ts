import { PATH_SEPARATOR } from "./uploadCandidates";

// Parsing for the composer's '@' file mention. Pure so it can be tested: the caret rules have more
// edge cases than the component that uses them.
//
// NOTE ON THE WORD "MENTION". Elsewhere in this app a mention is a person or a date mentioned IN a
// document (LexDeathMention, the co-mention graph in documentInsights.ts). Here it means the '@'
// token a user types INTO the composer to point at a file. Different thing, same word.

/** An open '@' mention: where the '@' is, where the caret is, and what was typed between them. */
export interface MentionQuery {
  /** Index of the '@'. */
  start: number;
  /** The caret. */
  end: number;
  /** Text between them. May contain spaces. */
  query: string;
}

/** Longer than any filename search needs. Past this the '@' was prose. */
export const MENTION_MAX_QUERY = 64;
/**
 * Word cap on the query.
 *
 * Eight, not four, because a folder drop flattens the path into the filename with PATH_SEPARATOR
 * ("Pièces adverses › Annexe 2.pdf" is five whitespace-separated tokens once the › is counted). A
 * cap of four cut off before the user finished typing a name they could see on screen.
 */
export const MENTION_MAX_WORDS = 8;

/**
 * '@' that opens a mention: at the very start of the box, or after whitespace or an opening
 * bracket. An address inside a word (jean@cabinet.be) never opens it, because the character before
 * the '@' is a letter.
 */
const MENTION_RE = new RegExp(
  `(?:^|[\\s([{«"'])@([^\\n@]{0,${MENTION_MAX_QUERY}})$`,
  "u"
);

/** True when the caret sits in a fenced or inline code span, where '@' is text. */
function insideCode(before: string): boolean {
  if ((before.split("```").length - 1) % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return (line.split("`").length - 1) % 2 === 1;
}

export function findMention(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  if (insideCode(before)) return null;
  const match = MENTION_RE.exec(before);
  if (!match) return null;
  const query = match[1];
  // "@ " is an at-sign used as prose, not the start of a filename.
  if (query.startsWith(" ")) return null;
  // Words counted on the LAST path segment: the folder prefix is part of one filename, not a
  // sentence, so it must not spend the budget.
  const segment = query.split(PATH_SEPARATOR).pop() ?? query;
  if (segment.trim().split(/\s+/).filter(Boolean).length > MENTION_MAX_WORDS) {
    return null;
  }
  return { start: caret - query.length - 1, end: caret, query };
}

/**
 * Text and caret after picking a document for an open mention.
 *
 * The FULL filename goes in the token, not the basename. Flattened folder names recur across
 * folders, and textNamesDocument has to be an exact match for the de-duplication in buildContent.
 */
export function applyMention(
  text: string,
  mention: MentionQuery,
  filename: string
): { text: string; caret: number } {
  const token = `@${filename} `;
  return {
    text: text.slice(0, mention.start) + token + text.slice(mention.end),
    caret: mention.start + token.length
  };
}

/** Closes a token unconditionally: whitespace, or a closing bracket or quote. */
const HARD_BOUNDARY = /[\s)\]}»"']/u;
/** Closes a token only when the sentence really ends there. See endsTokenAt. */
const SOFT_BOUNDARY = /[.,;:!?]/u;
const WORD = /[\p{L}\p{N}]/u;

/**
 * True when the token that starts at `at` actually ends where the filename does.
 *
 * The subtle case is '.'. It is both how a sentence ends and how a filename carries its extension,
 * so it cannot be a boundary on its own: treating it as one made "@Annexe 2" match inside
 * "@Annexe 2.pdf". So a '.' closes the token only when what follows it is not a word character —
 * "@annexe.pdf." ends a sentence, "@Annexe 2.pdf" does not end after "2".
 */
function endsTokenAt(text: string, after: number): boolean {
  if (after >= text.length) return true;
  const ch = text[after];
  if (HARD_BOUNDARY.test(ch)) return true;
  if (!SOFT_BOUNDARY.test(ch)) return false;
  const next = text[after + 1];
  return next === undefined || !WORD.test(next);
}

/**
 * True when the message text already names this document as an @ token.
 *
 * A boundary after the token is required, not just a substring. Without it a filename that is a
 * PREFIX of the mentioned one counted as named: mentioning "@Annexe 2.pdf" would drop a separately
 * attached "Annexe 2" from the persisted reference label, even though the text never names it.
 */
export function textNamesDocument(text: string, filename: string): boolean {
  const token = `@${filename}`;
  let from = 0;
  for (;;) {
    const at = text.indexOf(token, from);
    if (at === -1) return false;
    if (endsTokenAt(text, at + token.length)) return true;
    from = at + 1;
  }
}

/**
 * Removes "@filename" tokens for the given documents from a string.
 *
 * Used for a background run's TITLE, which the backend consumes verbatim: in adverse mode the title
 * IS the party being defended, so a leading filename token would make the model defend a PDF.
 * Longest filename first, so a name that is a prefix of another cannot strip half of it.
 */
export function stripMentions(text: string, filenames: string[]): string {
  let out = text;
  for (const filename of [...filenames].sort((a, b) => b.length - a.length)) {
    out = out.split(`@${filename}`).join("");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}
