import { PlaygroundClient } from "@/components/playground-client";

export const metadata = {
  title: "Search playground",
  description: "The whole Seeker engine on one page: query parsing, execution plan, BM25 explanations and the real work each query does.",
};

export default function PlaygroundPage() {
  return (
    <div className="mx-auto max-w-[1480px] px-4 py-6 lg:px-8 lg:py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink lg:text-[30px]">
          Search playground
        </h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted">
          Everything from chapters 3 through 27, wired together. Type a query, watch it parse into an
          abstract syntax tree, compile into a tree of iterators, expand against the term dictionary, and
          score with BM25 — with the arithmetic for every hit available underneath it.
        </p>
      </header>
      <PlaygroundClient />
    </div>
  );
}
