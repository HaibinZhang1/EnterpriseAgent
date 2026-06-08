import type { ExtensionKind } from '../../types/desktop';

export interface PackageInspection {
  fileName: string;
  size: number;
  sha256?: string;
  fileCount: number;
  entries: string[];
  rootContainsSkillManifest?: boolean;
  wrappedSkillManifestPath?: string;
  skillManifestPreview?: string;
  metadata: PackageMetadata;
  warnings: string[];
}

export interface PackageMetadata {
  extensionId?: string;
  name?: string;
  description?: string;
  version?: string;
}

interface ZipEntryInfo {
  path: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const localFileHeaderSignature = 0x04034b50;
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;

export async function inspectPublishPackage(file: File, extensionType: ExtensionKind): Promise<PackageInspection> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = parseZipEntries(bytes);
  const sha256 = await sha256Hex(bytes);
  const inspection: PackageInspection = {
    fileName: file.name,
    size: file.size,
    sha256,
    fileCount: entries.length,
    entries: entries.map((entry) => entry.path),
    metadata: {},
    warnings: []
  };

  if (!file.name.toLowerCase().endsWith('.zip') && extensionType !== 'mcp') {
    inspection.warnings.push('建议上传 zip 包，服务端会执行最终校验。');
  }

  if (extensionType !== 'skill') {
    return inspection;
  }

  const rootSkill = entries.find((entry) => entry.path === 'SKILL.md');
  const wrappedSkill = entries.find((entry) => /(^|\/)SKILL\.md$/.test(entry.path));
  inspection.rootContainsSkillManifest = Boolean(rootSkill);
  inspection.wrappedSkillManifestPath = rootSkill ? undefined : wrappedSkill?.path;

  if (!rootSkill) {
    inspection.warnings.push(wrappedSkill
      ? `Skill 包顶层必须包含 SKILL.md，当前检测到 ${wrappedSkill.path}。`
      : 'Skill 包顶层必须包含 SKILL.md。');
    return inspection;
  }

  const content = await readZipEntryText(bytes, rootSkill);
  if (!content) {
    inspection.warnings.push('已检测到顶层 SKILL.md，但无法在客户端读取内容；服务端会继续校验。');
    return inspection;
  }

  inspection.skillManifestPreview = content.slice(0, 800);
  inspection.metadata = parseSkillFrontmatter(content);
  return inspection;
}

export function parseSkillFrontmatter(content: string): PackageMetadata {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return {};
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) return {};
  const frontmatter = normalized.slice(4, end).split('\n');
  const metadata: PackageMetadata = {};
  for (const line of frontmatter) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1].toLowerCase().replace(/-/g, '_');
    const value = unquote(match[2].trim());
    if (!value) continue;
    if (key === 'id' || key === 'extensionid' || key === 'extension_id') metadata.extensionId = value;
    if (key === 'name') metadata.name = value;
    if (key === 'description' || key === 'summary') metadata.description = value;
    if (key === 'version') metadata.version = value;
  }
  return metadata;
}

function parseZipEntries(bytes: Uint8Array): ZipEntryInfo[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directoryOffset = findCentralDirectoryOffset(view);
  if (directoryOffset === undefined) return [];

  const entries: ZipEntryInfo[] = [];
  let offset = directoryOffset;
  while (offset + 46 <= view.byteLength && view.getUint32(offset, true) === centralDirectorySignature) {
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const path = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    if (path && !path.endsWith('/')) {
      entries.push({ path, compressionMethod, compressedSize, localHeaderOffset });
    }
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findCentralDirectoryOffset(view: DataView): number | undefined {
  const maxCommentLength = 0xffff;
  const minOffset = Math.max(0, view.byteLength - maxCommentLength - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === endOfCentralDirectorySignature) {
      return view.getUint32(offset + 16, true);
    }
  }
  return undefined;
}

async function readZipEntryText(bytes: Uint8Array, entry: ZipEntryInfo): Promise<string | undefined> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > view.byteLength || view.getUint32(offset, true) !== localFileHeaderSignature) {
    return undefined;
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.byteLength) return undefined;
  const data = bytes.slice(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return new TextDecoder().decode(data);
  }
  if (entry.compressionMethod !== 8 || typeof DecompressionStream === 'undefined') {
    return undefined;
  }
  const stream = new Blob([arrayBufferCopy(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBufferCopy(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
