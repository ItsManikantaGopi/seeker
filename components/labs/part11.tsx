"use client";

import { useCallback, useMemo, useState } from "react";
import { KausEngine, verifyFile } from "@/lib/kaus/segments";
import { corrupt } from "@/lib/kaus/codec";
import { Cluster } from "@/lib/kaus/cluster";
import { CORPUS } from "@/lib/kaus/corpus";
import type { Query } from "@/lib/kaus/query";
import {
  Badge,
  Bar,
  Button,
  Callout,
  EmptyState,
  Grid,
  KeyValue,
  Panel,
  Slider,
  Stack,
  Stat,
  StatRow,
  Table,
  Td,
  Tr,
  formatBytes,
} from "@/components/ui";

// ===========================================================================
// Chapter 35 — refresh, flush, commit
// ===========================================================================

const GUARANTEES = [
  {
    verb: "refresh",
    changes: "visibility",
    sentence: "Recent writes become searchable.",
    doesNot: "Does not make anything durable. A crash still loses them.",
    cost: "Cheap and frequent. Creates a segment, which adds merge pressure.",
    tone: "accent" as const,
  },
  {
    verb: "flush",
    changes: "files on disk",
    sentence: "Buffered index work is written into segment files.",
    doesNot: "Does not by itself define a reopenable index state.",
    cost: "I/O bound. Competes with merges for the same disk.",
    tone: "info" as const,
  },
  {
    verb: "commit",
    changes: "durability",
    sentence: "A commit point names the segments that make up the index.",
    doesNot: "Does not make anything newly visible — it was already searchable.",
    cost: "Expensive. This is why it is not done per document.",
    tone: "ok" as const,
  },
];

export function Ch35() {
  const [, force] = useState(0);
  const [engine] = useState(() => new KausEngine());
  const [cursor, setCursor] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  const stats = engine.stats();
  const searchable = engine.search({ kind: "match_all" }, { topK: 100 }).hits.length;

  return (
    <Stack gap={4}>
      <Panel
        title="Three verbs, three different promises"
        subtitle="They are constantly confused. Drive each one by hand and watch exactly which number moves."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => {
              for (let i = 0; i < 3 && cursor + i < CORPUS.length; i++) engine.index(CORPUS[cursor + i]);
              setCursor((c) => Math.min(CORPUS.length, c + 3));
              rerender();
            }} disabled={cursor >= CORPUS.length}>
              index 3 documents
            </Button>
            <Button size="sm" tone="primary" onClick={() => { engine.refresh(); rerender(); }}>refresh</Button>
            <Button size="sm" onClick={() => { engine.flush(); rerender(); }}>flush</Button>
            <Button size="sm" onClick={() => { engine.commit(); rerender(); }}>commit</Button>
          </div>
        }
      >
        <Stack gap={4}>
          <div className="grid gap-2 md:grid-cols-4">
            {[
              { label: "RAM buffer", value: stats.pendingWrites, note: "written, invisible", tone: "warn" as const },
              { label: "Searchable", value: searchable, note: "visible to queries", tone: "accent" as const },
              { label: "On disk", value: formatBytes(stats.diskBytes), note: "segment files written", tone: "info" as const },
              { label: "Committed generation", value: stats.committedGeneration, note: "reopenable state", tone: "ok" as const },
            ].map((box) => (
              <div key={box.label} className="rounded-lg border border-edge bg-raised p-3">
                <div className="text-[10.5px] font-medium uppercase tracking-wider text-faint">{box.label}</div>
                <div className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-ink">{box.value}</div>
                <div className="mt-0.5 text-[11px] text-faint">{box.note}</div>
              </div>
            ))}
          </div>

          <StatRow>
            <Stat label="translog entries" value={stats.translogEntries}
              tone={stats.translogEntries > 0 ? "warn" : "ok"}
              hint="Durable record of writes since the last commit. This is what survives a crash." />
            <Stat label="live segments" value={stats.segments} />
            <Stat label="unflushed segments" value={stats.unflushed}
              tone={stats.unflushed > 0 ? "warn" : "ok"}
              hint="Searchable but never written to disk — lost in a crash" />
            <Stat label="documents" value={stats.documents} />
          </StatRow>

          <div className="space-y-2">
            {GUARANTEES.map((g) => (
              <div key={g.verb} className="rounded-lg border border-edge bg-raised px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={g.tone}>{g.verb}</Badge>
                  <span className="text-[12.5px] font-medium text-ink">changes {g.changes}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{g.sentence}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-bad">{g.doesNot}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{g.cost}</p>
              </div>
            ))}
          </div>

          <Callout tone="warn" title="The pair of guarantees you have to write down">
            <strong>Freshness:</strong> how long after a write may a search still miss it? That is your refresh
            interval. <strong>Durability:</strong> how much work may a crash lose? That is your commit interval
            and whether the translog is fsynced. They are independent, and every search engine makes you choose
            both whether or not you notice.
          </Callout>
        </Stack>
      </Panel>

      <Panel title="Event log" tone="sunken">
        <div className="max-h-[260px] overflow-y-auto rounded-lg border border-edge bg-code p-2">
          {engine.events.length === 0 ? (
            <p className="p-2 text-[12px] text-faint">Index some documents to begin.</p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11.5px]">
              {engine.events.map((event, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-8 shrink-0 text-right text-faint">{event.tick}</span>
                  <span className={`w-14 shrink-0 ${
                    event.kind === "commit" ? "text-ok"
                      : event.kind === "refresh" ? "text-accent-text"
                        : event.kind === "flush" ? "text-info" : "text-muted"
                  }`}>{event.kind}</span>
                  <span className="text-muted">{event.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 36 — recovery and replication
// ===========================================================================

export function Ch36() {
  const [, force] = useState(0);
  const [engine, setEngine] = useState(() => new KausEngine());
  const [crashReport, setCrashReport] = useState<{ lostFromBuffer: number; recoverableFromTranslog: number; lostSegments: string[] } | null>(null);
  const [recoveryReport, setRecoveryReport] = useState<{ replayed: number; verified: string[]; corrupted: string[] } | null>(null);
  const [corruptedFile, setCorruptedFile] = useState<string | null>(null);

  const rerender = useCallback(() => force((n) => n + 1), []);

  const setup = (stage: "buffered" | "refreshed" | "committed") => {
    const e = new KausEngine();
    e.indexAll(CORPUS.slice(0, 6));
    e.refresh();
    e.commit();
    e.indexAll(CORPUS.slice(6, 10));
    if (stage === "refreshed") e.refresh();
    if (stage === "committed") {
      e.refresh();
      e.commit();
    }
    setEngine(e);
    setCrashReport(null);
    setRecoveryReport(null);
    setCorruptedFile(null);
    rerender();
  };

  const stats = engine.stats();
  const files = engine.liveSegments.flatMap((s) => s.files);

  return (
    <Stack gap={4}>
      <Panel
        title="Failure is part of the architecture"
        subtitle="Set the engine up in a particular state, then kill it and see exactly what survives."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setup("buffered")}>writes buffered only</Button>
            <Button size="sm" onClick={() => setup("refreshed")}>refreshed, not committed</Button>
            <Button size="sm" onClick={() => setup("committed")}>fully committed</Button>
          </div>
        }
      >
        <Stack gap={4}>
          <StatRow>
            <Stat label="searchable" value={stats.documents} tone="accent" />
            <Stat label="buffered" value={stats.pendingWrites} tone={stats.pendingWrites > 0 ? "warn" : "default"} />
            <Stat label="translog" value={stats.translogEntries} tone={stats.translogEntries > 0 ? "warn" : "ok"} />
            <Stat label="committed generation" value={stats.committedGeneration} tone="ok" />
          </StatRow>

          <div className="flex flex-wrap gap-2">
            <Button
              tone="danger"
              onClick={() => { setCrashReport(engine.crash()); setRecoveryReport(null); rerender(); }}
            >
              💥 kill the process
            </Button>
            <Button
              tone="primary"
              disabled={!crashReport}
              onClick={() => { setRecoveryReport(engine.recover()); rerender(); }}
            >
              recover
            </Button>
          </div>

          {crashReport && (
            <Callout tone="bad" title="What the crash took">
              <KeyValue
                items={[
                  { key: "buffered writes lost", value: crashReport.lostFromBuffer },
                  { key: "unflushed segments lost", value: crashReport.lostSegments.join(", ") || "none" },
                  { key: "translog entries surviving", value: crashReport.recoverableFromTranslog },
                  { key: "documents still searchable", value: stats.documents },
                ]}
              />
              <p className="mt-2">
                Anything that only existed in memory is gone. The translog is what makes the loss recoverable
                rather than permanent — which is why &ldquo;searchable&rdquo; and &ldquo;durable&rdquo; have to
                be separate words.
              </p>
            </Callout>
          )}

          {recoveryReport && (
            <Callout tone="ok" title="Recovery">
              <KeyValue
                items={[
                  { key: "translog operations replayed", value: recoveryReport.replayed },
                  { key: "files whose checksum verified", value: recoveryReport.verified.length },
                  { key: "corrupt files found", value: recoveryReport.corrupted.length },
                  { key: "documents searchable now", value: stats.documents },
                ]}
              />
            </Callout>
          )}

          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wider text-faint">Recovery flow</div>
            <div className="space-y-1">
              {[
                "Detect the missing shard or lost segment",
                "Find a valid copy — a replica, or the translog",
                "Recover the shard from that copy",
                "Verify segments and checksums before trusting them",
                "Mark healthy",
              ].map((step, i, arr) => (
                <div key={i}>
                  <div className="rounded-lg border border-edge bg-raised px-3 py-2 text-[12.5px] text-ink">
                    {step}
                  </div>
                  {i < arr.length - 1 && <div className="py-0.5 text-center font-mono text-[10px] text-faint">↓</div>}
                </div>
              ))}
            </div>
          </div>
        </Stack>
      </Panel>

      <Panel
        title="Verify before you trust"
        subtitle="Recovery reads files that may have been damaged by whatever killed the process. Corrupt one and watch verification refuse it."
        tone="sunken"
      >
        <Stack gap={3}>
          {files.length === 0 ? (
            <EmptyState>No files on disk. Set up a committed state first.</EmptyState>
          ) : (
            <Table head={["file", "bytes", "magic", "version", "checksum", "verdict"]}>
              {files.map((file) => {
                const damaged = corruptedFile === file.name;
                const subject = damaged ? { ...file, bytes: corrupt(file.bytes, 30) } : file;
                const v = verifyFile(subject);
                return (
                  <Tr key={file.name}>
                    <Td mono>{file.name}</Td>
                    <Td mono align="right" tone="muted">{file.bytes.length}</Td>
                    <Td align="center" tone={v.magicOk ? "ok" : "bad"}>{v.magicOk ? "SEEK" : "bad"}</Td>
                    <Td mono align="center">{v.version}</Td>
                    <Td mono tone={v.storedChecksum === v.computedChecksum ? "ok" : "bad"}>
                      {v.storedChecksum === v.computedChecksum
                        ? `0x${v.storedChecksum.toString(16).padStart(8, "0")}`
                        : `stored 0x${v.storedChecksum.toString(16)} ≠ computed 0x${v.computedChecksum.toString(16)}`}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Badge tone={v.valid ? "ok" : "bad"}>{v.valid ? "valid" : "CORRUPT"}</Badge>
                        <Button
                          size="sm"
                          tone="ghost"
                          onClick={() => setCorruptedFile(damaged ? null : file.name)}
                        >
                          {damaged ? "repair" : "corrupt a byte"}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </Table>
          )}
          <Callout tone="info" title="Recovery that skips verification is not recovery">
            A corrupt segment that gets loaded anyway produces wrong answers quietly, forever. The checksum is
            the difference between an outage you notice and a data problem you do not.
          </Callout>
        </Stack>
      </Panel>

      <Panel title="Failure modes worth testing" subtitle="All of these are ordinary, and all of them will happen.">
        <Grid cols={2}>
          {[
            ["process crash", "Buffered writes and unflushed segments vanish. The translog decides how much comes back."],
            ["node loss", "Every shard copy on that node goes with it. Replicas decide whether the shard survives."],
            ["disk corruption", "Checksums catch it on read. Without them, wrong answers propagate silently."],
            ["network partition", "Nodes are alive but unreachable. The cluster must decide who is authoritative."],
            ["replica lag", "A copy that is behind serves stale results. Reads look inconsistent between requests."],
            ["cluster-state inconsistency", "Two nodes disagree about who owns a shard. The most expensive failure to debug."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-edge bg-raised p-3">
              <div className="font-mono text-[12.5px] font-semibold text-ink">{title}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </Grid>
      </Panel>
    </Stack>
  );
}

// ===========================================================================
// Chapter 37 — cluster management
// ===========================================================================

const DEMO_QUERY: Query = { kind: "match", field: "title", text: "kubernetes" };

export function Ch37() {
  const [, force] = useState(0);
  const [shardCount, setShardCount] = useState(4);
  const [replicaCount, setReplicaCount] = useState(1);
  const [nodeCount, setNodeCount] = useState(3);

  const cluster = useMemo(() => {
    const c = new Cluster({ shardCount, replicaCount, nodeCount });
    c.indexAll(CORPUS);
    c.commitAll();
    return c;
  }, [shardCount, replicaCount, nodeCount]);

  const rerender = useCallback(() => force((n) => n + 1), []);
  const state = cluster.clusterState();
  const result = cluster.search(DEMO_QUERY, { topK: 5 });

  const loadSpread = state.nodes.filter((n) => n.state === "up").map((n) => n.copies);
  const maxLoad = Math.max(...loadSpread, 1);
  const minLoad = Math.min(...loadSpread, 0);

  return (
    <Stack gap={4}>
      <Panel
        title="A control plane, separate from the data plane"
        subtitle="One decides where shards live and who is healthy. The other indexes, searches and scores. Keeping them separate is the whole design."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { cluster.addNode(); rerender(); }}>add a node</Button>
          </div>
        }
      >
        <Stack gap={4}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Slider label="shards" value={shardCount} min={1} max={8} onChange={setShardCount} />
            <Slider label="replicas per shard" value={replicaCount} min={0} max={2} onChange={setReplicaCount} />
            <Slider label="nodes" value={nodeCount} min={1} max={6} onChange={setNodeCount} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className={`rounded-lg px-3 py-2 ${
              state.health === "green" ? "bg-ok-soft" : state.health === "yellow" ? "bg-warn-soft" : "bg-bad-soft"
            }`}>
              <span className="text-[10.5px] uppercase tracking-wider text-faint">cluster health</span>
              <div className={`font-mono text-[16px] font-bold ${
                state.health === "green" ? "text-ok" : state.health === "yellow" ? "text-warn" : "text-bad"
              }`}>{state.health}</div>
            </div>
            <div className="text-[12px] leading-relaxed text-muted">
              {state.health === "green" && "Every shard has a primary and every replica is assigned."}
              {state.health === "yellow" && `${state.unassigned} copy/copies cannot be placed. All data is still searchable, but the next failure is not survivable.`}
              {state.health === "red" && "At least one shard has no started copy. Searches over it return partial results."}
            </div>
          </div>

          <Grid cols={2}>
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-faint">Nodes</div>
              <div className="space-y-2">
                {state.nodes.map((node) => (
                  <div key={node.id} className={`rounded-lg border px-3 py-2 ${
                    node.state === "up" ? "border-edge bg-raised" : "border-transparent bg-bad-soft"
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12.5px] text-ink">{node.id}</span>
                      <div className="flex items-center gap-2">
                        <Bar value={node.copies} max={maxLoad} tone="accent" label={`${node.copies}`} width={70} />
                        <Button
                          size="sm"
                          tone={node.state === "up" ? "danger" : "default"}
                          onClick={() => {
                            if (node.state === "up") cluster.failNode(node.id);
                            else cluster.reviveNode(node.id);
                            rerender();
                          }}
                        >
                          {node.state === "up" ? "fail" : "revive"}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {cluster.copies.filter((c) => c.nodeId === node.id).map((copy, i) => (
                        <Badge key={i} tone={copy.primary ? "accent" : "info"}>
                          {copy.primary ? "P" : "R"}{copy.shard}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-faint">Cluster state</div>
              <pre className="scroll-x rounded-lg border border-edge bg-code p-3 font-mono text-[11px] leading-relaxed text-muted">
{`CONTROL PLANE
  node membership   ${state.nodes.filter((n) => n.state === "up").length} up, ${state.nodes.filter((n) => n.state === "down").length} down
  shard allocation  ${cluster.copies.filter((c) => c.state === "started").length} started, ${state.unassigned} unassigned
  index metadata    ${shardCount} shards, ${replicaCount} replica(s)
  recovery          ${state.health === "green" ? "idle" : "needed"}

DATA PLANE
  indexing          ${CORPUS.length} documents
  searching         fan-out ${result.shardsQueried}
  scoring           BM25 per shard
  fetching          ${result.fetchPhase.length} shard(s) asked`}
              </pre>
              <div className="mt-2">
                <KeyValue
                  items={[
                    { key: "load imbalance", value: `${minLoad}–${maxLoad} copies per node` },
                    { key: "partial results", value: result.partial ? `yes — ${result.shardsFailed} shard(s) missing` : "no" },
                  ]}
                />
              </div>
            </div>
          </Grid>

          <Table head={["shard", "documents", "primary", "replicas", "state"]} dense>
            {state.shards.map((shard) => {
              const primary = shard.copies.find((c) => c.primary);
              const replicas = shard.copies.filter((c) => !c.primary);
              return (
                <Tr key={shard.shard}>
                  <Td mono>{shard.shard}</Td>
                  <Td mono align="right">{shard.documents}</Td>
                  <Td mono tone={primary?.state === "started" ? "ok" : "bad"}>
                    {primary?.nodeId ?? "unassigned"}
                  </Td>
                  <Td mono tone="muted">
                    {replicas.map((r) => r.nodeId ?? "unassigned").join(", ") || "none"}
                  </Td>
                  <Td>
                    <Badge tone={primary?.state === "started" ? "ok" : "bad"}>
                      {primary?.state === "started" ? "searchable" : "unavailable"}
                    </Badge>
                  </Td>
                </Tr>
              );
            })}
          </Table>
        </Stack>
      </Panel>

      <Panel title="Allocation events" tone="sunken">
        <div className="max-h-[220px] overflow-y-auto rounded-lg border border-edge bg-code p-2">
          {cluster.events.length === 0 ? (
            <p className="p-2 text-[12px] text-faint">Fail a node to see allocation react.</p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11px]">
              {cluster.events.map((event, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-8 shrink-0 text-right text-faint">{event.tick}</span>
                  <span className={`w-16 shrink-0 ${
                    event.kind === "fail" ? "text-bad"
                      : event.kind === "promote" ? "text-ok"
                        : event.kind === "join" ? "text-info" : "text-muted"
                  }`}>{event.kind}</span>
                  <span className="text-muted">{event.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Callout tone="accent" title="This is a distributed-systems problem layered on a search engine">
        Nothing above involves postings, BM25 or automata. Allocation, membership, promotion and health are a
        separate discipline that happens to be sitting on top of an index — and mixing the two planes is how
        clusters become impossible to reason about.
      </Callout>
    </Stack>
  );
}
