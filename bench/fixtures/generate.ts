/**
 * Writes the deterministic fixtures to disk as inspectable `.md` files.
 *
 *   node --experimental-strip-types bench/fixtures/generate.ts
 *
 * The bench itself does NOT need these files (it calls `makeDoc` directly), but
 * committing small.md / medium.md lets a reader eyeball the exact workload. The
 * 1 MB large.md is left to regenerate on demand (see bench/.gitignore).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeDoc, WORKLOADS } from './gen.ts';

const here = dirname(fileURLToPath(import.meta.url));

for (const [name, bytes] of Object.entries(WORKLOADS)) {
  const doc = makeDoc(bytes);
  const file = join(here, `${name}.md`);
  writeFileSync(file, doc, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`${name.padEnd(7)} → ${file}  (${doc.length} bytes)`);
}
