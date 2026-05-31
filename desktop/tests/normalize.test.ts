import { describe, expect, it } from 'vitest';
import { normalizeCatalogHome } from '../src/renderer/lib/normalize';

describe('renderer normalizers', () => {
  it('unwraps typed community home buckets returned by the server', () => {
    const home = normalizeCatalogHome({
      skill: {
        hot: [{ extensionId: 'skill-one', type: 'SKILL', name: 'Skill One', starCount: 5 }]
      },
      mcpServer: {
        hot: [],
        star: [{ extensionId: 'mcp-one', type: 'MCP_SERVER', name: 'MCP One', usageCount: 3 }]
      },
      plugin: {
        download: [{ extensionId: 'plugin-one', type: 'PLUGIN', name: 'Plugin One', downloadCount: 7 }]
      }
    });

    expect(home.skills.map(item => item.id)).toEqual(['skill-one']);
    expect(home.mcps.map(item => item.id)).toEqual(['mcp-one']);
    expect(home.plugins.map(item => item.id)).toEqual(['plugin-one']);
    expect(home.skills[0].type).toBe('skill');
    expect(home.mcps[0].type).toBe('mcp');
    expect(home.plugins[0].type).toBe('plugin');
  });
});
