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
function splitText(node: MdNode, maxIndex: number): MdNode[] | null {
  const value = node.value ?? "";
  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;
  const out: MdNode[] = [];

  while ((match = MARKER.exec(value)) !== null) {
    const index = Number(match[1]);
    // Only bounded markers become citations: the model occasionally writes a bracketed number
    // that is not a source (a date range, an article number), and an out-of-range chip would
    // point at nothing.
    if (index < 1 || index > maxIndex) continue;
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

function walk(node: MdNode, maxIndex: number): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (OPAQUE.has(child.type)) {
      next.push(child);
      continue;
    }
    if (child.type === "text") {
      const split = splitText(child, maxIndex);
      if (split) {
        next.push(...split);
        continue;
      }
      next.push(child);
      continue;
    }
    walk(child, maxIndex);
    next.push(child);
  }
  node.children = next;
}

/**
 * remark plugin factory. `maxIndex` is the number of sources known for the message — markers
 * above it are left as plain text.
 */
export function remarkCitationMarkers({ maxIndex }: { maxIndex: number }) {
  return (tree: MdNode): void => {
    if (maxIndex > 0) walk(tree, maxIndex);
  };
}
