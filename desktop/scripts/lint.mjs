import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['src', 'tests', 'scripts'];
const failures = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

for (const scanRoot of scanRoots) {
  const dir = path.join(root, scanRoot);
  const files = await walk(dir);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const rel = path.relative(root, file);
    const markerPattern = new RegExp(['TO','DO'].join('') + '|PLACE' + 'HOLDER', 'i');
    if (markerPattern.test(text)) failures.push(`${rel}: contains disallowed unfinished-work marker`);
    if (rel.startsWith('src/renderer/') && /from ['"]node:|require\(|fs\./.test(text)) {
      failures.push(`${rel}: renderer must not use Node APIs`);
    }
    if (rel.startsWith('src/preload/') && /exposeInMainWorld\([^,]+,\s*ipcRenderer/.test(text)) {
      failures.push(`${rel}: preload must not expose raw ipcRenderer`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('desktop lint passed');
