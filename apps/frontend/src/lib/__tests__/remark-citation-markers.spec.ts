import { remarkCitationMarkers } from "../remark-citation-markers";

// Minimal mdast shapes — the plugin is structurally typed and touches only these fields, so the
// tests build trees directly rather than pulling in remark-parse (which is ESM-only).
interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: Record<string, unknown>;
}

const paragraph = (text: string): Node => ({
  type: "root",
  children: [{ type: "paragraph", children: [{ type: "text", value: text }] }]
});

/** Every cite node in the tree, with the marker index it carries. */
function cites(node: Node | undefined, found: string[] = []): string[] {
  if (node?.data?.hName === "cite") {
    const props = node.data.hProperties as Record<string, string>;
    found.push(props["data-cite"]);
  }
  for (const child of node?.children ?? []) cites(child, found);
  return found;
}

function textOf(node: Node | undefined, out: string[] = []): string[] {
  if (node?.type === "text" && node.value !== undefined) out.push(node.value);
  for (const child of node?.children ?? []) textOf(child, out);
  return out;
}

describe("remarkCitationMarkers", () => {
  // A unified plugin is (options) => transformer. Registering it PRE-INVOKED made unified call the
  // transformer itself with no arguments, so `tree` was undefined and the throw unmounted the
  // whole conversation view. This is that regression.
  it("is a plugin factory: calling it yields a transformer, and the transformer tolerates no tree", () => {
    const transform = remarkCitationMarkers({ maxIndex: 2 });
    expect(typeof transform).toBe("function");
    expect(() => transform(undefined)).not.toThrow();
    expect(() => remarkCitationMarkers()(undefined)).not.toThrow();
  });

  it("turns in-range markers into cite nodes", () => {
    const tree = paragraph("La créance est établie [1] et contestée [2].");
    remarkCitationMarkers({ maxIndex: 2 })(tree);
    expect(cites(tree)).toEqual(["1", "2"]);
  });

  // The model sometimes writes a bracketed number that is not a source — an article number, a date
  // range. A chip pointing at nothing is worse than plain text.
  it("leaves out-of-range markers as plain text", () => {
    const tree = paragraph("Voir [9] et [1].");
    remarkCitationMarkers({ maxIndex: 2 })(tree);
    expect(cites(tree)).toEqual(["1"]);
    expect(textOf(tree).join("")).toContain("[9]");
  });

  it("does nothing when there are no known sources", () => {
    const tree = paragraph("Rien à citer [1].");
    remarkCitationMarkers({ maxIndex: 0 })(tree);
    expect(cites(tree)).toEqual([]);
    expect(textOf(tree).join("")).toBe("Rien à citer [1].");
  });

  // A code sample containing [1] is not a citation.
  it("never rewrites markers inside code", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "run " },
            { type: "inlineCode", value: "arr[1]" },
            { type: "text", value: " then [1]" }
          ]
        }
      ]
    };
    remarkCitationMarkers({ maxIndex: 1 })(tree);
    expect(cites(tree)).toEqual(["1"]);
    // The code node survives untouched, brackets and all.
    const code = tree.children![0].children!.find(
      (c) => c.type === "inlineCode"
    );
    expect(code?.value).toBe("arr[1]");
  });

  it("preserves the surrounding text exactly", () => {
    const tree = paragraph("Avant [1] après.");
    remarkCitationMarkers({ maxIndex: 1 })(tree);
    // "Avant ", "[1]" (inside the cite), " après." — concatenating all text restores the original.
    expect(textOf(tree).join("")).toBe("Avant [1] après.");
  });

  it("handles several markers in one run of text", () => {
    const tree = paragraph("[1][2][3]");
    remarkCitationMarkers({ maxIndex: 3 })(tree);
    expect(cites(tree)).toEqual(["1", "2", "3"]);
  });

  it("recurses into nested nodes such as list items and emphasis", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [
                    {
                      type: "emphasis",
                      children: [{ type: "text", value: "point [1]" }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
    remarkCitationMarkers({ maxIndex: 1 })(tree);
    expect(cites(tree)).toEqual(["1"]);
  });
});
