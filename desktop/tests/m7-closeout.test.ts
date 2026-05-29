import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { initializeAppDataLayout } from '../src/main/config/app-paths';
import { LocalDatabase } from '../src/main/db/local-database';
import { LocalEventQueue } from '../src/main/events/local-event-queue';
import { LocalEventSyncService } from '../src/main/events/local-event-sync-service';
import { LocalLifecycleRepository } from '../src/main/lifecycle/local-lifecycle-repository';
import { McpService } from '../src/main/mcp/mcp-service';
import { PluginService } from '../src/main/plugin/plugin-service';
import { MemorySecureStore } from '../src/main/security/secure-store';
import { tempRoot } from './test-utils';

describe('M7 closeout MCP behavior', () => {
  it('executes HTTP/adapter-safe connection tests and blocks local command probes', async () => {
    const mcp = new McpService(new MemorySecureStore());
    const reachable = await mcp.executeConnectionTest({ type: 'HTTP_HEALTH', url: 'http://mcp.local/health' }, {
      fetchImpl: async () => new Response('{}', { status: 200 })
    });
    expect(reachable.status).toBe('reachable');

    const unreachable = await mcp.executeConnectionTest({ type: 'HTTP_HEALTH', url: 'http://mcp.local/health' }, {
      fetchImpl: async () => new Response('{}', { status: 503 })
    });
    expect(unreachable).toMatchObject({ status: 'unreachable', statusCode: 503 });

    const blocked = await mcp.executeConnectionTest({ type: 'LOCAL_COMMAND', command: 'echo unsafe' });
    expect(blocked.status).toBe('blocked-by-policy');
  });

  it('preserves local variable values and reports variable additions/deletions during MCP updates', async () => {
    const secureStore = new MemorySecureStore();
    const mcp = new McpService(secureStore);
    const result = await mcp.createUpdatePlan({
      definition: {
        extensionId: 'mcp-vars',
        version: '2.0.0',
        configTemplate: { command: 'remote' },
        variablesSchema: [
          { name: 'apiKey', sensitive: true, required: true },
          { name: 'endpoint', required: true },
          { name: 'newFlag' }
        ]
      },
      previousVariablesSchema: [
        { name: 'apiKey', sensitive: true, required: true },
        { name: 'endpoint', required: true },
        { name: 'removedFlag' }
      ],
      existingVariables: {
        apiKey: { secretRef: 'mcp.variable.mcp-vars.apiKey' },
        endpoint: 'https://old.example.test',
        removedFlag: 'legacy'
      },
      targetConfigPath: '/tmp/mcp.json',
      variables: {}
    });

    expect(result.secretRefs.apiKey).toBe('mcp.variable.mcp-vars.apiKey');
    expect(result.variableChanges.preserved.sort()).toEqual(['apiKey', 'endpoint']);
    expect(result.variableChanges.added).toEqual(['newFlag']);
    expect(result.variableChanges.deleted).toEqual(['removedFlag']);
    expect(JSON.stringify(result.redactedPreview)).toContain('https://old.example.test');

    await expect(mcp.createUpdatePlan({
      definition: {
        extensionId: 'mcp-vars',
        version: '2.0.0',
        configTemplate: {},
        variablesSchema: [{ name: 'newRequired', required: true }]
      },
      previousVariablesSchema: [],
      existingVariables: {},
      targetConfigPath: '/tmp/mcp.json',
      variables: {}
    })).rejects.toThrow(/requires user input/);
  });

  it('enqueues operation-specific MCP connection test events', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);
      const mcp = new McpService(new MemorySecureStore());
      await mcp.executeConnectionTest({ type: 'HTTP_HEALTH', url: 'http://mcp.local/health' }, {
        extensionId: 'mcp-event',
        version: '1.0.0',
        deviceID: 'device-1',
        eventQueue: queue,
        fetchImpl: async () => new Response('{}', { status: 200 })
      });
      const event = queue.listPending()[0];
      expect(event.eventType).toBe('MCP_CONNECTION_TEST');
      expect(event.extensionID).toBe('mcp-event');
      expect(event.result).toBe('SUCCESS');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});

describe('M7 closeout plugin manual-download behavior', () => {
  it('surfaces manual installation instructions without auto-installing', () => {
    const tempTarget = path.join('/tmp', 'plugins');
    const plan = new PluginService().createPlan({
      extensionId: 'plugin-manual',
      version: '1.0.0',
      installMode: 'MANUAL_DOWNLOAD',
      targetPath: tempTarget,
      manualInstructions: 'Open the downloaded zip and install it from the tool marketplace.',
      manualInstructionsUrl: 'https://intranet.example/manual/plugin-manual'
    });
    expect(plan.summary.warnings).toContain('manual-download uses controlled download and does not auto-install');
    expect(plan.steps.map((step) => step.stepId)).toEqual(['open-manual-instructions', 'record-manual-download']);
    expect(plan.steps[0].content).toContain('Open the downloaded zip');
  });
});

describe('M7 closeout local-event sync behavior', () => {
  it('applies serverStateHints to local lifecycle state with restrictive precedence', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const lifecycle = new LocalLifecycleRepository(db);
      await lifecycle.recordSkillInstalled({ extensionId: 'ext-risk', version: '1.0.0' });
      await lifecycle.recordMcpInstallation({ extensionId: 'ext-risk', target: 'codex', status: 'installed' });
      await lifecycle.recordPluginInstallation({ extensionId: 'ext-risk', target: 'codex', status: 'installed' });

      const summary = await lifecycle.applyServerStateHints([
        { extensionId: 'ext-risk', state: 'SCOPE_REDUCED' },
        { extensionId: 'ext-risk', state: 'SECURITY_DELISTED', message: 'blocked' }
      ]);
      expect(summary).toEqual({ applied: 1, ignored: 1 });
      expect(db.query<{ status: string }>('select status from local_extensions where extension_id = ?', ['ext-risk'])[0].status).toBe('security_blocked');
      expect(db.query<{ status: string }>('select status from mcp_local_installations where extension_id = ?', ['ext-risk'])[0].status).toBe('security_blocked');
      expect(db.query<{ status: string }>('select status from plugin_local_installations where extension_id = ?', ['ext-risk'])[0].status).toBe('security_blocked');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });

  it('syncs after network recovery, applies hints, and preserves retryable events on failure', async () => {
    const temp = await tempRoot();
    try {
      const paths = await initializeAppDataLayout(temp.root);
      const db = new LocalDatabase(paths.localDbFile);
      await db.initialize();
      const queue = new LocalEventQueue(db);
      await queue.enqueue({ idempotencyKey: 'recover-ok', deviceID: 'device-1', extensionID: 'ext-sync', eventType: 'MCP_CONFIG_UPDATE' });
      const appliedHints: string[] = [];
      const sync = new LocalEventSyncService(queue, async (events) => ({
        acknowledgements: events.map((event) => ({ idempotencyKey: event.idempotencyKey, result: 'accepted' })),
        serverStateHints: [{ extensionId: 'ext-sync', state: 'SECURITY_DELISTED' }]
      }), {
        applyServerStateHints: async (hints) => {
          appliedHints.push(...hints.map((hint) => hint.state));
          return { applied: hints.length, ignored: 0 };
        },
        now: () => 1_000,
        jitter: () => 0
      });
      const skipped = await sync.syncAfterNetworkRecovery({ online: false, previousOnline: false, reason: 'online-transition' });
      expect(skipped.skipped).toBe(true);
      const summary = await sync.syncAfterNetworkRecovery({ online: true, previousOnline: false, reason: 'online-transition' });
      expect(summary.accepted).toBe(1);
      expect(summary.hintsApplied).toBe(1);
      expect(appliedHints).toEqual(['SECURITY_DELISTED']);

      await queue.enqueue({ idempotencyKey: 'recover-fail', deviceID: 'device-1', extensionID: 'ext-sync', eventType: 'MCP_CONFIG_UPDATE' });
      const failing = new LocalEventSyncService(queue, async () => { throw new Error('network down'); }, { now: () => 2_000, jitter: () => 0 });
      const failed = await failing.syncAfterNetworkRecovery({ online: true, previousOnline: false, reason: 'online-transition' });
      expect(failed.failed).toBe(1);
      expect(failed.nextRetryAtMs).toBeGreaterThan(2_000);
      expect(queue.findByIdempotencyKey('recover-fail')?.status).toBe('retryable');
      await db.close();
    } finally {
      await temp.cleanup();
    }
  });
});
