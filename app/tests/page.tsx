import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import { Reveal, SectionKicker } from "@/components/cinema";

const TestRunner = dynamic(() => import("@/components/labs/part13").then((m) => m.Ch42));

export const metadata = {
  title: "Differential tests",
  description: "Chapter 42's testing strategy, running live: a golden corpus, and a slow reference implementation as the oracle for every fast one.",
};

export default function TestsPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 lg:px-8 lg:py-8">
      <Reveal>
        <header className="mb-6">
          <SectionKicker>dailies · nothing changes the answer</SectionKicker>
          <h1
            className="cine-rise mt-3 text-[26px] font-bold leading-tight tracking-tight text-ink lg:text-[30px]"
            style={{ "--rise-delay": "80ms", "--rise-y": "14px" } as CSSProperties}
          >
            Differential tests
          </h1>
          <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted">
            Every optimisation in this book is only allowed to be faster — never to change the answer. Each
            suite below runs a deliberately slow, obviously-correct implementation alongside the optimised one
            and compares them. This is chapter 42, executing in your browser rather than being described.
          </p>
        </header>
      </Reveal>
      <TestRunner />
    </div>
  );
}
