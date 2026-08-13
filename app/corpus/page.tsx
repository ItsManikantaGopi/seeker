import dynamic from "next/dynamic";

const CorpusExplorer = dynamic(() =>
  import("@/components/corpus-explorer").then((m) => m.CorpusExplorer),
);

export const metadata = {
  title: "The corpus",
  description: "Every document, field and term in the index that every lab on this site runs against.",
};

export default function CorpusPage() {
  return (
    <div className="mx-auto max-w-[1480px] px-4 py-6 lg:px-8 lg:py-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink lg:text-[30px]">
          The corpus
        </h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted">
          One index, shared by every chapter, so a document frequency you see in chapter 8 is the same one
          chapter 27 is planning around. It contains repeated terms for saturation, wildly different field
          lengths for length normalisation, a deliberate misspelling for fuzzy search, shared prefixes for the
          trie and FST, prices for the point index, and coordinates for BKD.
        </p>
      </header>
      <CorpusExplorer />
    </div>
  );
}
