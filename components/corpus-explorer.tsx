"use client";

import { useMemo, useState } from "react";
import { analyze, DEFAULT_ANALYZER, KEYWORD_ANALYZER } from "@/lib/seeker/analyzer";
import { CORPUS, MAPPING } from "@/lib/seeker/corpus";
import { demoIndex } from "@/lib/demo";
import {
  Badge,
  Bar,
  EmptyState,
  KeyValue,
  Panel,
  Segmented,
  Stack,
  Stat,
  StatRow,
  Table,
  Td,
  TextInput,
  TokenChip,
  Tr,
  formatNumber,
} from "@/components/ui";

export function CorpusExplorer() {
  const index = demoIndex();
  const [selected, setSelected] = useState(0);
  const [field, setField] = useState<"title" | "body" | "tags" | "status" | "author">("title");
  const [filter, setFilter] = useState("");

  const doc = CORPUS[selected];
  const stats = index.fieldStats(field);
  const terms = useMemo(() => {
    const all = index.termStats(field);
    const needle = filter.trim().toLowerCase();
    return needle ? all.filter((t) => t.term.includes(needle)) : all;
  }, [index, field, filter]);

  const analysed = useMemo(
    () => analyze(field === "title" ? doc.title : field === "body" ? doc.body : doc.status,
      field === "title" || field === "body" ? DEFAULT_ANALYZER : KEYWORD_ANALYZER),
    [doc, field],
  );

  const maxDf = Math.max(...terms.map((t) => t.docFreq), 1);

  return (
    <Stack gap={4}>
      <Panel title="The corpus" subtitle={`${CORPUS.length} documents. Small enough to hold in your head, varied enough to exercise every structure in the book.`}>
        <StatRow>
          <Stat label="documents" value={index.numDocs} />
          <Stat label="title vocabulary" value={index.fieldStats("title").vocabularySize} />
          <Stat label="body vocabulary" value={index.fieldStats("body").vocabularySize} />
          <Stat label="avg title length" value={formatNumber(index.avgFieldLength("title"), 2)} unit="terms" />
        </StatRow>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <Panel title="Documents" dense>
          <div className="max-h-[520px] overflow-y-auto">
            <Table head={["id", "title", "status", "price", "rating"]} dense>
              {CORPUS.map((d, i) => (
                <Tr key={d.id} highlight={i === selected}>
                  <Td mono tone="muted">
                    <button type="button" onClick={() => setSelected(i)} className="hover:text-ink">
                      {d.id}
                    </button>
                  </Td>
                  <Td>
                    <button type="button" onClick={() => setSelected(i)} className="text-left hover:text-accent-text">
                      {d.title}
                    </button>
                  </Td>
                  <Td mono tone="muted">{d.status}</Td>
                  <Td mono align="right" tone="muted">{d.price}</Td>
                  <Td mono align="right" tone="muted">{d.rating}</Td>
                </Tr>
              ))}
            </Table>
          </div>
        </Panel>

        <Stack gap={4}>
          <Panel title={doc.id} subtitle={doc.title}>
            <Stack gap={3}>
              <pre className="scroll-x rounded-lg border border-edge bg-code p-3 font-mono text-[11px] leading-relaxed text-muted">
                {JSON.stringify(doc, null, 2)}
              </pre>
              <div>
                <div className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">
                  {field} → indexed terms
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {analysed.tokens.map((token, i) => (
                    <TokenChip key={i} text={token.text} position={token.position} tone="accent" />
                  ))}
                </div>
              </div>
              <KeyValue
                items={[
                  { key: "title length", value: `${index.fieldLength("title", selected)} terms` },
                  { key: "body length", value: `${index.fieldLength("body", selected)} terms` },
                  { key: "tags", value: doc.tags.join(", ") },
                  { key: "location", value: `${doc.lat}, ${doc.lon}` },
                ]}
              />
            </Stack>
          </Panel>

          <Panel title="Mapping" dense>
            <Table head={["field", "type", "behaviour"]} dense>
              {MAPPING.map((m) => (
                <Tr key={m.name}>
                  <Td mono>{m.name}</Td>
                  <Td>
                    <Badge tone={m.type === "text" ? "accent" : m.type === "keyword" ? "info" : "warn"}>
                      {m.type}
                    </Badge>
                  </Td>
                  <Td tone="muted">{m.description}</Td>
                </Tr>
              ))}
            </Table>
          </Panel>
        </Stack>
      </div>

      <Panel
        title="Vocabulary"
        subtitle={`${stats.vocabularySize} distinct terms, ${stats.postingsEntries} postings entries`}
        actions={
          <Segmented
            value={field}
            onChange={setField}
            options={[
              { value: "title", label: "title" },
              { value: "body", label: "body" },
              { value: "tags", label: "tags" },
              { value: "status", label: "status" },
              { value: "author", label: "author" },
            ]}
          />
        }
      >
        <Stack gap={3}>
          <TextInput label="Filter terms" value={filter} onChange={setFilter} placeholder="kube" />
          <div className="max-h-[400px] overflow-y-auto">
            <Table head={["term", "docFreq", "totalTermFreq", ""]} dense>
              {terms.map((t) => (
                <Tr key={t.term}>
                  <Td mono>{t.term}</Td>
                  <Td mono align="right">{t.docFreq}</Td>
                  <Td mono align="right" tone="muted">{t.totalTermFreq}</Td>
                  <Td><Bar value={t.docFreq} max={maxDf} tone="accent" width={120} /></Td>
                </Tr>
              ))}
            </Table>
          </div>
          {terms.length === 0 && <EmptyState>No term matches that filter.</EmptyState>}
        </Stack>
      </Panel>
    </Stack>
  );
}
