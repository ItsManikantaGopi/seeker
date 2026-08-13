"use client";

import dynamic from "next/dynamic";

/**
 * The playground reports how long the query actually took, which is a different
 * number on the server than in the browser. Rendering it on both sides would be
 * a guaranteed hydration mismatch, so it is client-only.
 *
 * `ssr: false` is only legal inside a Client Component, hence this wrapper —
 * the page itself stays a Server Component so it can still export metadata.
 */
export const PlaygroundClient = dynamic(
  () => import("./playground").then((m) => m.Playground),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-edge bg-raised p-8 text-center">
        <div className="pulse font-mono text-[12.5px] text-faint">building the index…</div>
      </div>
    ),
  },
);
