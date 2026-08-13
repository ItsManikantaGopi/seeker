/**
 * Render every lab component and fail on any error.
 *
 * The labs are client-only (`ssr: false`), so a crash inside one would never
 * show up in the HTML the build produces — the route would still return 200 and
 * the page would be blank. This renders each of the 43 chapter labs plus the
 * playground and corpus explorer, so a broken lab fails here instead of in
 * someone's browser.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentType } from "react";

import * as part01 from "../components/labs/part01";
import * as part02 from "../components/labs/part02";
import * as part03 from "../components/labs/part03";
import * as part04 from "../components/labs/part04";
import * as part05 from "../components/labs/part05";
import * as part06 from "../components/labs/part06";
import * as part07 from "../components/labs/part07";
import * as part08 from "../components/labs/part08";
import * as part09 from "../components/labs/part09";
import * as part10 from "../components/labs/part10";
import * as part11 from "../components/labs/part11";
import * as part12 from "../components/labs/part12";
import * as part13 from "../components/labs/part13";
import { Playground } from "../components/playground";
import { CorpusExplorer } from "../components/corpus-explorer";
import { CHAPTERS } from "../lib/chapters";

const LABS: Record<string, ComponentType> = {
  Ch01: part01.Ch01, Ch02: part01.Ch02, Ch03: part01.Ch03,
  Ch04: part02.Ch04, Ch05: part02.Ch05, Ch06: part02.Ch06,
  Ch07: part03.Ch07, Ch08: part03.Ch08, Ch09: part03.Ch09,
  Ch10: part04.Ch10, Ch11: part04.Ch11, Ch12: part04.Ch12,
  Ch13: part05.Ch13, Ch14: part05.Ch14, Ch15: part05.Ch15,
  Ch16: part06.Ch16, Ch17: part06.Ch17, Ch18: part06.Ch18, Ch19: part06.Ch19,
  Ch20: part07.Ch20, Ch21: part07.Ch21, Ch22: part07.Ch22,
  Ch23: part08.Ch23, Ch24: part08.Ch24, Ch25: part08.Ch25, Ch26: part08.Ch26,
  Ch27: part09.Ch27, Ch28: part09.Ch28, Ch29: part09.Ch29, Ch30: part09.Ch30,
  Ch31: part10.Ch31, Ch32: part10.Ch32, Ch33: part10.Ch33, Ch34: part10.Ch34,
  Ch35: part11.Ch35, Ch36: part11.Ch36, Ch37: part11.Ch37,
  Ch38: part12.Ch38, Ch39: part12.Ch39, Ch40: part12.Ch40,
  Ch41: part13.Ch41, Ch42: part13.Ch42, Ch43: part13.Ch43,
  Playground: Playground as ComponentType,
  CorpusExplorer: CorpusExplorer as ComponentType,
};

let failures = 0;
const timings: { name: string; ms: number; bytes: number }[] = [];

for (const [name, Component] of Object.entries(LABS)) {
  const started = performance.now();
  try {
    const html = renderToStaticMarkup(createElement(Component));
    const ms = performance.now() - started;
    timings.push({ name, ms, bytes: html.length });
    if (html.length < 200) {
      failures++;
      console.log(`SUSPICIOUS  ${name} rendered only ${html.length} bytes`);
    }
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    const stack = error instanceof Error ? error.stack?.split("\n").slice(1, 4) : [];
    for (const line of stack ?? []) console.log(`      ${line.trim()}`);
  }
}

// Every chapter must have a lab, and every lab must belong to a chapter.
const expected = CHAPTERS.length;
const rendered = Object.keys(LABS).filter((k) => k.startsWith("Ch")).length;
if (rendered !== expected) {
  failures++;
  console.log(`FAIL  ${rendered} labs rendered but there are ${expected} chapters`);
}

timings.sort((a, b) => b.ms - a.ms);
console.log("\nSlowest labs to render:");
for (const t of timings.slice(0, 6)) {
  console.log(`  ${t.name.padEnd(16)} ${t.ms.toFixed(1).padStart(7)} ms   ${(t.bytes / 1024).toFixed(0)} KB of markup`);
}

console.log(
  failures === 0
    ? `\nall ${Object.keys(LABS).length} components rendered without error`
    : `\n${failures} FAILURE(S)`,
);
if (failures > 0) process.exit(1);
