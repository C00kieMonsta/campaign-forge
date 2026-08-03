// The assistant cites sources inline as [1], [2], … (see the chat system prompt). Plain markdown
// renders those as literal text; this plugin turns each one into a <cite data-cite="n"> element
// so the UI can style it as a superscript chip and show which document it points at.
//
// Structurally typed against mdast rather than depending on @types/mdast: we only ever touch
// `type`, `value`, `children` and `data`.

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

const MARKER = /\[(\d+)\]/g;

// Markers inside code must stay literal — a code sample containing [1] is not a citation.
const OPAQUE = new Set(["code", "inlineCode"]);

/**
 * Builds the cite node. `emphasis` is used as the carrier because mdast-util-to-hast honours
 * `data.hName`/`data.hProperties` to override the emitted element, and emphasis is a standard
 * inline container with children — so this survives without any custom-node plumbing.
 */
function citeNode(index: number): MdNode {
  return {
    type: "emphasis",
    data: {
      hName: "cite",
      hProperties: { "data-cite": String(index) }
    },
    children: [{ type: "text", value: `[${index}]` }]
  };
}

/** Splits one text node into alternating text and cite nodes. Returns null when no marker. */
function splitText(node: MdNode, known: ReadonlySet<number>): MdNode[] | null {
  const value = node.value ?? "";
  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;
  const out: MdNode[] = [];

  while ((match = MARKER.exec(value)) !== null) {
    const index = Number(match[1]);
    // Only markers with a citation behind them become chips: the model occasionally writes a
    // bracketed number that is not a source (a date range, an article number), and a chip that
    // opens nothing is worse than plain text.
    if (!known.has(index)) continue;
    if (match.index > cursor) {
      out.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    out.push(citeNode(index));
    cursor = match.index + match[0].length;
  }

  if (out.length === 0) return null;
  if (cursor < value.length) {
    out.push({ type: "text", value: value.slice(cursor) });
  }
  return out;
}

function walk(node: MdNode | undefined, known: ReadonlySet<number>): void {
  if (!node?.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (OPAQUE.has(child.type)) {
      next.push(child);
      continue;
    }
    if (child.type === "text") {
      const split = splitText(child, known);
      if (split) {
        next.push(...split);
        continue;
      }
      next.push(child);
      continue;
    }
    walk(child, known);
    next.push(child);
  }
  node.children = next;
}

/**
 * A unified/remark PLUGIN: it takes options and returns the transformer. Register it in the tuple
 * form — `[remarkCitationMarkers, { indexes }]` — never pre-invoked, or unified calls the
 * transformer itself with no arguments.
 *
 * `indexes` are the marker numbers this message actually has a citation for. A SET, not a ceiling:
 * the bound used to be `maxIndex = citations.length`, which silently assumed the markers were
 * 1..N. They are not — they are positions in the source list assembled for that one call, so an
 * assessment over a large case file cites [249] and [397] while holding a dozen citations. Every
 * one of those markers failed `index > maxIndex` and rendered as bare digits, which is precisely
 * the reference a lawyer cannot trace. Membership answers the question the ceiling was guessing at.
 *
 * Options are optional and the tree is checked, so a mis-registration degrades to "no citation
 * chips" instead of throwing inside render and blanking the conversation.
 */
export function remarkCitationMarkers(options?: {
  indexes?: Iterable<number>;
}) {
  const known = new Set(options?.indexes ?? []);
  return (tree?: MdNode): void => {
    if (known.size > 0) walk(tree, known);
  };
}
