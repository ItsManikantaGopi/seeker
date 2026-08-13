"use client";

import { useMemo, useState } from "react";
import { Trie, minimize, dawgTerms, type TrieNode } from "@/lib/seeker/trie";
import { buildFst, buildOrdinalFst, intersectFstWithAutomaton } from "@/lib/seeker/fst";
import { buildBlockTree } from "@/lib/seeker/blocktree";
import { buildLevenshteinAutomaton } from "@/lib/seeker/levenshtein-automaton";
import { bruteForceFuzzy } from "@/lib/seeker/edit-distance";
import { demoDictionary, TOY_TERMS, TOY_SUFFIX_TERMS } from "@/lib/demo";
import {
  Badge,
  Bar,
  Button,
  Callout,
  EmptyState,
  Grid,
  KeyValue,
  Mono,
  Panel,
  Segmented,
  Slider,
  Stack,
  Stat,
  StatRow,
  Table,
  Td,
  TextInput,
  Toggle,
  Tr,
  formatBytes,
  percent,
} from "@/components/ui";

// ---------------------------------------------------------------------------
// Shared: a compact SVG tree renderer for tries
// ---------------------------------------------------------------------------

interface LaidOutNode {
  id: number;
  label: string;
  terminal: boolean;
  x: number;
  y: number;
}

function layoutTrie(root: TrieNode): {
  nodes: LaidOutNode[];
  edges: { from: number; to: number; label: string }[];
  width: number;
  height: number;
} {
  const nodes: LaidOutNode[] = [];
  const edges: { from: number; to: number; label: string }[] = [];
  const LEVEL_HEIGHT = 44;
  const LEAF_WIDTH = 26;
  let cursor = 0;

  function place(node: TrieNode, depth: number): number {
    const children = [...node.children.keys()].sort();
    let x: number;
    if (children.length === 0) {
      x = cursor;
      cursor += LEAF_WIDTH;
    } else {
      const childXs = children.map((ch) => {
        const child = node.children.get(ch)!;
        const childX = place(child, depth + 1);
        edges.push({ from: node.id, to: child.id, label: ch });
        return childX;
      });
      x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    }
    nodes.push({
      id: node.id,
      label: node.char === "" ? "•" : node.char,
      terminal: node.terminal,
      x,
      y: depth * LEVEL_HEIGHT + 16,
    });
    return x;
  }

  place(root, 0);
  const maxX = Math.max(...nodes.map((n) => n.x), 0);
  const maxY = Math.max(...nodes.map((n) => n.y), 0);
  return { nodes, edges, width: maxX + 30, height: maxY + 26, };
}

function TrieView({ trie, highlight = new Set<number>() }: { trie: Trie; highlight?: Set<number> }) {
  const layout = useMemo(() => layoutTrie(trie.root), [trie]);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  if (layout.nodes.length > 300) {
    return (
      <EmptyState>
        {layout.nodes.length} nodes is too many to draw legibly. Reduce the term set to see the structure.
      </EmptyState>
    );
  }

  return (
    <div className="scroll-x">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ minWidth: Math.min(layout.width, 900), height: layout.height }}
        role="img"
        aria-label="Trie structure"
      >
        {layout.edges.map((edge, i) => {
          const from = byId.get(edge.from)!;
          const to = byId.get(edge.to)!;
          const active = highlight.has(edge.from) && highlight.has(edge.to);
          return (
            <g key={i}>
              <line
                x1={from.x} y1={from.y + 9} x2={to.x} y2={to.y - 9}
                stroke={active ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={active ? 1.8 : 1}
              />
              <text
                x={(from.x + to.x) / 2 + 4}
                y={(from.y + to.y) / 2 + 3}
                fontSize="9"
                fontFamily="var(--font-mono)"
                fill={active ? "var(--accent)" : "var(--text-faint)"}
              >
                {edge.label}
              </text>
            </g>
          );
        })}
        {layout.nodes.map((node) => {
          const active = highlight.has(node.id);
          return (
            <g key={node.id}>
              <circle
                cx={node.x} cy={node.y} r={9}
                fill={active ? "var(--accent-soft)" : node.terminal ? "var(--ok-soft)" : "var(--bg-raised)"}
                stroke={active ? "var(--accent)" : node.terminal ? "var(--ok)" : "var(--border-strong)"}
                strokeWidth={node.terminal ? 1.8 : 1}
              />
              <text
                x={node.x} y={node.y + 3.5}
                textAnchor="middle" fontSize="9.5" fontFamily="var(--font-mono)"
                fill={active ? "var(--accent-text)" : "var(--text)"}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ===========================================================================
// Chapter 16 — tries
// ===========================================================================

const TERM_SETS: Record<string, string[]> = {
  "car / cat / can": TOY_TERMS,
  "car / bar": TOY_SUFFIX_TERMS,
  "kube family": ["kube", "kubelet", "kubernetes", "kubernetes-deployment", "kubernetes-service"],
  "deploy family": ["deploy", "deployed", "deploying", "deployment", "deployments"],
};

export function Ch16() {
  const dictionary = demoDictionary("title");
  const [setName, setSetName] = useState("kube family");
  const [prefix, setPrefix] = useState("kube");
  const [useFullVocab, setUseFullVocab] = useState(false);

  const terms = useFullVocab ? dictionary.sortedTerms : TERM_SETS[setName];
  const trie = useMemo(() => Trie.from(terms), [terms]);
  const walk = useMemo(() => trie.walk(prefix), [trie, prefix]);

  const highlight = useMemo(() => {
    const ids = new Set<number>();
    let node: TrieNode | undefined = trie.root;
    ids.add(node.id);
    for (const ch of prefix) {
      node = node?.children.get(ch);
      if (!node) break;
      ids.add(node.id);
    }
    return ids;
  }, [trie, prefix]);

  const search = useMemo(() => trie.prefixSearch(prefix, 40), [trie, prefix]);

  return (
    <Stack gap={4}>
      <Panel
        title="A trie stores characters along paths"
        subtitle="Shared prefixes are stored exactly once, which is what makes prefix enumeration natural instead of a scan."
        actions={
          <Toggle label="Use the full title vocabulary" checked={useFullVocab} onChange={setUseFullVocab} />
        }
      >
        <Stack gap={4}>
          {!useFullVocab && (
            <Segmented
              label="Term set"
              value={setName}
              onChange={setSetName}
              options={Object.keys(TERM_SETS).map((k) => ({ value: k, label: k }))}
            />
          )}

          <div className="flex flex-wrap gap-1">
            {terms.slice(0, 30).map((t) => <Badge key={t}>{t}</Badge>)}
            {terms.length > 30 && <Badge tone="neutral">+{terms.length - 30} more</Badge>}
          </div>

          {!useFullVocab && <TrieView trie={trie} highlight={highlight} />}

          <StatRow>
            <Stat label="terms" value={trie.termCount} />
            <Stat label="nodes" value={trie.countNodes()} />
            <Stat label="edges" value={trie.countEdges()} />
            <Stat
              label="characters saved"
              value={terms.reduce((s, t) => s + t.length, 0) - trie.countEdges()}
              tone="ok"
              hint="Total characters in the terms, minus edges actually stored"
            />
          </StatRow>
        </Stack>
      </Panel>

      <Panel
        title="Prefix lookup: reach the prefix, then enumerate the subtree"
        subtitle="Exact lookup costs the length of the term, independent of how many terms exist."
        tone="sunken"
      >
        <Stack gap={4}>
          <TextInput label="Prefix" value={prefix} onChange={setPrefix} />

          <StatRow>
            <Stat label="steps to reach prefix" value={walk.steps} hint="One per character — not one per term" />
            <Stat label="terms under it" value={search.terms.length} tone="accent" />
            <Stat label="nodes visited" value={search.nodesVisited} />
            <Stat label="vocabulary size" value={terms.length} hint="What a linear scan would have touched" />
          </StatRow>

          {walk.node === null ? (
            <EmptyState>No term starts with <Mono>{prefix}</Mono> — the walk died after {walk.steps} character(s).</EmptyState>
          ) : (
            <div className="flex flex-wrap gap-1">
              {search.terms.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
            </div>
          )}
        </Stack>
      </Panel>

      <Panel title="Why not just use a trie?" subtitle="Two reasons, and the second one is what chapter 17 fixes.">
        <Grid cols={2}>
          <div className="rounded-lg border border-edge bg-raised p-3">
            <div className="mb-2 text-[12.5px] font-semibold text-ink">Memory</div>
            <KeyValue
              items={[
                { key: "nodes", value: trie.countNodes() },
                { key: "edges", value: trie.countEdges() },
                { key: "rough size", value: formatBytes(trie.estimateBytes()) },
              ]}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              A pointer-heavy node with a hash map per level is expensive. Most nodes have one or two children
              and pay for a map anyway.
            </p>
          </div>
          <div className="rounded-lg border border-edge bg-raised p-3">
            <div className="mb-2 text-[12.5px] font-semibold text-ink">Prefix sharing is not suffix sharing</div>
            <pre className="rounded bg-code p-2 font-mono text-[11.5px] text-muted">
{`car
bar

both need:  r → END

a trie stores that ending twice`}
            </pre>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Every word ending in the same way duplicates the same tail. On a real vocabulary that is most of
              the structure.
            </p>
          </div>
        </Grid>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 17 — finite-state machines
// ===========================================================================

export function Ch17() {
  const dictionary = demoDictionary("title");
  const [setName, setSetName] = useState("car / bar");
  const [useFullVocab, setUseFullVocab] = useState(false);

  const terms = useFullVocab ? dictionary.sortedTerms : TERM_SETS[setName];
  const trie = useMemo(() => Trie.from(terms), [terms]);
  const min = useMemo(() => minimize(trie), [trie]);

  const languageMatches = useMemo(
    () => dawgTerms(min).join("|") === terms.join("|"),
    [min, terms],
  );

  return (
    <Stack gap={4}>
      <Panel
        title="Two states are the same if their futures are the same"
        subtitle="Minimization merges every state with identical outgoing behaviour — which is how suffixes finally get shared."
        actions={<Toggle label="Full vocabulary" checked={useFullVocab} onChange={setUseFullVocab} />}
      >
        <Stack gap={4}>
          {!useFullVocab && (
            <Segmented
              label="Term set"
              value={setName}
              onChange={setSetName}
              options={Object.keys(TERM_SETS).map((k) => ({ value: k, label: k }))}
            />
          )}

          <div className="flex flex-wrap gap-1">
            {terms.slice(0, 30).map((t) => <Badge key={t}>{t}</Badge>)}
            {terms.length > 30 && <Badge tone="neutral">+{terms.length - 30}</Badge>}
          </div>

          <Grid cols={2}>
            <div className="rounded-lg border border-edge bg-raised p-3">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-faint">Trie</div>
              <KeyValue items={[
                { key: "nodes", value: min.trieNodeCount },
                { key: "edges", value: min.trieEdgeCount },
              ]} />
              <Bar value={min.trieNodeCount} max={min.trieNodeCount} tone="muted" width={200} label="100%" />
            </div>
            <div className="rounded-lg border border-transparent bg-accent-soft p-3">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-accent-text opacity-70">
                Minimized automaton
              </div>
              <KeyValue items={[
                { key: "nodes", value: min.dawgNodeCount },
                { key: "edges", value: min.dawgEdgeCount },
              ]} />
              <Bar
                value={min.dawgNodeCount}
                max={min.trieNodeCount}
                tone="accent"
                width={200}
                label={percent(min.dawgNodeCount / min.trieNodeCount, 0)}
              />
            </div>
          </Grid>

          <StatRow>
            <Stat label="nodes removed" value={min.trieNodeCount - min.dawgNodeCount} tone="ok" />
            <Stat
              label="reduction"
              value={percent(1 - min.dawgNodeCount / min.trieNodeCount, 1)}
              tone="ok"
            />
            <Stat label="merge groups" value={min.mergedGroups.length} hint="Distinct behaviours shared by more than one trie node" />
            <Stat
              label="language preserved"
              value={languageMatches ? "yes" : "NO"}
              tone={languageMatches ? "ok" : "bad"}
              hint="The minimized automaton must accept exactly the same terms"
            />
          </StatRow>
        </Stack>
      </Panel>

      <Panel title="Which nodes merged" subtitle="Each row is one shared future — one piece of structure that used to be stored many times.">
        {min.mergedGroups.length === 0 ? (
          <EmptyState>Nothing merged: no two states in this set have identical futures.</EmptyState>
        ) : (
          <Table head={["trie nodes merged", "shared behaviour"]}>
            {min.mergedGroups.slice(0, 12).map((group, i) => (
              <Tr key={i}>
                <Td mono tone="accent">{group.trieNodeIds.length}</Td>
                <Td mono tone="muted">
                  {group.signature === "F|" ? "final state, no outgoing edges — the END node"
                    : group.signature === "-|" ? "dead end"
                      : group.signature.replace(/\|/g, "  ").slice(0, 90)}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      <Callout tone="accent" title="The progression">
        <pre className="mt-1 font-mono text-[11.5px] leading-relaxed">
{`Trie                 prefixes shared
  ↓
Finite-state automaton
  ↓
Minimized automaton  suffixes shared too
  ↓
FST                  ... and now it can carry an output`}
        </pre>
      </Callout>
    </Stack>
  );
}

// ===========================================================================
// Chapter 18 — FSTs
// ===========================================================================

export function Ch18() {
  const dictionary = demoDictionary("title");
  const [mode, setMode] = useState<"toy" | "vocab">("toy");
  const [lookupKey, setLookupKey] = useState("car");

  const entries = useMemo(() => {
    if (mode === "toy") {
      return [
        { key: "can", output: 300 },
        { key: "car", output: 100 },
        { key: "cat", output: 200 },
      ];
    }
    return dictionary.sortedTerms.map((key, i) => ({ key, output: i }));
  }, [mode, dictionary]);

  const fst = useMemo(() => buildFst(entries), [entries]);
  const trie = useMemo(() => Trie.from(entries.map((e) => e.key)), [entries]);
  const trace = useMemo(() => fst.trace(lookupKey.toLowerCase()), [fst, lookupKey]);

  return (
    <Stack gap={4}>
      <Panel
        title="An automaton accepts. A transducer answers."
        subtitle="Same structure, plus an output on each arc. The output is what turns a dictionary into a pointer to postings."
        actions={
          <Segmented
            value={mode}
            onChange={(m) => { setMode(m); setLookupKey(m === "toy" ? "car" : "kubernetes"); }}
            options={[
              { value: "toy", label: "car / cat / can" },
              { value: "vocab", label: "full vocabulary" },
            ]}
          />
        }
      >
        <Stack gap={4}>
          <Grid cols={2}>
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">Input → output</div>
              <div className="max-h-[160px] overflow-y-auto">
                <Table head={["key", "output"]} dense>
                  {entries.slice(0, 20).map((e) => (
                    <Tr key={e.key} highlight={e.key === lookupKey.toLowerCase()}>
                      <Td mono>{e.key}</Td>
                      <Td mono align="right" tone="accent">{e.output}</Td>
                    </Tr>
                  ))}
                </Table>
              </div>
              {entries.length > 20 && (
                <p className="mt-1 text-[11px] text-faint">+{entries.length - 20} more keys</p>
              )}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">What an output can be</div>
              <ul className="space-y-1 text-[12px] text-muted">
                {["a term ordinal", "a file offset into the postings file", "a block pointer", "arbitrary metadata"].map((x) => (
                  <li key={x} className="flex gap-2">
                    <span className="text-accent-text">→</span>{x}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                The FST does not know what the number means. That is exactly why the same structure serves as a
                term index, a synonym map and a block pointer table.
              </p>
            </div>
          </Grid>

          <StatRow>
            <Stat label="keys" value={fst.stats.keys} />
            <Stat label="states" value={fst.stats.states} tone="accent" />
            <Stat label="arcs" value={fst.stats.arcs} />
            <Stat label="states reused" value={fst.stats.statesReused} tone="ok" hint="Suffix sharing at work during construction" />
          </StatRow>
        </Stack>
      </Panel>

      <Panel
        title="Outputs accumulate along the path"
        subtitle="No single arc holds the answer. The output is pushed as close to the root as it can go, and the lookup adds up what it passes."
        tone="sunken"
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Look up" value={lookupKey} onChange={setLookupKey} />
            <div>
              <div className="mb-1 text-[11.5px] font-medium text-muted">Try</div>
              <div className="flex flex-wrap gap-1">
                {entries.slice(0, 6).map((e) => (
                  <Button key={e.key} size="sm" onClick={() => setLookupKey(e.key)}>{e.key}</Button>
                ))}
              </div>
            </div>
          </div>

          {trace.steps.length === 0 && !trace.found ? (
            <EmptyState>No arc leaves the start state for that character.</EmptyState>
          ) : (
            <Table head={["char", "from", "to", "arc output", "running total"]}>
              {trace.steps.map((step, i) => (
                <Tr key={i}>
                  <Td mono tone="accent">{step.label}</Td>
                  <Td mono tone="muted">s{step.fromState}</Td>
                  <Td mono tone="muted">s{step.toState}</Td>
                  <Td mono align="right">{step.arcOutput === 0 ? "—" : `+${step.arcOutput}`}</Td>
                  <Td mono align="right" tone="accent">{step.running}</Td>
                </Tr>
              ))}
            </Table>
          )}

          <Callout tone={trace.found ? "ok" : "bad"}>
            {trace.found
              ? <>The walk ended on a final state. Output = <Mono>{String(trace.output)}</Mono>.</>
              : <>The walk did not end on a final state, so <Mono>{lookupKey}</Mono> is not a key in this FST.</>}
          </Callout>
        </Stack>
      </Panel>

      <Panel title="Size, against the alternatives" subtitle="The same 100% of the language, in a fraction of the structure.">
        <Table head={["structure", "nodes / states", "edges / arcs", "rough bytes", ""]}>
          {[
            { name: "Trie", nodes: trie.countNodes(), edges: trie.countEdges(), bytes: trie.estimateBytes() },
            { name: "Minimized automaton", nodes: minimize(trie).dawgNodeCount, edges: minimize(trie).dawgEdgeCount, bytes: minimize(trie).dawgEdgeCount * 5 },
            { name: "FST (with outputs)", nodes: fst.stats.states, edges: fst.stats.arcs, bytes: fst.stats.estimatedBytes },
          ].map((row) => (
            <Tr key={row.name} highlight={row.name.startsWith("FST")}>
              <Td>{row.name}</Td>
              <Td mono align="right">{row.nodes}</Td>
              <Td mono align="right">{row.edges}</Td>
              <Td mono align="right">{formatBytes(row.bytes)}</Td>
              <Td><Bar value={row.bytes} max={trie.estimateBytes()} tone={row.name.startsWith("FST") ? "accent" : "muted"} width={120} /></Td>
            </Tr>
          ))}
        </Table>
        <Callout tone="info" title="A detail worth noticing">
          The FST has exactly the same number of states as the minimized automaton. It <em>is</em> the
          minimized automaton — with outputs attached and stored as bytes instead of objects.
        </Callout>
      </Panel>

      {mode === "vocab" && <Ch18Fuzzy fst={fst} />}
    </Stack>
  );
}

function Ch18Fuzzy({ fst }: { fst: ReturnType<typeof buildOrdinalFst> }) {
  const dictionary = demoDictionary("title");
  const [query, setQuery] = useState("kubernets");
  const [maxEdits, setMaxEdits] = useState(1);

  const comparison = useMemo(() => {
    const automaton = buildLevenshteinAutomaton(query.toLowerCase(), maxEdits);
    const viaFst = intersectFstWithAutomaton(fst, automaton);
    const brute = bruteForceFuzzy(query.toLowerCase(), dictionary.sortedTerms, maxEdits);
    return { viaFst, brute, agree: [...viaFst.terms.map((t) => t.term)].sort().join("|") === [...brute.terms].sort().join("|") };
  }, [fst, dictionary, query, maxEdits]);

  return (
    <Panel
      title="Fuzzy search over the FST"
      subtitle="Intersect the automaton with the transducer. A dead automaton state kills every arc below it — and the output comes back with the term."
    >
      <Stack gap={4}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Fuzzy query" value={query} onChange={setQuery} />
          <Slider label="max edits" value={maxEdits} min={0} max={2} onChange={setMaxEdits} />
        </div>

        <StatRow>
          <Stat label="brute force comparisons" value={comparison.brute.comparisons} tone="bad" />
          <Stat label="FST arcs followed" value={comparison.viaFst.arcsFollowed} tone="ok" />
          <Stat label="arcs pruned" value={comparison.viaFst.arcsPruned} tone="accent" />
          <Stat label="agree with oracle" value={comparison.agree ? "yes" : "NO"} tone={comparison.agree ? "ok" : "bad"} />
        </StatRow>

        <div className="flex flex-wrap gap-1">
          {comparison.viaFst.terms.length === 0
            ? <span className="text-[12px] text-faint">nothing within {maxEdits} edit(s)</span>
            : comparison.viaFst.terms.map((t) => (
              <Badge key={t.term} tone="accent">{t.term} <span className="opacity-60">→{t.output}</span></Badge>
            ))}
        </div>
      </Stack>
    </Panel>
  );
}

// ===========================================================================
// Chapter 19 — BlockTree
// ===========================================================================

export function Ch19() {
  const dictionary = demoDictionary("title");
  const [blockSize, setBlockSize] = useState(8);
  const [lookupTerm, setLookupTerm] = useState("kubernetes");

  const tree = useMemo(
    () => buildBlockTree(dictionary.sortedTerms, blockSize),
    [dictionary, blockSize],
  );
  const lookup = useMemo(() => tree.lookup(lookupTerm.toLowerCase()), [tree, lookupTerm]);

  return (
    <Stack gap={4}>
      <Panel
        title="Why not put every term in one enormous FST?"
        subtitle="Because the index has to live in memory. Split navigation from storage and only the navigation has to."
      >
        <Stack gap={4}>
          <Slider
            label="terms per block"
            value={blockSize}
            min={2}
            max={32}
            onChange={setBlockSize}
            format={(v) => `${v} terms — ${tree.blocks.length} blocks`}
          />

          <Grid cols={2}>
            <div className="rounded-lg border border-edge bg-raised p-3">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-faint">
                One FST over every term
              </div>
              <KeyValue items={[
                { key: "keys", value: tree.everyTermIndex.stats.keys },
                { key: "states", value: tree.everyTermIndex.stats.states },
                { key: "arcs", value: tree.everyTermIndex.stats.arcs },
                { key: "in-memory size", value: formatBytes(tree.everyTermIndex.stats.estimatedBytes) },
              ]} />
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                Every lookup is one walk. Every term costs memory, forever.
              </p>
            </div>
            <div className="rounded-lg border border-transparent bg-accent-soft p-3">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-accent-text opacity-70">
                Prefix index over block keys only
              </div>
              <KeyValue items={[
                { key: "keys", value: tree.prefixIndex.stats.keys },
                { key: "states", value: tree.prefixIndex.stats.states },
                { key: "arcs", value: tree.prefixIndex.stats.arcs },
                { key: "in-memory size", value: formatBytes(tree.prefixIndex.stats.estimatedBytes) },
              ]} />
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                {percent(1 - tree.prefixIndex.stats.estimatedBytes / Math.max(1, tree.everyTermIndex.stats.estimatedBytes), 0)}{" "}
                smaller. The terms themselves live in blocks on disk.
              </p>
            </div>
          </Grid>

          <StatRow>
            <Stat label="terms" value={tree.totalTerms} />
            <Stat label="blocks" value={tree.blocks.length} />
            <Stat label="block bytes (front coded)" value={formatBytes(tree.totalBlockBytes)} tone="ok" />
            <Stat
              label="vs storing terms in full"
              value={percent(1 - tree.totalBlockBytes / tree.totalRawBytes, 0)}
              tone="ok"
              hint="Front coding reuses the shared prefix with the previous term"
            />
          </StatRow>
        </Stack>
      </Panel>

      <Panel
        title="Look a term up through both layers"
        subtitle="The index narrows to a region. The block stores the terms. Postings come last."
        tone="sunken"
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Term" value={lookupTerm} onChange={setLookupTerm} />
            <div>
              <div className="mb-1 text-[11.5px] font-medium text-muted">Try</div>
              <div className="flex flex-wrap gap-1">
                {["kubernetes", "docker", "deployment", "zzz", dictionary.sortedTerms[0]].map((t) => (
                  <Button key={t} size="sm" onClick={() => setLookupTerm(t)}>{t}</Button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            {[
              { label: `term "${lookupTerm}"`, note: "the thing we want postings for" },
              { label: "prefix index", note: `${lookup.indexSteps} comparison(s) to find the right block` },
              { label: `block ${lookup.blockIndex}`, note: lookup.blockIndex >= 0 ? `covers "${tree.blocks[lookup.blockIndex]?.firstTerm}" … "${tree.blocks[lookup.blockIndex]?.lastTerm}"` : "before the first block" },
              { label: "scan the block", note: `${lookup.blockScanSteps} term comparison(s)` },
              {
                label: lookup.found ? `found at ordinal ${lookup.ordinal}` : "not in the dictionary",
                note: lookup.found ? "this ordinal is the postings pointer" : "no postings, no candidates",
              },
            ].map((row, i, arr) => (
              <div key={i}>
                <div className={`flex flex-wrap items-baseline gap-2 rounded-lg border px-3 py-2 ${
                  i === arr.length - 1 && !lookup.found ? "border-transparent bg-bad-soft" : "border-edge bg-raised"
                }`}>
                  <span className="font-mono text-[12.5px] font-medium text-ink">{row.label}</span>
                  <span className="text-[11.5px] text-faint">{row.note}</span>
                </div>
                {i < arr.length - 1 && <div className="py-0.5 text-center font-mono text-[10px] text-faint">↓</div>}
              </div>
            ))}
          </div>

          <StatRow>
            <Stat label="index comparisons" value={lookup.indexSteps} tone="accent" />
            <Stat label="block comparisons" value={lookup.blockScanSteps} />
            <Stat label="total" value={lookup.indexSteps + lookup.blockScanSteps} />
            <Stat label="linear scan would cost" value={tree.totalTerms} tone="bad" />
          </StatRow>
        </Stack>
      </Panel>

      <Panel title="The blocks" subtitle="Sorted terms, chunked. Each block shares a prefix, which is what front coding exploits.">
        <div className="max-h-[340px] overflow-y-auto">
          <Table head={["#", "shared prefix", "first … last", "terms", "bytes", "saved"]}>
            {tree.blocks.map((block) => (
              <Tr key={block.index} highlight={block.index === lookup.blockIndex}>
                <Td mono tone="muted">{block.index}</Td>
                <Td mono tone="accent">{block.sharedPrefix || "—"}</Td>
                <Td mono tone="muted">{block.firstTerm} … {block.lastTerm}</Td>
                <Td mono align="right">{block.terms.length}</Td>
                <Td mono align="right">{block.bytes}</Td>
                <Td mono align="right" tone="ok">
                  {percent(1 - block.bytes / block.rawBytes, 0)}
                </Td>
              </Tr>
            ))}
          </Table>
        </div>
      </Panel>

      <Callout tone="accent" title="Keep the three roles separate">
        <pre className="mt-1 font-mono text-[11.5px] leading-relaxed">
{`FST       = navigation
Block     = local term storage and enumeration
Postings  = document membership`}
        </pre>
      </Callout>
    </Stack>
  );
}
