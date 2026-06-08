import { describe, expect, it } from 'vitest';
import { inspectPublishPackage, parseSkillFrontmatter } from '../src/renderer/features/publish/packageInspection';

describe('publish package inspection', () => {
  it('extracts Skill frontmatter from a top-level SKILL.md zip entry', async () => {
    const file = new File([blobPart(zip([
      ['SKILL.md', '---\nextensionId: flow-skill\nname: Flow Skill\ndescription: Runs a flow\nversion: 1.2.3\n---\n# Flow Skill'],
      ['README.md', 'hello']
    ]))], 'flow-skill.zip', { type: 'application/zip' });

    const inspection = await inspectPublishPackage(file, 'skill');

    expect(inspection.rootContainsSkillManifest).toBe(true);
    expect(inspection.fileCount).toBe(2);
    expect(inspection.metadata).toEqual({
      extensionId: 'flow-skill',
      name: 'Flow Skill',
      description: 'Runs a flow',
      version: '1.2.3'
    });
    expect(inspection.warnings).toEqual([]);
    expect(inspection.sha256).toHaveLength(64);
  });

  it('reports wrapped Skill packages before server upload', async () => {
    const file = new File([blobPart(zip([['flow-skill/SKILL.md', '# Wrapped']]))], 'wrapped.zip', { type: 'application/zip' });

    const inspection = await inspectPublishPackage(file, 'skill');

    expect(inspection.rootContainsSkillManifest).toBe(false);
    expect(inspection.wrappedSkillManifestPath).toBe('flow-skill/SKILL.md');
    expect(inspection.warnings[0]).toContain('顶层必须包含 SKILL.md');
  });

  it('parses quoted frontmatter aliases', () => {
    expect(parseSkillFrontmatter('---\nextension-id: "quoted-id"\nsummary: \'short text\'\n---\n# Skill')).toEqual({
      extensionId: 'quoted-id',
      description: 'short text'
    });
  });
});

function zip(entries: Array<[string, string]>): Uint8Array {
  const fileParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const contentBytes = new TextEncoder().encode(content);
    const local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, contentBytes.length, true);
    localView.setUint32(22, contentBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(contentBytes, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(20, contentBytes.length, true);
    centralView.setUint32(24, contentBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    fileParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  const result = new Uint8Array(centralOffset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...fileParts, ...centralParts, end]) {
    result.set(part, cursor);
    cursor += part.length;
  }
  return result;
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
