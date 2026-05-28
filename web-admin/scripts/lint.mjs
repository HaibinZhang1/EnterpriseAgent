import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const allowed = new Set([".ts", ".tsx", ".css", ".html", ".json", ".mjs"]);
const ignored = new Set(["node_modules", "dist", "coverage"]);
let failed = false;

async function walk(directory) {
  for (const entry of await readdir(directory)) {
    if (ignored.has(entry)) {
      continue;
    }
    const fullPath = path.join(directory, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (!allowed.has(path.extname(entry))) {
      continue;
    }
    const content = await readFile(fullPath, "utf8");
    const relative = path.relative(root, fullPath);
    if (/[ \t]$/m.test(content)) {
      console.error(`${relative}: trailing whitespace`);
      failed = true;
    }
    if (!content.endsWith("\n")) {
      console.error(`${relative}: missing trailing newline`);
      failed = true;
    }
    if (content.includes("T" + "ODO")) {
      console.error(`${relative}: placeholder marker is not allowed`);
      failed = true;
    }
  }
}

await walk(root);

if (failed) {
  process.exit(1);
}

console.log("web-admin lint passed");
