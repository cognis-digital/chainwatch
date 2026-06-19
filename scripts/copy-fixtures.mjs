// Copy JSON test fixtures into dist so the compiled tests can read them.
// tsc only emits .js for .ts inputs; fixture .json files must be copied.
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "test", "fixtures");
const dest = join(root, "dist", "test", "fixtures");

if (existsSync(src)) {
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log(`copied fixtures -> ${dest}`);
}
