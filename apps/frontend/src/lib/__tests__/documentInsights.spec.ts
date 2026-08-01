import type { InsightDocument } from "../documentInsights";
import {
  buildKeyEvents,
  buildRelationGraph,
  countByShelf,
  countTagFrequencies,
  deselect,
  edgeStrength,
  filterDocuments,
  filterKeyEventsByPerson,
  firstSentence,
  groupByYear,
  isArchived,
  matchesDocumentQuery,
  maxEdgeWeight,
  nextSelection,
  normalizePersonName,
  pickDocumentsByIds,
  radialLayout,
  rankTagsByDistinctiveness,
  rankTagsWithFrequencies,
  resolveSelectionRange,
  selectionSummary,
  yearOf
} from "../documentInsights";

// The fixtures use this case file's real shapes: a succession dispute among five Pirson siblings,
// where "succession" is on half the corpus and the names recur across almost every filing.

let counter = 0;
function doc(over: Partial<InsightDocument> = {}): InsightDocument {
  counter += 1;
  return {
    id: `d${counter}`,
    filename: `piece-${counter}.pdf`,
    timelineDate: null,
    summary: null,
    lifecycleState: "active",
    parseStatus: "ready",
    tags: [],
    keyNames: [],
    ...over
  };
}

describe("rankTagsByDistinctiveness", () => {
  // The measured motivation: "succession" sits on 28 of 55 documents and "Belgique" on 21, so
  // rendering tags in the document's own order mostly repeats what every other card says.
  it("ranks a tag carried by most of the corpus below a rare one", () => {
    const corpus = [
      ...Array.from({ length: 8 }, () => doc({ tags: ["succession"] })),
      doc({ tags: ["succession", "donations"] }),
      doc({ tags: ["succession", "donations"] })
    ];
    const target = corpus[8];
    expect(rankTagsByDistinctiveness(corpus, target, 5)).toEqual([
      "donations",
      "succession"
    ]);
  });

  it("caps at the limit and keeps the rarest tags", () => {
    const corpus = [
      doc({ tags: ["succession", "Belgique", "notaire", "usufruit"] }),
      doc({ tags: ["succession", "Belgique", "notaire"] }),
      doc({ tags: ["succession", "Belgique"] }),
      doc({ tags: ["succession"] })
    ];
    expect(rankTagsByDistinctiveness(corpus, corpus[0], 2)).toEqual([
      "usufruit",
      "notaire"
    ]);
  });

  it("returns nothing when the limit leaves no room", () => {
    const corpus = [doc({ tags: ["succession"] })];
    expect(rankTagsByDistinctiveness(corpus, corpus[0], 0)).toEqual([]);
  });

  // A row that reorders its own tags between two renders looks like broken data.
  it("breaks ties on the document's own order, identically on every call", () => {
    const corpus = [
      doc({ tags: ["liquidation", "usufruit"] }),
      doc({ tags: ["succession"] }),
      doc({ tags: ["succession"] })
    ];
    const once = rankTagsByDistinctiveness(corpus, corpus[0], 5);
    const twice = rankTagsByDistinctiveness(corpus, corpus[0], 5);
    expect(once).toEqual(["liquidation", "usufruit"]);
    expect(twice).toEqual(once);
  });

  it("shows a tag in the document's own spelling", () => {
    const corpus = [doc({ tags: ["Tribunal de la famille"] })];
    expect(rankTagsByDistinctiveness(corpus, corpus[0], 3)).toEqual([
      "Tribunal de la famille"
    ]);
  });

  it("never repeats a tag a document carries twice", () => {
    const corpus = [doc({ tags: ["succession", "succession"] })];
    expect(rankTagsByDistinctiveness(corpus, corpus[0], 5)).toEqual([
      "succession"
    ]);
  });

  it("treats a tag the corpus has not seen as being on one document, not zero", () => {
    const frequencies = new Map([["succession", 1]]);
    // Both count as 1, so neither may jump the other: document order decides.
    expect(
      rankTagsWithFrequencies(frequencies, ["succession", "inconnu"], 5)
    ).toEqual(["succession", "inconnu"]);
  });
});

describe("countTagFrequencies", () => {
  it("counts documents, not occurrences", () => {
    const counts = countTagFrequencies([
      doc({ tags: ["succession", "succession"] }),
      doc({ tags: ["succession"] })
    ]);
    expect(counts.get("succession")).toBe(2);
  });

  // Otherwise the odd document tagged "Succession" would look like a rare, distinctive tag.
  it("folds case and stray whitespace so one label is one count", () => {
    const counts = countTagFrequencies([
      doc({ tags: ["Succession"] }),
      doc({ tags: [" succession "] }),
      doc({ tags: ["succession"] })
    ]);
    expect(counts.get("succession")).toBe(3);
    expect(counts.size).toBe(1);
  });

  it("ignores an empty tag", () => {
    const counts = countTagFrequencies([doc({ tags: ["", "  ", "notaire"] })]);
    expect(Array.from(counts.keys())).toEqual(["notaire"]);
  });
});

describe("groupByYear", () => {
  it("groups the chronology by year, preserving the incoming order", () => {
    const docs = [
      doc({ id: "a", timelineDate: "1995-03-04" }),
      doc({ id: "b", timelineDate: "1995-11-20" }),
      doc({ id: "c", timelineDate: "2019-01-08" })
    ];
    const grouping = groupByYear(docs);
    expect(
      grouping.groups.map((g) => (g.kind === "year" ? g.year : "-"))
    ).toEqual(["1995", "2019"]);
    expect(grouping.groups[0].documents.map((d) => d.id)).toEqual(["a", "b"]);
  });

  // A piece with no extracted date must stay reachable. The undated group is one of `groups`, so a
  // caller that maps over them renders it whether they remembered it or not.
  it("keeps an undated document in its own marked group at the end", () => {
    const docs = [
      doc({ id: "dated", timelineDate: "2021-06-01" }),
      doc({ id: "orphan", timelineDate: null })
    ];
    const grouping = groupByYear(docs);
    const last = grouping.groups[grouping.groups.length - 1];
    expect(last.kind).toBe("undated");
    expect(last.documents.map((d) => d.id)).toEqual(["orphan"]);
    expect(grouping.undatedCount).toBe(1);
  });

  it("loses no document: the groups always add up to the total", () => {
    const docs = [
      doc({ timelineDate: "1954-02-02" }),
      doc({ timelineDate: null }),
      doc({ timelineDate: "2024-04-04" }),
      doc({ timelineDate: "2024-05-05" }),
      doc({ timelineDate: null })
    ];
    const grouping = groupByYear(docs);
    const grouped = grouping.groups.reduce(
      (sum, group) => sum + group.documents.length,
      0
    );
    expect(grouping.total).toBe(5);
    expect(grouped).toBe(5);
  });

  it("omits the undated group when every document is dated", () => {
    const grouping = groupByYear([doc({ timelineDate: "2020-01-01" })]);
    expect(grouping.groups.every((g) => g.kind === "year")).toBe(true);
    expect(grouping.undatedCount).toBe(0);
  });

  it("opens one rail per year even if a document arrives out of order", () => {
    const docs = [
      doc({ id: "a", timelineDate: "1995-01-01" }),
      doc({ id: "b", timelineDate: "2019-01-01" }),
      doc({ id: "c", timelineDate: "1995-12-31" })
    ];
    const grouping = groupByYear(docs);
    expect(grouping.groups).toHaveLength(2);
    expect(grouping.groups[0].documents.map((d) => d.id)).toEqual(["a", "c"]);
  });

  // Filing an unreadable date under year 0 would put it at the head of the chronology, which is a
  // claim about the case. Undated is the honest answer.
  it("treats a date it cannot read a year from as undated", () => {
    const grouping = groupByYear([
      doc({ id: "junk", timelineDate: "sans date" }),
      doc({ id: "empty", timelineDate: "" })
    ]);
    expect(grouping.groups).toHaveLength(1);
    expect(grouping.groups[0].kind).toBe("undated");
    expect(grouping.undatedCount).toBe(2);
  });

  it("has nothing to group when there are no documents", () => {
    expect(groupByYear([])).toEqual({ groups: [], undatedCount: 0, total: 0 });
  });

  it("reads the year off a date-only string", () => {
    expect(yearOf({ timelineDate: "2019-01-08" })).toBe("2019");
    expect(yearOf({ timelineDate: null })).toBeNull();
  });
});

describe("buildRelationGraph", () => {
  const noCaps = { maxNodes: 100, minEdgeWeight: 1, minNodeDocuments: 1 };

  // An undirected pair emitted twice would draw two lines and double-count the relationship — and
  // a second, reversed entry is exactly what invites reading one of them as a direction.
  it("emits a co-mention once, never once per direction", () => {
    const graph = buildRelationGraph(
      [
        doc({ id: "d1", keyNames: ["Monique Pirson", "Jacques Pirson"] }),
        doc({ id: "d2", keyNames: ["Jacques Pirson", "Monique Pirson"] })
      ],
      noCaps
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: "jacques pirson",
      target: "monique pirson",
      sourceName: "Jacques Pirson",
      targetName: "Monique Pirson",
      weight: 2
    });
    // Whichever orientation was chosen, the reverse must not also be present.
    const pairs = graph.edges.map((e) => `${e.source}|${e.target}`);
    expect(pairs).not.toContain("monique pirson|jacques pirson");
  });

  it("sizes a node by how many documents name the person", () => {
    const graph = buildRelationGraph(
      [
        doc({ id: "d1", keyNames: ["Monique Pirson", "Andre Pirson"] }),
        doc({ id: "d2", keyNames: ["Monique Pirson"] }),
        doc({ id: "d3", keyNames: ["Monique Pirson"] })
      ],
      noCaps
    );
    expect(graph.nodes.map((n) => [n.name, n.documentCount])).toEqual([
      ["Monique Pirson", 3],
      ["Andre Pirson", 1]
    ]);
  });

  it("counts a person once per document even when key_names repeats them", () => {
    const graph = buildRelationGraph(
      [doc({ id: "d1", keyNames: ["Monique Pirson", "Monique  Pirson"] })],
      noCaps
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].documentCount).toBe(1);
    expect(graph.edges).toHaveLength(0);
  });

  // 12 recurring people over 55 documents is 66 possible edges: a hairball that says nothing.
  it("keeps only the top N people by document count", () => {
    const graph = buildRelationGraph(
      [
        doc({ id: "d1", keyNames: ["Monique Pirson", "Jacques Pirson"] }),
        doc({ id: "d2", keyNames: ["Monique Pirson", "Jacques Pirson"] }),
        doc({ id: "d3", keyNames: ["Monique Pirson", "Francois Kumps"] })
      ],
      { maxNodes: 2, minEdgeWeight: 1, minNodeDocuments: 1 }
    );
    expect(graph.nodes.map((n) => n.name)).toEqual([
      "Monique Pirson",
      "Jacques Pirson"
    ]);
    expect(graph.totalPeople).toBe(3);
    expect(graph.omittedNodeCount).toBe(1);
  });

  it("never emits an edge to a person the cap dropped", () => {
    const graph = buildRelationGraph(
      [
        doc({ id: "d1", keyNames: ["Monique Pirson", "Francois Kumps"] }),
        doc({ id: "d2", keyNames: ["Monique Pirson"] })
      ],
      { maxNodes: 1, minEdgeWeight: 1, minNodeDocuments: 1 }
    );
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(graph.nodes).toHaveLength(1);
    for (const edge of graph.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it("drops co-mentions below the minimum weight and says how many", () => {
    const graph = buildRelationGraph(
      [
        doc({ id: "d1", keyNames: ["Monique Pirson", "Jacques Pirson"] }),
        doc({ id: "d2", keyNames: ["Monique Pirson", "Jacques Pirson"] }),
        doc({ id: "d3", keyNames: ["Monique Pirson", "Robert Pirson"] })
      ],
      { maxNodes: 10, minEdgeWeight: 2, minNodeDocuments: 1 }
    );
    expect(graph.edges.map((e) => e.weight)).toEqual([2]);
    expect(graph.omittedEdgeCount).toBe(1);
  });

  it("drops a person named in too few documents", () => {
    const graph = buildRelationGraph(
      [
        doc({ id: "d1", keyNames: ["Monique Pirson", "Un Passant"] }),
        doc({ id: "d2", keyNames: ["Monique Pirson"] })
      ],
      { maxNodes: 10, minEdgeWeight: 1, minNodeDocuments: 2 }
    );
    expect(graph.nodes.map((n) => n.name)).toEqual(["Monique Pirson"]);
    expect(graph.omittedNodeCount).toBe(1);
  });

  // Normalising whitespace is safe; deciding that two spellings are one person is not. In a dispute
  // between five siblings sharing a surname, a wrong merge invents someone's involvement in a file.
  // Measured on the real corpus: the summarizer emits both "Monique PIRSON" and "Monique Pirson"
  // (38 documents between them), and "Étienne"/"Etienne"/"Etienne PIRSON" (24). Left unfolded, the
  // variants were separate nodes AND then dropped by the top-12 cap, so the headline count was
  // simply wrong with nothing on screen admitting it.
  it("folds case and accents, and shows the spelling the documents use most", () => {
    const graph = buildRelationGraph(
      [
        doc({ id: "d1", keyNames: ["Monique Pirson", "Étienne Pirson"] }),
        doc({ id: "d2", keyNames: ["Monique PIRSON", "Etienne Pirson"] }),
        doc({ id: "d3", keyNames: ["Monique Pirson", "Etienne PIRSON"] })
      ],
      noCaps
    );
    expect(graph.totalPeople).toBe(2);
    const monique = graph.nodes.find((n) => n.id === "monique pirson");
    expect(monique?.documentCount).toBe(3);
    // Two documents write "Monique Pirson" against one shouting it, so that is the label.
    expect(monique?.name).toBe("Monique Pirson");
    const etienne = graph.nodes.find((n) => n.id === "etienne pirson");
    expect(etienne?.documentCount).toBe(3);
  });

  it("refuses to merge anything beyond letter-identity", () => {
    const graph = buildRelationGraph(
      [
        doc({ id: "d1", keyNames: ["  Monique   Pirson ", "M. Pirson"] }),
        doc({ id: "d2", keyNames: ["Monique Pirson"] })
      ],
      noCaps
    );
    // "M. Pirson" could be Monique, Martin or Marc; among five siblings sharing a surname a wrong
    // merge invents someone's involvement in a filing.
    expect(graph.nodes.map((n) => n.name)).toEqual([
      "Monique Pirson",
      "M. Pirson"
    ]);
    expect(graph.totalPeople).toBe(2);
  });

  it("carries the documents behind a node and behind an edge, for click-to-filter", () => {
    const graph = buildRelationGraph(
      [
        doc({ id: "d1", keyNames: ["Monique Pirson", "Jacques Pirson"] }),
        doc({ id: "d2", keyNames: ["Monique Pirson"] }),
        doc({ id: "d3", keyNames: ["Monique Pirson", "Jacques Pirson"] })
      ],
      noCaps
    );
    const monique = graph.nodes.find((n) => n.name === "Monique Pirson");
    expect(monique?.documentIds).toEqual(["d1", "d2", "d3"]);
    expect(graph.edges[0].documentIds).toEqual(["d1", "d3"]);
  });

  it("orders tied nodes and edges deterministically", () => {
    const docs = [
      doc({ id: "d1", keyNames: ["Bernadette Pirson", "Andre Pirson"] }),
      doc({ id: "d2", keyNames: ["Etienne Pirson", "Andre Pirson"] })
    ];
    const once = buildRelationGraph(docs, noCaps);
    const twice = buildRelationGraph(docs, noCaps);
    expect(once.nodes.map((n) => n.name)).toEqual([
      "Andre Pirson",
      "Bernadette Pirson",
      "Etienne Pirson"
    ]);
    expect(twice).toEqual(once);
  });

  it("ignores a blank name", () => {
    const graph = buildRelationGraph(
      [doc({ id: "d1", keyNames: ["", "   ", "Monique Pirson"] })],
      noCaps
    );
    expect(graph.nodes.map((n) => n.name)).toEqual(["Monique Pirson"]);
  });

  it("returns an empty graph for an empty corpus", () => {
    expect(buildRelationGraph([])).toEqual({
      nodes: [],
      edges: [],
      totalPeople: 0,
      omittedNodeCount: 0,
      omittedEdgeCount: 0
    });
  });

  it("normalizePersonName trims and collapses, nothing else", () => {
    expect(normalizePersonName("  Jean-Louis   Van Boxstael ")).toBe(
      "Jean-Louis Van Boxstael"
    );
    expect(normalizePersonName("monique pirson")).toBe("monique pirson");
  });
});

describe("radialLayout", () => {
  const nodes = [
    { id: "a", name: "a", documentCount: 4, documentIds: [] },
    { id: "b", name: "b", documentCount: 2, documentIds: [] },
    { id: "c", name: "c", documentCount: 1, documentIds: [] },
    { id: "d", name: "d", documentCount: 1, documentIds: [] }
  ];

  // The user returns to this view; a force simulation would settle differently every mount.
  it("is deterministic: the same nodes give byte-identical coordinates", () => {
    expect(radialLayout(nodes, 400)).toEqual(radialLayout(nodes, 400));
  });

  it("starts the circle at twelve o'clock and goes clockwise", () => {
    const layout = radialLayout(nodes, 400);
    expect(layout.nodes[0].x).toBe(layout.center.x);
    expect(layout.nodes[0].y).toBeLessThan(layout.center.y);
    // Second of four is at three o'clock: to the right, level with the centre.
    expect(layout.nodes[1].x).toBeGreaterThan(layout.center.x);
    expect(layout.nodes[1].y).toBe(layout.center.y);
  });

  // Area, not radius: linear radius would make a 4-document person look 4x heavier than a
  // 1-document one when the eye reads roughly 16x.
  it("scales node radius by the square root of the document count", () => {
    const layout = radialLayout(nodes, 400, {
      minNodeRadius: 0,
      maxNodeRadius: 20
    });
    expect(layout.byId.a.r).toBe(20);
    expect(layout.byId.c.r).toBe(10);
    expect(layout.byId.b.r).toBeCloseTo(20 * Math.sqrt(0.5), 1);
  });

  it("keeps every node inside the viewBox", () => {
    const layout = radialLayout(nodes, 300, { padding: 10, maxNodeRadius: 30 });
    for (const node of layout.nodes) {
      expect(node.x - node.r).toBeGreaterThanOrEqual(0);
      expect(node.x + node.r).toBeLessThanOrEqual(300);
      expect(node.y - node.r).toBeGreaterThanOrEqual(0);
      expect(node.y + node.r).toBeLessThanOrEqual(300);
    }
  });

  it("puts a lone node in the centre rather than on the rim", () => {
    const layout = radialLayout([nodes[0]], 400);
    expect(layout.nodes[0].x).toBe(200);
    expect(layout.nodes[0].y).toBe(200);
  });

  it("survives an empty graph", () => {
    const layout = radialLayout([], 400);
    expect(layout.nodes).toEqual([]);
    expect(layout.byId).toEqual({});
  });

  it("indexes nodes by id so an edge is two lookups", () => {
    const layout = radialLayout(nodes, 400);
    expect(layout.byId.c).toEqual(layout.nodes[2]);
  });
});

describe("edgeStrength", () => {
  it("gives the strongest edge full weight", () => {
    expect(edgeStrength(9, 9)).toBe(1);
  });

  // A kept edge is a fact about the file; drawing it invisibly hides it.
  it("floors the weakest kept edge so it stays visible", () => {
    expect(edgeStrength(1, 40)).toBeGreaterThanOrEqual(0.15);
  });

  it("is zero when there are no edges to compare against", () => {
    expect(edgeStrength(0, 0)).toBe(0);
  });

  it("maxEdgeWeight reports the strongest co-mention", () => {
    expect(
      maxEdgeWeight([
        {
          source: "a",
          target: "b",
          sourceName: "A",
          targetName: "B",
          weight: 3,
          documentIds: []
        },
        {
          source: "a",
          target: "c",
          sourceName: "A",
          targetName: "C",
          weight: 7,
          documentIds: []
        }
      ])
    ).toBe(7);
  });
});

describe("deselect", () => {
  // The scope warning ("n masqués par le filtre") is the only thing standing between a bulk action
  // and the rows a filter hides. A selection that outlives its documents makes it cry wolf.
  it("drops ids that have left the list", () => {
    const state = { selectedIds: ["a", "b", "c"], anchorId: "b" };
    expect(deselect(state, ["b"])).toEqual({
      selectedIds: ["a", "c"],
      anchorId: null
    });
  });

  it("keeps the anchor when the anchor survives", () => {
    const state = { selectedIds: ["a", "b"], anchorId: "a" };
    expect(deselect(state, ["b"])).toEqual({
      selectedIds: ["a"],
      anchorId: "a"
    });
  });

  it("clears a stale anchor even when nothing was selected", () => {
    // A shift-click ranging from a deleted row has no defined meaning.
    const state = { selectedIds: [], anchorId: "gone" };
    expect(deselect(state, ["gone"])).toEqual({
      selectedIds: [],
      anchorId: null
    });
  });

  it("returns the same object when nothing matches, so React can skip the render", () => {
    const state = { selectedIds: ["a"], anchorId: "a" };
    expect(deselect(state, ["zzz"])).toBe(state);
  });
});

describe("filterDocuments", () => {
  // The trap: ingestion parks byte-identical duplicates at 'superseded'. Testing `!== "active"`
  // would show those as things the user archived, which she never did.
  it("keeps a superseded duplicate out of the archive shelf", () => {
    const docs = [
      doc({ id: "arch", lifecycleState: "archived" }),
      doc({ id: "dupe", lifecycleState: "superseded" }),
      doc({ id: "live", lifecycleState: "active" })
    ];
    expect(
      filterDocuments(docs, { shelf: "archived" }).map((d) => d.id)
    ).toEqual(["arch"]);
  });

  it("shows everything not archived by default, duplicates included", () => {
    const docs = [
      doc({ id: "arch", lifecycleState: "archived" }),
      doc({ id: "dupe", lifecycleState: "superseded" }),
      doc({ id: "live", lifecycleState: "active" })
    ];
    expect(filterDocuments(docs).map((d) => d.id)).toEqual(["dupe", "live"]);
  });

  // Measured on the real corpus: the un-archived list is 122 rows, of which 50 are awaiting_upload
  // presign stubs and 6 are failed parses — and those account for 56 of the 69 undated rows. Mixed
  // into the chronology they bury the 56 real documents.
  it("keeps upload stubs and failed parses out of the case file", () => {
    const docs = [
      doc({ id: "ready", parseStatus: "ready" }),
      doc({ id: "stub", parseStatus: "awaiting_upload" }),
      doc({ id: "broken", parseStatus: "failed" }),
      doc({
        id: "dupe",
        parseStatus: "duplicate",
        lifecycleState: "superseded"
      })
    ];
    expect(filterDocuments(docs).map((d) => d.id)).toEqual(["ready", "dupe"]);
    expect(
      filterDocuments(docs, { shelf: "pending" }).map((d) => d.id)
    ).toEqual(["stub", "broken"]);
  });

  it("puts an archived document on the archive shelf whatever its parse status", () => {
    // Archiving is an explicit act; a failed parse underneath does not override where she filed it.
    const docs = [
      doc({ id: "a", parseStatus: "failed", lifecycleState: "archived" })
    ];
    expect(filterDocuments(docs, { shelf: "pending" })).toEqual([]);
    expect(
      filterDocuments(docs, { shelf: "archived" }).map((d) => d.id)
    ).toEqual(["a"]);
  });

  it("places every document on exactly one shelf", () => {
    const docs = [
      doc({ parseStatus: "ready" }),
      doc({ parseStatus: "awaiting_upload" }),
      doc({ parseStatus: "failed" }),
      doc({ parseStatus: "duplicate", lifecycleState: "superseded" }),
      doc({ parseStatus: "ready", lifecycleState: "archived" })
    ];
    const counts = countByShelf(docs);
    expect(counts.case + counts.pending + counts.archived).toBe(docs.length);
    expect(counts).toEqual({ case: 2, pending: 2, archived: 1 });
  });

  it("preserves the incoming chronological order", () => {
    const docs = [
      doc({ id: "old", timelineDate: "1995-01-01", tags: ["succession"] }),
      doc({ id: "new", timelineDate: "2024-01-01", tags: ["succession"] })
    ];
    expect(
      filterDocuments(docs, { query: "succession" }).map((d) => d.id)
    ).toEqual(["old", "new"]);
  });

  it("narrows to a graph selection, and an empty id list means nothing matches", () => {
    const docs = [doc({ id: "a" }), doc({ id: "b" })];
    expect(
      filterDocuments(docs, { documentIds: ["b"] }).map((d) => d.id)
    ).toEqual(["b"]);
    expect(filterDocuments(docs, { documentIds: [] })).toEqual([]);
  });

  it("isArchived is exact, never a negation of active", () => {
    expect(isArchived({ lifecycleState: "archived" })).toBe(true);
    expect(isArchived({ lifecycleState: "superseded" })).toBe(false);
    expect(isArchived({ lifecycleState: "active" })).toBe(false);
  });
});

describe("matchesDocumentQuery", () => {
  const filing = doc({
    filename: "Requête tribunal de la famille.pdf",
    timelineDate: "2019-01-08",
    tags: ["succession", "Bruxelles"],
    keyNames: ["Monique Pirson", "Christian Mahieux"]
  });

  it("matches a filename, a party, a tag or a date", () => {
    expect(matchesDocumentQuery(filing, "requête")).toBe(true);
    expect(matchesDocumentQuery(filing, "mahieux")).toBe(true);
    expect(matchesDocumentQuery(filing, "bruxelles")).toBe(true);
    expect(matchesDocumentQuery(filing, "2019")).toBe(true);
  });

  it("matches everything when the box is empty or blank", () => {
    expect(matchesDocumentQuery(filing, "")).toBe(true);
    expect(matchesDocumentQuery(filing, "   ")).toBe(true);
  });

  it("does not match an unrelated term", () => {
    expect(matchesDocumentQuery(filing, "Anvers")).toBe(false);
  });
});

describe("pickDocumentsByIds", () => {
  it("returns the documents in list order, not in id order", () => {
    const docs = [doc({ id: "a" }), doc({ id: "b" }), doc({ id: "c" })];
    expect(pickDocumentsByIds(docs, ["c", "a"]).map((d) => d.id)).toEqual([
      "a",
      "c"
    ]);
  });
});

describe("resolveSelectionRange", () => {
  const visible = ["a", "b", "c", "d", "e"];

  it("returns the inclusive range when the target follows the anchor", () => {
    expect(resolveSelectionRange(visible, "b", "d")).toEqual(["b", "c", "d"]);
  });

  // Dragging up the list is as ordinary as dragging down.
  it("handles a target that precedes the anchor", () => {
    expect(resolveSelectionRange(visible, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("returns the single row when anchor and target are the same", () => {
    expect(resolveSelectionRange(visible, "c", "c")).toEqual(["c"]);
  });

  // The filter changed since the anchor was set. Treating indexOf's -1 as an index would select
  // everything from the top of the list — the classic shift-click bug.
  it("collapses to the clicked row when the anchor is no longer visible", () => {
    expect(resolveSelectionRange(visible, "zzz", "d")).toEqual(["d"]);
  });

  it("selects only the clicked row when there is no anchor yet", () => {
    expect(resolveSelectionRange(visible, null, "c")).toEqual(["c"]);
  });

  it("returns nothing when the clicked row is not in the visible list", () => {
    expect(resolveSelectionRange(visible, "a", "zzz")).toEqual([]);
  });

  it("returns nothing for an empty list", () => {
    expect(resolveSelectionRange([], "a", "b")).toEqual([]);
  });

  // Ranging over the raw array would sweep in documents the search is hiding — the whole reason
  // this takes the visible ids.
  it("ranges over the visible order, not the underlying corpus order", () => {
    expect(resolveSelectionRange(["e", "c", "a"], "e", "a")).toEqual([
      "e",
      "c",
      "a"
    ]);
  });
});

describe("nextSelection", () => {
  const visible = ["a", "b", "c", "d"];

  it("toggles a row on a plain click and anchors there", () => {
    const state = nextSelection(
      { selectedIds: [], anchorId: null },
      visible,
      "b"
    );
    expect(state).toEqual({ selectedIds: ["b"], anchorId: "b" });
  });

  it("toggles the same row off on a second click", () => {
    const state = nextSelection(
      { selectedIds: ["a", "b"], anchorId: "a" },
      visible,
      "b"
    );
    expect(state.selectedIds).toEqual(["a"]);
    expect(state.anchorId).toBe("b");
  });

  it("cmd/ctrl-click toggles exactly one row", () => {
    const state = nextSelection(
      { selectedIds: ["a"], anchorId: "a" },
      visible,
      "d",
      { meta: true }
    );
    expect(state.selectedIds).toEqual(["a", "d"]);
  });

  it("shift-click adds the range and keeps the anchor for the next one", () => {
    const state = nextSelection(
      { selectedIds: ["a"], anchorId: "a" },
      visible,
      "c",
      { shift: true }
    );
    expect(state.selectedIds).toEqual(["a", "b", "c"]);
    expect(state.anchorId).toBe("a");
  });

  it("shift-click never unticks something already selected", () => {
    const state = nextSelection(
      { selectedIds: ["d"], anchorId: "a" },
      visible,
      "b",
      { shift: true }
    );
    expect(state.selectedIds.sort()).toEqual(["a", "b", "d"]);
  });

  it("shift-click with a stale anchor selects only the clicked row and re-anchors", () => {
    const state = nextSelection(
      { selectedIds: [], anchorId: "gone" },
      visible,
      "c",
      { shift: true }
    );
    expect(state).toEqual({ selectedIds: ["c"], anchorId: "c" });
  });

  it("shift-click before anything was anchored behaves like a click", () => {
    const state = nextSelection(
      { selectedIds: [], anchorId: null },
      visible,
      "c",
      { shift: true }
    );
    expect(state).toEqual({ selectedIds: ["c"], anchorId: "c" });
  });
});

describe("selectionSummary", () => {
  it("reports the tri-state of the select-all checkbox", () => {
    expect(selectionSummary(["a"], ["a", "b"]).someVisibleSelected).toBe(true);
    expect(selectionSummary(["a"], ["a", "b"]).allVisibleSelected).toBe(false);
    expect(selectionSummary(["a", "b"], ["a", "b"]).allVisibleSelected).toBe(
      true
    );
    expect(selectionSummary([], ["a"]).someVisibleSelected).toBe(false);
  });

  // The safety number: rows ticked before the search changed are still selected but no longer on
  // screen, so a bulk action would reach documents she cannot see unless the bar says so.
  it("counts selected rows the current filter is hiding", () => {
    const summary = selectionSummary(["a", "hidden"], ["a", "b"]);
    expect(summary.count).toBe(2);
    expect(summary.visibleSelectedIds).toEqual(["a"]);
    expect(summary.hiddenSelectedCount).toBe(1);
  });

  it("orders the visible selection the way the list is ordered", () => {
    expect(
      selectionSummary(["c", "a"], ["a", "b", "c"]).visibleSelectedIds
    ).toEqual(["a", "c"]);
  });

  it("is not 'all selected' when nothing is visible", () => {
    expect(selectionSummary([], []).allVisibleSelected).toBe(false);
  });
});

// The safety property of the whole feature: select-all is scoped to the filter. Composing the two
// exports the view uses must never offer a document the search is hiding.
describe("select-all is scoped to the current filter", () => {
  it("offers only the filtered documents", () => {
    const docs = [
      doc({ id: "s1", tags: ["succession"] }),
      doc({ id: "d1", tags: ["donations"] }),
      doc({ id: "s2", tags: ["succession"] })
    ];
    const visibleIds = filterDocuments(docs, { query: "succession" }).map(
      (d) => d.id
    );
    expect(visibleIds).toEqual(["s1", "s2"]);
    const summary = selectionSummary(visibleIds, visibleIds);
    expect(summary.count).toBe(2);
    expect(summary.allVisibleSelected).toBe(true);
    expect(summary.visibleSelectedIds).not.toContain("d1");
  });
});

describe("firstSentence", () => {
  // French legal prose is full of "M. Pirson", "Me Mahieux", "art. 843": cutting at the first
  // period would render the whole line as "M.".
  it("does not cut at an abbreviation", () => {
    expect(
      firstSentence(
        "M. Pirson invoque l'art. 843 du Code civil. La donation est contestée."
      )
    ).toBe("M. Pirson invoque l'art. 843 du Code civil.");
  });

  it("does not cut at an initial", () => {
    expect(
      firstSentence("J. Pirson conteste le partage. Il réclame sa réserve.")
    ).toBe("J. Pirson conteste le partage.");
  });

  // A short sentence is still a sentence — this one is 39 characters, and an earlier length-based
  // guard swallowed it into the next one.
  it("keeps only the first sentence of a three-sentence summary", () => {
    expect(
      firstSentence(
        "Acte de partage devant notaire Mahieux. Les cinq héritiers y comparaissent. Le solde reste dû."
      )
    ).toBe("Acte de partage devant notaire Mahieux.");
  });

  it("truncates on a word boundary when the text never ends a sentence", () => {
    const line = firstSentence("a".repeat(30) + " " + "b".repeat(200), 40);
    expect(line.endsWith("…")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(41);
    expect(line).toBe("a".repeat(30) + "…");
  });

  it("collapses the whitespace it finds", () => {
    expect(firstSentence("  Acte   de partage  ")).toBe("Acte de partage");
  });

  it("returns nothing for an empty summary", () => {
    expect(firstSentence("")).toBe("");
    expect(firstSentence("   ")).toBe("");
  });
});

describe("buildKeyEvents", () => {
  it("emits one event per document and counts the undated ones", () => {
    const list = buildKeyEvents([
      doc({ id: "a", timelineDate: "1995-06-01" }),
      doc({ id: "b", timelineDate: null }),
      doc({ id: "c", timelineDate: "2019-01-08" })
    ]);
    expect(list.events).toHaveLength(3);
    expect(list.datedCount).toBe(2);
    expect(list.undatedCount).toBe(1);
  });

  // "pièces 1 à 12" holds several dons manuels at different dates and still shows as one point;
  // the undated ones must at least stay reachable at the end of the list.
  it("orders dated events oldest first and keeps undated ones at the end", () => {
    const list = buildKeyEvents([
      doc({ id: "undated", timelineDate: null }),
      doc({ id: "recent", timelineDate: "2024-02-02" }),
      doc({ id: "old", timelineDate: "1954-02-02" })
    ]);
    expect(list.events.map((e) => e.documentId)).toEqual([
      "old",
      "recent",
      "undated"
    ]);
  });

  it("keeps several undated documents in the order they arrived", () => {
    const list = buildKeyEvents([
      doc({ id: "u1", timelineDate: null }),
      doc({ id: "u2", timelineDate: null })
    ]);
    expect(list.events.map((e) => e.documentId)).toEqual(["u1", "u2"]);
  });

  it("reduces the summary to one line and normalises the people", () => {
    const list = buildKeyEvents([
      doc({
        id: "a",
        filename: "Donation 1995.pdf",
        timelineDate: "1995-06-01",
        summary:
          "Don manuel consenti par Monique Pirson. Le montant est contesté par les autres héritiers.",
        keyNames: ["Monique  Pirson", "Andre Pirson", "Monique Pirson"]
      })
    ]);
    expect(list.events[0].line).toBe("Don manuel consenti par Monique Pirson.");
    expect(list.events[0].people).toEqual(["Monique Pirson", "Andre Pirson"]);
    expect(list.events[0].filename).toBe("Donation 1995.pdf");
  });

  it("offers the people most mentioned first, for the person filter", () => {
    const list = buildKeyEvents([
      doc({ id: "a", keyNames: ["Monique Pirson", "Andre Pirson"] }),
      doc({ id: "b", keyNames: ["Monique Pirson"] })
    ]);
    expect(list.people).toEqual([
      { key: "monique pirson", name: "Monique Pirson", eventCount: 2 },
      { key: "andre pirson", name: "Andre Pirson", eventCount: 1 }
    ]);
  });

  // The screenshot of the real dialog listed "Bernadette PIRSON" and "Bernadette Pirson" as two
  // indistinguishable options, so choosing one returned a fraction of her filings.
  it("offers one option per person however the filings spell them", () => {
    const list = buildKeyEvents([
      doc({ id: "a", keyNames: ["Bernadette Pirson"] }),
      doc({ id: "b", keyNames: ["Bernadette PIRSON"] }),
      doc({ id: "c", keyNames: ["Étienne Pirson"] })
    ]);
    expect(list.people).toEqual([
      { key: "bernadette pirson", name: "Bernadette PIRSON", eventCount: 2 },
      { key: "etienne pirson", name: "Étienne Pirson", eventCount: 1 }
    ]);
    // ...and the filter finds both spellings from either one.
    expect(
      filterKeyEventsByPerson(list.events, "bernadette pirson").map(
        (e) => e.documentId
      )
    ).toEqual(["a", "b"]);
    expect(
      filterKeyEventsByPerson(list.events, "Bernadette Pirson").map(
        (e) => e.documentId
      )
    ).toEqual(["a", "b"]);
  });

  it("filters events to one person, and returns everything for none", () => {
    const list = buildKeyEvents([
      doc({ id: "a", keyNames: ["Monique Pirson"] }),
      doc({ id: "b", keyNames: ["Andre Pirson"] })
    ]);
    expect(
      filterKeyEventsByPerson(list.events, "Monique Pirson").map(
        (e) => e.documentId
      )
    ).toEqual(["a"]);
    expect(filterKeyEventsByPerson(list.events, null)).toHaveLength(2);
  });

  it("has no events for no documents", () => {
    expect(buildKeyEvents([])).toEqual({
      events: [],
      datedCount: 0,
      undatedCount: 0,
      people: []
    });
  });
});
