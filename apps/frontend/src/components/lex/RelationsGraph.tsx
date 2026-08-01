import { useMemo, useState } from "react";
import { Info, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  edgeStrength,
  maxEdgeWeight,
  radialLayout,
  type RelationEdge,
  type RelationGraph,
  type RelationNode
} from "@/lib/documentInsights";
import { cn } from "@/lib/utils";

/**
 * The CO-MENTION graph: people from key_names as nodes, links between people named in the same
 * documents.
 *
 * *** WHAT THIS VIEW MUST NEVER IMPLY ***
 * key_names proves one thing only: two names occur in the same file. It says nothing about who
 * transmitted what to whom — and in a succession dispute between five siblings, who gave or
 * bequeathed what is the fact that decides the shares. So there is deliberately no <marker>, no
 * arrowhead, no source/target styling asymmetry and no verb: every label reads "cités ensemble dans
 * N documents". RelationEdge.source/target are alphabetical, present only so each unordered pair is
 * emitted once. Directed transmissions require the page-level extraction pass, which has not run —
 * and the disclaimer sits ABOVE the diagram, not under it, because a screen reader meets the picture
 * in document order and the warning is worthless after the inference it exists to prevent.
 *
 * *** WHY ONE PERSON'S LINKS AT A TIME (the ego model) ***
 * Drawing every pair at once was measured on the real corpus and does not work: 12 people yield 58
 * of the 66 possible edges (88% density), 42% of the disc becomes ink, and the invisible click
 * targets needed to make 2px lines clickable covered 95% of the interior — so 29 of 58 edges
 * selected a DIFFERENT pair when clicked at their own midpoint. Seven siblings in one estate all
 * co-occur; a pairwise diagram of that is a hairball whose links lie about which pair they are.
 *
 * So: no links until a person is chosen, then only that person's. That is at most 11 lines from a
 * single point, which cannot be confused for one another — and links are never click targets at all.
 * The PEER NODE carries the pair, so there are always exactly as many hit targets as there are
 * people, each one a circle you can actually hit.
 *
 * Plain SVG on purpose: the bundle is already ~1.7 MB and d3/react-flow/cytoscape would add to it
 * for a 12-node picture. The layout is the deterministic radial one from documentInsights — a force
 * simulation would settle differently on every mount, so a view she returns to across sessions would
 * never look the same twice and nothing could be found where she left it.
 */

/** What the parent is currently filtering the document list by. */
export type RelationSelection =
  | { kind: "node"; id: string }
  | { kind: "edge"; source: string; target: string };

// The layout's coordinate box. Labels sit OUTSIDE it, which is what GUTTER buys. Measured against
// the real corpus: "Xavier de Thibault de Boesinghe" needs ~172 user units in Inter, so 104 clipped
// its first three glyphs — and because these labels are right-anchored on the left half, clipping
// eats the START of a name. A truncated party name in a case file is a wrong name, so the gutter is
// sized to the longest name the corpus actually contains rather than to a guess.
const SIZE = 420;
const GUTTER = 190;

/** The id of the person whose links are shown, for either selection shape. */
function focusPersonId(selection: RelationSelection | null): string | null {
  if (!selection) return null;
  return selection.kind === "node" ? selection.id : selection.source;
}

export default function RelationsGraph({
  graph,
  selection,
  onSelectNode,
  onSelectEdge,
  onClear
}: {
  graph: RelationGraph;
  selection: RelationSelection | null;
  onSelectNode: (node: RelationNode) => void;
  onSelectEdge: (edge: RelationEdge) => void;
  onClear: () => void;
}) {
  const { t } = useLanguage();
  const d = t.lex.docsView;
  // SVG <g> does not take a visible focus ring from Tailwind's focus-visible utilities reliably
  // across browsers, so focus is tracked and drawn as a real circle. 12 keyboard stops with no
  // visible focus would be 12 places a keyboard user is lost.
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const layout = useMemo(() => radialLayout(graph.nodes, SIZE), [graph.nodes]);
  const maxWeight = useMemo(() => maxEdgeWeight(graph.edges), [graph.edges]);

  const focusId = focusPersonId(selection);
  // radialLayout returns geometry only ({id,x,y,r}); the display name lives on the graph node.
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of graph.nodes) map.set(node.id, node.name);
    return map;
  }, [graph.nodes]);
  /** Peer id -> the edge joining it to the focused person, and its weight. */
  const peers = useMemo(() => {
    const map = new Map<string, RelationEdge>();
    if (!focusId) return map;
    for (const edge of graph.edges) {
      if (edge.source === focusId) map.set(edge.target, edge);
      else if (edge.target === focusId) map.set(edge.source, edge);
    }
    return map;
  }, [graph.edges, focusId]);

  /** The pair currently filtering the list, if the selection is a pair. */
  const pairPeerId = selection?.kind === "edge" ? selection.target : null;

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-serif font-semibold">{d.relationsTitle}</h3>
        {/* "noms" not "personnes": totalPeople counts distinct key_names strings, and on the real
            corpus those 174 include "Générale de Banque", "Crédit Agricole" and bare fragments like
            "PIRSON". Calling them people would be a count of something this data does not hold. */}
        <p className="text-xs text-muted-foreground mt-0.5">
          {d.relationsPeopleShown
            .replace("{shown}", String(graph.nodes.length))
            .replace("{total}", String(graph.totalPeople))}
        </p>
      </div>
      {selection ? (
        <button
          onClick={onClear}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
        >
          <X className="h-3 w-3" />
          {d.clearGraphFilter}
        </button>
      ) : null}
    </div>
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 space-y-3">
        {header}
        <p className="text-sm text-muted-foreground">{d.relationsEmpty}</p>
      </div>
    );
  }

  const focusName = focusId ? (nameById.get(focusId) ?? null) : null;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      {header}

      {/* Before the diagram, for both sighted and screen readers — see the header comment. */}
      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 rounded-lg border border-dashed p-2.5">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>{d.relationsDisclaimer}</span>
      </p>

      <p className="text-[11px] text-muted-foreground">
        {focusName
          ? d.relationsFocusHint.replace("{name}", focusName)
          : d.relationsPickHint}
      </p>

      <svg
        viewBox={`${-GUTTER} 0 ${SIZE + 2 * GUTTER} ${SIZE}`}
        className="w-full h-auto select-none"
        role="group"
        aria-label={d.relationsTitle}
      >
        {/* Only the focused person's links, and they are decoration: no pointer events, no tab
            stop, no aria-label. The peer circle is the control. */}
        {focusId ? (
          <g className="text-muted-foreground" pointerEvents="none">
            {[...peers.entries()].map(([peerId, edge]) => {
              const a = layout.byId[focusId];
              const b = layout.byId[peerId];
              if (!a || !b) return null;
              const strength = edgeStrength(edge.weight, maxWeight);
              const isPair = peerId === pairPeerId;
              return (
                <line
                  key={peerId}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="currentColor"
                  strokeWidth={1 + strength * 3}
                  strokeOpacity={isPair ? 0.85 : 0.2 + strength * 0.4}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
        ) : null}

        {graph.nodes.map((node) => {
          const placed = layout.byId[node.id];
          const isFocus = node.id === focusId;
          const peerEdge = peers.get(node.id);
          const isPair = node.id === pairPeerId;
          // With someone chosen, anyone they never appear beside is dimmed — that absence is itself
          // information ("these two are never in the same document").
          const dimmed = focusId !== null && !isFocus && !peerEdge;

          const dx = placed.x - layout.center.x;
          const dy = placed.y - layout.center.y;
          const sideways = Math.abs(dx) > 2;
          const anchor = sideways ? (dx > 0 ? "start" : "end") : "middle";
          const labelX = sideways
            ? placed.x + (dx > 0 ? placed.r + 6 : -(placed.r + 6))
            : placed.x;
          const labelY = sideways
            ? placed.y + 4
            : placed.y + (dy < 0 ? -(placed.r + 8) : placed.r + 16);

          // A peer's number is the SHARED count while someone is chosen, because that is the
          // question being asked of it; otherwise it is the person's own document count.
          const shownCount = peerEdge ? peerEdge.weight : node.documentCount;
          const label = peerEdge
            ? d.coMentionPair
                .replace("{a}", focusName ?? "")
                .replace("{b}", node.name)
                .replace("{count}", String(peerEdge.weight))
            : `${node.name} — ${d.namedIn.replace("{count}", String(node.documentCount))}`;

          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={isFocus || isPair}
              onFocus={() => setFocusedId(node.id)}
              onBlur={() => setFocusedId(null)}
              onClick={() =>
                peerEdge ? onSelectEdge(peerEdge) : onSelectNode(node)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (peerEdge) onSelectEdge(peerEdge);
                  else onSelectNode(node);
                }
              }}
              className={cn(
                "cursor-pointer outline-none",
                isFocus || isPair ? "text-primary" : "text-muted-foreground"
              )}
              opacity={dimmed ? 0.35 : 1}
            >
              <title>{label}</title>
              {focusedId === node.id ? (
                <circle
                  cx={placed.x}
                  cy={placed.y}
                  r={placed.r + 4}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  className="text-foreground"
                />
              ) : null}
              <circle
                cx={placed.x}
                cy={placed.y}
                r={placed.r}
                fill="currentColor"
                fillOpacity={isFocus || isPair ? 0.9 : 0.5}
                stroke="currentColor"
                strokeWidth={isFocus || isPair ? 2 : 1}
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor={anchor}
                className={cn(
                  "text-[10px]",
                  isFocus || isPair
                    ? "fill-foreground font-medium"
                    : "fill-muted-foreground"
                )}
              >
                {node.name}
                <tspan className="fill-muted-foreground">
                  {` (${shownCount})`}
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>

      <p className="text-[11px] text-muted-foreground">{d.relationsLegend}</p>
    </div>
  );
}
