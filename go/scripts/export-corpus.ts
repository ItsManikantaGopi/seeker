// Export the demo corpus from lib/seeker/corpus.ts into go/testdata/corpus.json
// so the Go engine indexes the exact same documents as the site.
//
// Run from the repo root: npx tsx go/scripts/export-corpus.ts
import { writeFileSync } from "node:fs";
import { CORPUS } from "../../lib/seeker/corpus";

// The Go side reads location as {lat, lon}; flatten the TS fields.
const docs = CORPUS.map(({ lat, lon, ...rest }) => ({
  ...rest,
  location: { lat, lon },
}));

writeFileSync(
  new URL("../testdata/corpus.json", import.meta.url),
  JSON.stringify(docs, null, 2) + "\n",
);
console.log(`exported ${docs.length} documents`);
