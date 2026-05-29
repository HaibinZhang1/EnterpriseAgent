import { createHash, randomUUID } from 'node:crypto';
import type { SecureStore } from '../security/secure-store';
import type { ExecutionPlan } from '../executor/types';
import type { LocalEventQueue } from '../events/local-event-queue';
import { redactForLog } from '../../shared/redaction';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';

export interface McpDefinition {
  extensionId: string;
  version: string;
  configTemplate: Record<string, unknown>;
  variablesSchema?: Array<{ name: string; sensitive?: boolean; required?: boolean }>;
  connectionTest?: { type: string; command?: string; url?: string };
}

export interface McpConfigPlanInput {
  definition: McpDefinition;
  targetConfigPath: string;
  variables: Record<string, string>;
  existingVariables?: Record<string, string | { secretRef: string }>;
  previousVariablesSchema?: McpDefinition['variablesSchema'];
  dryRun?: boolean;
  requestID?: string;
}

export interface McpVariableChanges {
  added: string[];
  deleted: string[];
  preserved: string[];
  needsInput: string[];
}

export interface McpConfigPlanOutput {
  plan: ExecutionPlan;
  redactedPreview: unknown;
  secretRefs: Record<string, string>;
  variableChanges: McpVariableChanges;
  managedConfigId: string;
  fullConfigRef: string;
}

export type McpConnectionTestStatus = 'reachable' | 'unreachable' | 'unsupported-check' | 'blocked-by-policy' | 'needs-user-input';

export interface McpConnectionTestResult {
  status: McpConnectionTestStatus;
  statusCode?: number;
  errorCode?: string;
  message?: string;
}

export interface McpConnectionTestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  requestID?: string;
  extensionId?: string;
  version?: string;
  deviceID?: string;
  eventQueue?: LocalEventQueue;
}

export class McpService {
  constructor(private readonly secureStore: SecureStore) {}

  async createConfigWritePlan(input: McpConfigPlanInput): Promise<McpConfigPlanOutput> {
    this.validateConnectionTest(input.definition.connectionTest, input.requestID);
    const dryRun = input.dryRun ?? true;
    const secretRefs: Record<string, string> = {};
    const rendered = { ...input.definition.configTemplate };
    const variableChanges = analyzeVariableChanges(input.definition.variablesSchema, input.previousVariablesSchema);
    for (const variable of input.definition.variablesSchema ?? []) {
      const provided = input.variables[variable.name];
      const existing = input.existingVariables?.[variable.name];
      const value = provided ?? (typeof existing === 'string' ? existing : undefined);
      const existingSecretRef = isSecretRef(existing) ? existing.secretRef : undefined;
      if (variable.required && value === undefined && !existingSecretRef) {
        variableChanges.needsInput.push(variable.name);
        throw new DesktopErrorException(makeDesktopError('validation_failed', `MCP variable ${variable.name} requires user input`, input.requestID, { variable: variable.name }));
      }
      if (provided === undefined && existing !== undefined) variableChanges.preserved.push(variable.name);
      if (variable.sensitive && existingSecretRef && provided === undefined) {
        secretRefs[variable.name] = existingSecretRef;
        rendered[variable.name] = { secretRef: existingSecretRef };
      } else if (variable.sensitive && value !== undefined) {
        const ref = `mcp.variable.${input.definition.extensionId}.${variable.name}` as const;
        if (!dryRun) await this.secureStore.set(ref, value);
        secretRefs[variable.name] = ref;
        rendered[variable.name] = { secretRef: ref };
      } else if (value !== undefined) {
        rendered[variable.name] = value;
      }
    }
    const now = new Date().toISOString();
    const managedConfigId = managedMcpConfigId(input.definition.extensionId, input.targetConfigPath);
    const fullConfigRef: `mcp.managed-config.${string}` = `mcp.managed-config.${managedConfigId}`;
    const managedEntry = {
      managedConfigId,
      managedBy: 'Enterprise Agent Hub',
      extensionId: input.definition.extensionId,
      version: input.definition.version,
      fullConfigRef,
      config: rendered
    };
    if (!dryRun) await this.secureStore.set(fullConfigRef, JSON.stringify(managedEntry));
    const redactedPreview = redactForLog(managedEntry);
    return {
      redactedPreview,
      secretRefs,
      variableChanges,
      managedConfigId,
      fullConfigRef,
      plan: {
        planId: `mcp_plan_${randomUUID()}`,
        requestId: input.requestID,
        operation: 'MCP_CONFIG_WRITE',
        extensionId: input.definition.extensionId,
        version: input.definition.version,
        createdAt: now,
        dryRun,
        riskLevel: 'MEDIUM',
        summary: { title: 'Write MCP config', description: `Write managed MCP config for ${input.definition.extensionId}`, targetCount: 1, warnings: variableWarnings(variableChanges) },
        preconditions: [],
        steps: [{ stepId: 'upsert-mcp-config', action: 'json-upsert', description: 'Upsert managed MCP config entry', targetPath: input.targetConfigPath, content: JSON.stringify(managedEntry, null, 2), rollbackable: true, managed: true, metadata: { managedConfigId } }],
        rollbackPolicy: { strategy: 'best-effort' },
        idempotencyKey: `mcp:${input.definition.extensionId}:${input.definition.version}:config:${input.targetConfigPath}`
      }
    };
  }

  createUninstallPlan(input: Omit<McpConfigPlanInput, 'variables'>): ExecutionPlan {
    const now = new Date().toISOString();
    return {
      planId: `mcp_plan_${randomUUID()}`,
      requestId: input.requestID,
      operation: 'MCP_CONFIG_UNINSTALL',
      extensionId: input.definition.extensionId,
      version: input.definition.version,
      createdAt: now,
      dryRun: input.dryRun ?? true,
      riskLevel: 'MEDIUM',
      summary: { title: 'Remove MCP config', description: `Remove managed MCP config for ${input.definition.extensionId}`, targetCount: 1, warnings: ['Only Enterprise Agent Hub managed config files are removed'] },
      preconditions: [],
      steps: [{ stepId: 'remove-mcp-config', action: 'json-remove', description: 'Remove only the Enterprise Agent Hub managed MCP config entry', targetPath: input.targetConfigPath, rollbackable: true, managed: true, metadata: { managedConfigId: managedMcpConfigId(input.definition.extensionId, input.targetConfigPath) } }],
      rollbackPolicy: { strategy: 'best-effort' },
      idempotencyKey: `mcp:${input.definition.extensionId}:${input.definition.version}:uninstall:${input.targetConfigPath}`
    };
  }

  async createUpdatePlan(input: McpConfigPlanInput): Promise<McpConfigPlanOutput> {
    const output = await this.createConfigWritePlan(input);
    return {
      ...output,
      plan: {
        ...output.plan,
        operation: 'MCP_CONFIG_UPDATE',
        summary: { ...output.plan.summary, title: 'Update MCP config', warnings: variableWarnings(output.variableChanges) },
        idempotencyKey: `mcp:${input.definition.extensionId}:${input.definition.version}:update:${input.targetConfigPath}`
      }
    };
  }

  async executeConnectionTest(test: McpDefinition['connectionTest'], options: McpConnectionTestOptions = {}): Promise<McpConnectionTestResult> {
    const result = await this.runConnectionTest(test, options);
    if (options.eventQueue && options.deviceID) {
      await options.eventQueue.enqueue({
        idempotencyKey: `mcp:${options.extensionId ?? 'unknown'}:${options.version ?? 'unknown'}:connection-test:${result.status}`,
        deviceID: options.deviceID,
        extensionID: options.extensionId,
        version: options.version,
        eventType: 'MCP_CONNECTION_TEST',
        result: result.status === 'reachable' ? 'SUCCESS' : 'FAILURE',
        errorCode: result.errorCode,
        payload: { status: result.status, statusCode: result.statusCode, message: result.message }
      });
    }
    return result;
  }

  validateConnectionTest(test: McpDefinition['connectionTest'], requestID?: string): void {
    if (!test) return;
    if (test.type === 'HTTP_HEALTH') return;
    if (test.type === 'LOCAL_COMMAND') {
      throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', 'Local MCP connection tests with commands are not executed in M7', requestID));
    }
    throw new DesktopErrorException(makeDesktopError('invalid_execution_plan', `Unsupported MCP connection test ${test.type}`, requestID));
  }

  private async runConnectionTest(test: McpDefinition['connectionTest'], options: McpConnectionTestOptions): Promise<McpConnectionTestResult> {
    if (!test) return { status: 'needs-user-input', errorCode: 'connection_test_missing', message: 'MCP connection test is not defined' };
    if (test.type === 'LOCAL_COMMAND') {
      return { status: 'blocked-by-policy', errorCode: 'local_command_blocked', message: 'Local MCP command checks require a separately authorized sandbox/allowlist' };
    }
    if (test.type !== 'HTTP_HEALTH') {
      return { status: 'unsupported-check', errorCode: 'unsupported_connection_test', message: `Unsupported MCP connection test ${test.type}` };
    }
    if (!test.url) return { status: 'needs-user-input', errorCode: 'connection_test_url_missing', message: 'HTTP health check URL is required' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
    try {
      const response = await (options.fetchImpl ?? fetch)(test.url, { method: 'GET', signal: controller.signal });
      return response.ok
        ? { status: 'reachable', statusCode: response.status }
        : { status: 'unreachable', statusCode: response.status, errorCode: 'http_health_unreachable' };
    } catch (error) {
      return {
        status: 'unreachable',
        errorCode: error instanceof Error && error.name === 'AbortError' ? 'http_health_timeout' : 'http_health_failed',
        message: error instanceof Error ? error.message : 'HTTP health check failed'
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function analyzeVariableChanges(current: McpDefinition['variablesSchema'] = [], previous: McpDefinition['variablesSchema'] = []): McpVariableChanges {
  const currentNames = new Set(current.map((variable) => variable.name));
  const previousNames = new Set(previous.map((variable) => variable.name));
  return {
    added: [...currentNames].filter((name) => !previousNames.has(name)).sort(),
    deleted: [...previousNames].filter((name) => !currentNames.has(name)).sort(),
    preserved: [],
    needsInput: []
  };
}

function variableWarnings(changes: McpVariableChanges): string[] {
  const warnings: string[] = [];
  if (changes.added.length > 0) warnings.push(`MCP variables added: ${changes.added.join(', ')}`);
  if (changes.deleted.length > 0) warnings.push(`MCP variables removed: ${changes.deleted.join(', ')}`);
  if (changes.needsInput.length > 0) warnings.push(`MCP variables require user input: ${changes.needsInput.join(', ')}`);
  return warnings;
}

function isSecretRef(value: unknown): value is { secretRef: string } {
  return Boolean(value && typeof value === 'object' && 'secretRef' in value && typeof value.secretRef === 'string');
}

function managedMcpConfigId(extensionId: string, targetConfigPath: string): string {
  const suffix = createHash('sha256').update(`${extensionId}:${targetConfigPath}`).digest('hex').slice(0, 10);
  return `eah_mcp_${extensionId.replace(/[^a-z0-9_-]+/gi, '_')}_${suffix}`;
}
