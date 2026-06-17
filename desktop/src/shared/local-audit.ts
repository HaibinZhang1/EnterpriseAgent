import {
  AuditStatuses,
  LocalResourceTypes,
  PermissionCategories,
  PermissionItems,
  type AuditStatus,
  type AuditSummary,
  type LocalResourceType,
  type PermissionCategory,
  type PermissionSummary
} from './local-resources';
import { redactValue } from './redaction';

export const EnterpriseAuditRuleIds = {
  PROMPT_INJECTION: 'EA-AUD-001',
  RCE: 'EA-AUD-002',
  CREDENTIAL_THEFT: 'EA-AUD-003',
  PLAINTEXT_SECRETS: 'EA-AUD-004',
  SAFETY_BYPASS: 'EA-AUD-005',
  DANGEROUS_COMMANDS: 'EA-AUD-006',
  BROAD_PERMISSIONS: 'EA-AUD-007',
  SUPPLY_CHAIN: 'EA-AUD-008',
  UNKNOWN_SOURCE: 'EA-AUD-009',
  PERMISSION_COMBO_RISK: 'EA-AUD-010',
  CLI_CREDENTIAL_STORAGE: 'EA-AUD-011',
  CLI_NETWORK_ACCESS: 'EA-AUD-012',
  CLI_BINARY_SOURCE: 'EA-AUD-013',
  CLI_PERMISSION_SCOPE: 'EA-AUD-014',
  CLI_AGGREGATE_RISK: 'EA-AUD-015',
  MCP_COMMAND_INJECTION: 'EA-AUD-016',
  PLUGIN_SOURCE_TRUST: 'EA-AUD-017',
  PLUGIN_LIFECYCLE_SCRIPTS: 'EA-AUD-018'
} as const;

export type EnterpriseAuditRuleId = typeof EnterpriseAuditRuleIds[keyof typeof EnterpriseAuditRuleIds];

export const EnterpriseBlockRuleIds = {
  PATH_TRAVERSAL: 'EA-BLOCK-001',
  HASH_MISMATCH: 'EA-BLOCK-002',
  MCP_REQUIRED_VARIABLE_MISSING: 'EA-BLOCK-003',
  MCP_SENSITIVE_VARIABLE_PLAINTEXT: 'EA-BLOCK-004',
  CONFIG_DRIFT: 'EA-BLOCK-005',
  AUTHORIZATION_SHRINK: 'EA-BLOCK-006',
  MISSING_ROLLBACK_SNAPSHOT: 'EA-BLOCK-007'
} as const;

export type EnterpriseBlockRuleId = typeof EnterpriseBlockRuleIds[keyof typeof EnterpriseBlockRuleIds];
export type EnterpriseRuleId = EnterpriseAuditRuleId | EnterpriseBlockRuleId;

export const AuditSeverities = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
} as const;

export type AuditSeverity = typeof AuditSeverities[keyof typeof AuditSeverities];

export interface AuditRuleDefinition {
  id: EnterpriseRuleId;
  harnessRuleId: string;
  title: string;
  severity: AuditSeverity;
  deduction: number;
  applicableResourceTypes: LocalResourceType[];
  permissionCategory: PermissionCategory;
  description: string;
  remediation: string;
  blocker: boolean;
  acceptanceCategories: string[];
}

export interface AuditFindingLocation {
  resourceId: string;
  bindingId?: string;
  agentId?: string;
  projectId?: string;
  kitId?: string;
  path?: string;
  pathSummary?: string;
  lineStart?: number;
  lineEnd?: number;
  snippetHash?: string;
}

export interface AuditFindingRecord {
  id: string;
  runId: string;
  ruleId: EnterpriseRuleId | string;
  harnessRuleId?: string;
  resourceId: string;
  bindingId?: string;
  resourceType: LocalResourceType;
  agentId?: string;
  projectId?: string;
  kitId?: string;
  severity: AuditSeverity;
  auditStatus: AuditStatus;
  trustScoreImpact: number;
  permissionCategory: PermissionCategory;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  snippetHash?: string;
  pathSummary?: string;
  title: string;
  description: string;
  impactScope: Record<string, unknown>;
  remediation: string;
  relatedEventIds: string[];
  metadata: Record<string, unknown>;
  detectedAt: string;
  resolvedAt?: string;
  blocker: boolean;
}

export interface StaticAuditInput {
  resourceId: string;
  bindingId?: string;
  resourceType: LocalResourceType;
  name: string;
  content?: string;
  path?: string;
  agentId?: string;
  projectId?: string;
  kitId?: string;
  permissionSummary?: PermissionSummary;
  metadata?: Record<string, unknown>;
  knownResourceIds?: readonly string[];
  relatedEventIds?: readonly string[];
}

export interface StaticAuditResult {
  runId: string;
  resourceId: string;
  resourceType: LocalResourceType;
  findings: AuditFindingRecord[];
  trustScore: number;
  status: AuditStatus;
  summary: AuditSummary;
  auditedAt: string;
}

export const severityDeductions: Record<AuditSeverity, number> = {
  [AuditSeverities.CRITICAL]: 25,
  [AuditSeverities.HIGH]: 15,
  [AuditSeverities.MEDIUM]: 8,
  [AuditSeverities.LOW]: 3
};

const ALL_RESOURCE_TYPES = [
  LocalResourceTypes.AGENT_CONFIG,
  LocalResourceTypes.RULE,
  LocalResourceTypes.MEMORY,
  LocalResourceTypes.SUBAGENT,
  LocalResourceTypes.IGNORE_FILE,
  LocalResourceTypes.SKILL,
  LocalResourceTypes.MCP_SERVER,
  LocalResourceTypes.PLUGIN,
  LocalResourceTypes.HOOK,
  LocalResourceTypes.CLI_COMMAND,
  LocalResourceTypes.KIT,
  LocalResourceTypes.PROJECT,
  LocalResourceTypes.AGENT
];

const COMMAND_RESOURCE_TYPES = [
  LocalResourceTypes.HOOK,
  LocalResourceTypes.CLI_COMMAND,
  LocalResourceTypes.MCP_SERVER,
  LocalResourceTypes.PLUGIN,
  LocalResourceTypes.SKILL,
  LocalResourceTypes.KIT,
  LocalResourceTypes.SUBAGENT
];

const CLI_REFERENCE_RESOURCE_TYPES: readonly LocalResourceType[] = [
  LocalResourceTypes.CLI_COMMAND,
  LocalResourceTypes.HOOK,
  LocalResourceTypes.SKILL,
  LocalResourceTypes.SUBAGENT,
  LocalResourceTypes.KIT
];

const CLI_RELATED_RESOURCE_TYPES: readonly LocalResourceType[] = [
  LocalResourceTypes.CLI_COMMAND,
  LocalResourceTypes.HOOK,
  LocalResourceTypes.SKILL,
  LocalResourceTypes.KIT
];

const STATIC_COMMAND_RESOURCE_TYPES: readonly LocalResourceType[] = [
  LocalResourceTypes.HOOK,
  LocalResourceTypes.CLI_COMMAND,
  LocalResourceTypes.MCP_SERVER
];

export const auditRules: AuditRuleDefinition[] = [
  rule(EnterpriseAuditRuleIds.PROMPT_INJECTION, 'prompt-injection', 'Prompt injection', AuditSeverities.CRITICAL, PermissionCategories.CONFIG_WRITE, [LocalResourceTypes.SKILL, LocalResourceTypes.PLUGIN, LocalResourceTypes.RULE, LocalResourceTypes.MEMORY], 'Content attempts to override higher-priority instructions.', 'Review the instruction text and remove override or hidden-control language.', ['prompt-injection']),
  rule(EnterpriseAuditRuleIds.RCE, 'rce', 'Remote code execution', AuditSeverities.CRITICAL, PermissionCategories.SHELL, COMMAND_RESOURCE_TYPES, 'Configuration contains shell evaluation, download-and-run, or command-construction patterns.', 'Replace runtime command execution with declarative metadata or a reviewed static configuration.', ['shell-injection']),
  rule(EnterpriseAuditRuleIds.CREDENTIAL_THEFT, 'credential-theft', 'Sensitive file path access', AuditSeverities.CRITICAL, PermissionCategories.SECRET, ALL_RESOURCE_TYPES, 'Configuration references credential files, keychains, browser credentials, or cloud credential locations.', 'Remove direct credential-file access and use SecureStore references or scoped variables.', ['sensitive-file-path-access', 'sensitive-env-var-read']),
  rule(EnterpriseAuditRuleIds.PLAINTEXT_SECRETS, 'plaintext-secrets', 'Plaintext secret', AuditSeverities.CRITICAL, PermissionCategories.SECRET, ALL_RESOURCE_TYPES, 'Configuration appears to contain a hardcoded secret or connection string.', 'Move the value to SecureStore or an approved environment-variable reference.', ['hardcoded-secret', 'database-connection-string']),
  rule(EnterpriseAuditRuleIds.SAFETY_BYPASS, 'safety-bypass', 'Safety bypass', AuditSeverities.CRITICAL, PermissionCategories.PROCESS, [LocalResourceTypes.SKILL, LocalResourceTypes.HOOK, LocalResourceTypes.CLI_COMMAND, LocalResourceTypes.KIT], 'Configuration asks tools to bypass confirmation, safety, or verification controls.', 'Remove bypass flags or require explicit user review before enabling.', ['safety-bypass']),
  rule(EnterpriseAuditRuleIds.DANGEROUS_COMMANDS, 'dangerous-commands', 'Destructive command', AuditSeverities.HIGH, PermissionCategories.SHELL, COMMAND_RESOURCE_TYPES, 'Configuration contains destructive file or system commands.', 'Disable the command path and replace it with a non-destructive managed operation.', ['destructive-file-command', 'hook-auto-trigger-high-risk-command']),
  rule(EnterpriseAuditRuleIds.BROAD_PERMISSIONS, 'broad-permissions', 'Broad permission scope', AuditSeverities.HIGH, PermissionCategories.FILESYSTEM, ALL_RESOURCE_TYPES, 'Resource declares broad filesystem, network, environment, or database access.', 'Constrain permissions to the minimum project, directory, variable, domain, or database scope.', ['broad-project-directory-read-write', 'env-var-read']),
  rule(EnterpriseAuditRuleIds.SUPPLY_CHAIN, 'supply-chain', 'Supply-chain risk', AuditSeverities.MEDIUM, PermissionCategories.INTEGRITY, [LocalResourceTypes.SKILL, LocalResourceTypes.MCP_SERVER, LocalResourceTypes.PLUGIN, LocalResourceTypes.KIT], 'Resource source, dependency, archive, or lifecycle metadata is weakly pinned or externally fetched.', 'Use pinned versions, trusted registries, and verified package hashes.', ['plugin-package-hash-abnormal']),
  rule(EnterpriseAuditRuleIds.UNKNOWN_SOURCE, 'unknown-source', 'Unknown source', AuditSeverities.LOW, PermissionCategories.INTEGRITY, ALL_RESOURCE_TYPES, 'Resource has no trusted source, manifest, signature, server record, or Git origin.', 'Record the source or import it through an approved local/central-store flow.', ['unknown-source']),
  rule(EnterpriseAuditRuleIds.PERMISSION_COMBO_RISK, 'permission-combo-risk', 'Risky permission combination', AuditSeverities.HIGH, PermissionCategories.CUSTOM_PATH, ALL_RESOURCE_TYPES, 'Resource combines permissions that amplify impact, such as file plus network or secret plus network.', 'Split capabilities or require narrower authorization for the combined scope.', ['broad-project-directory-read-write', 'external-network-domain', 'database-connection-string', 'env-var-read']),
  rule(EnterpriseAuditRuleIds.CLI_CREDENTIAL_STORAGE, 'cli-credential-storage', 'CLI credential storage', AuditSeverities.HIGH, PermissionCategories.SECRET, [LocalResourceTypes.CLI_COMMAND, LocalResourceTypes.HOOK, LocalResourceTypes.SKILL, LocalResourceTypes.KIT], 'CLI metadata references local credential storage or plaintext token material.', 'Use SecureStore-backed references and avoid CLI-managed plaintext credential files.', ['sensitive-env-var-read']),
  rule(EnterpriseAuditRuleIds.CLI_NETWORK_ACCESS, 'cli-network-access', 'CLI network access', AuditSeverities.MEDIUM, PermissionCategories.NETWORK, [LocalResourceTypes.CLI_COMMAND, LocalResourceTypes.HOOK, LocalResourceTypes.SKILL, LocalResourceTypes.KIT], 'CLI metadata references external domains, APIs, proxies, webhooks, or insecure HTTP endpoints.', 'Restrict domains and avoid plaintext HTTP endpoints.', ['external-network-domain', 'plaintext-http-insecure-endpoint']),
  rule(EnterpriseAuditRuleIds.CLI_BINARY_SOURCE, 'cli-binary-source', 'CLI binary source', AuditSeverities.HIGH, PermissionCategories.INTEGRITY, [LocalResourceTypes.CLI_COMMAND, LocalResourceTypes.KIT], 'CLI binary source, signature, hash, or install path is not trusted.', 'Require a verified binary path, package hash, signature, and approved install location.', ['unauthorized-command-path']),
  rule(EnterpriseAuditRuleIds.CLI_PERMISSION_SCOPE, 'cli-permission-scope', 'CLI permission scope', AuditSeverities.MEDIUM, PermissionCategories.PROCESS, [LocalResourceTypes.CLI_COMMAND, LocalResourceTypes.HOOK, LocalResourceTypes.SKILL, LocalResourceTypes.SUBAGENT, LocalResourceTypes.KIT], 'CLI references are aggregated from Skills, Hooks, Subagents, or Kits and need scope review.', 'Confirm every reference target exists and narrow the CLI scope.', ['subagent-nonexistent-reference']),
  rule(EnterpriseAuditRuleIds.CLI_AGGREGATE_RISK, 'cli-aggregate-risk', 'CLI aggregate risk', AuditSeverities.HIGH, PermissionCategories.PROCESS, [LocalResourceTypes.CLI_COMMAND, LocalResourceTypes.KIT], 'CLI combines command, file, network, or secret capabilities.', 'Disable the CLI until capability grouping is reviewed.', ['external-network-domain', 'env-var-read']),
  rule(EnterpriseAuditRuleIds.MCP_COMMAND_INJECTION, 'mcp-command-injection', 'MCP command injection', AuditSeverities.CRITICAL, PermissionCategories.PROCESS, [LocalResourceTypes.MCP_SERVER, LocalResourceTypes.KIT], 'MCP command, args, cwd, or environment metadata contains shell injection delimiters.', 'Use a fixed command manifest and pass arguments as structured values without shell expansion.', ['shell-injection']),
  rule(EnterpriseAuditRuleIds.PLUGIN_SOURCE_TRUST, 'plugin-source-trust', 'Plugin source trust', AuditSeverities.HIGH, PermissionCategories.INTEGRITY, [LocalResourceTypes.PLUGIN, LocalResourceTypes.KIT], 'Plugin source, signature, or package hash cannot be trusted.', 'Require trusted source metadata and a matching verified hash before enabling.', ['plugin-package-hash-abnormal']),
  rule(EnterpriseAuditRuleIds.PLUGIN_LIFECYCLE_SCRIPTS, 'plugin-lifecycle-scripts', 'Plugin lifecycle script', AuditSeverities.HIGH, PermissionCategories.PROCESS, [LocalResourceTypes.PLUGIN, LocalResourceTypes.KIT], 'Plugin package defines lifecycle scripts. They are detected only and must not be run.', 'Disable lifecycle execution and review the script content out of band.', ['plugin-lifecycle-scripts'])
];

export const enterpriseBlockRules: AuditRuleDefinition[] = [
  blockRule(EnterpriseBlockRuleIds.PATH_TRAVERSAL, 'enterprise-path-traversal', 'Path traversal or unauthorized write', PermissionCategories.FILESYSTEM, 'Write target attempts path traversal or unauthorized absolute-path access.', 'Block the write and choose an authorized managed target path.', ['path-traversal-absolute-write']),
  blockRule(EnterpriseBlockRuleIds.HASH_MISMATCH, 'enterprise-hash-mismatch', 'Hash mismatch', PermissionCategories.INTEGRITY, 'Expected package or file hash does not match the observed value.', 'Block overwrite/install/update until the package or file hash is reconciled.', ['plugin-package-hash-abnormal']),
  blockRule(EnterpriseBlockRuleIds.MCP_REQUIRED_VARIABLE_MISSING, 'enterprise-mcp-required-variable-missing', 'Required MCP variable missing', PermissionCategories.ENVIRONMENT, 'MCP configuration is missing a required variable.', 'Collect the missing variable through the approved configuration flow before enabling.', ['mcp-required-variable-missing']),
  blockRule(EnterpriseBlockRuleIds.MCP_SENSITIVE_VARIABLE_PLAINTEXT, 'enterprise-mcp-sensitive-variable-plaintext', 'Sensitive MCP variable stored in plaintext', PermissionCategories.SECRET, 'MCP configuration stores a sensitive variable as plaintext instead of a SecureStore reference.', 'Move the sensitive value to SecureStore and keep only the reference in local config.', ['mcp-sensitive-variable-plaintext']),
  blockRule(EnterpriseBlockRuleIds.CONFIG_DRIFT, 'enterprise-config-drift', 'Configuration drift', PermissionCategories.INTEGRITY, 'Managed configuration was externally modified or its hash changed.', 'Review the diff and refresh the managed baseline before overwriting.', ['config-drift-external-modification']),
  blockRule(EnterpriseBlockRuleIds.AUTHORIZATION_SHRINK, 'enterprise-authorization-shrink', 'Authorization shrink or security delist', PermissionCategories.INTEGRITY, 'Authorization was revoked, narrowed, or the resource was security-delisted.', 'Block main operations and allow only local cleanup or disable/remove actions.', ['authorization-shrink-security-delist']),
  blockRule(EnterpriseBlockRuleIds.MISSING_ROLLBACK_SNAPSHOT, 'enterprise-missing-rollback-snapshot', 'Missing rollback snapshot', PermissionCategories.CONFIG_WRITE, 'A write operation requires rollback but no usable backup snapshot is available.', 'Create a backup snapshot before writing or limit the operation to read-only preview.', ['missing-rollback-snapshot'])
];

export const allAuditRuleDefinitions = [...auditRules, ...enterpriseBlockRules] as const;

export const phase4AcceptanceCoverage: Record<string, EnterpriseRuleId[]> = {
  'sensitive-file-path-access': [EnterpriseAuditRuleIds.CREDENTIAL_THEFT],
  'broad-project-directory-read-write': [EnterpriseAuditRuleIds.BROAD_PERMISSIONS, EnterpriseAuditRuleIds.PERMISSION_COMBO_RISK],
  'path-traversal-absolute-write': [EnterpriseBlockRuleIds.PATH_TRAVERSAL],
  'destructive-file-command': [EnterpriseAuditRuleIds.DANGEROUS_COMMANDS],
  'shell-injection': [EnterpriseAuditRuleIds.RCE, EnterpriseAuditRuleIds.MCP_COMMAND_INJECTION],
  'unauthorized-command-path': [EnterpriseAuditRuleIds.CLI_BINARY_SOURCE],
  'external-network-domain': [EnterpriseAuditRuleIds.CLI_NETWORK_ACCESS, EnterpriseAuditRuleIds.PERMISSION_COMBO_RISK],
  'plaintext-http-insecure-endpoint': [EnterpriseAuditRuleIds.CLI_NETWORK_ACCESS],
  'env-var-read': [EnterpriseAuditRuleIds.BROAD_PERMISSIONS, EnterpriseAuditRuleIds.PERMISSION_COMBO_RISK],
  'sensitive-env-var-read': [EnterpriseAuditRuleIds.CREDENTIAL_THEFT, EnterpriseAuditRuleIds.PLAINTEXT_SECRETS],
  'hardcoded-secret': [EnterpriseAuditRuleIds.PLAINTEXT_SECRETS],
  'database-connection-string': [EnterpriseAuditRuleIds.PLAINTEXT_SECRETS, EnterpriseAuditRuleIds.PERMISSION_COMBO_RISK],
  'mcp-required-variable-missing': [EnterpriseBlockRuleIds.MCP_REQUIRED_VARIABLE_MISSING],
  'mcp-sensitive-variable-plaintext': [EnterpriseBlockRuleIds.MCP_SENSITIVE_VARIABLE_PLAINTEXT],
  'plugin-package-hash-abnormal': [EnterpriseBlockRuleIds.HASH_MISMATCH, EnterpriseAuditRuleIds.PLUGIN_SOURCE_TRUST],
  'subagent-nonexistent-reference': [EnterpriseAuditRuleIds.CLI_PERMISSION_SCOPE],
  'hook-auto-trigger-high-risk-command': [EnterpriseAuditRuleIds.DANGEROUS_COMMANDS, EnterpriseAuditRuleIds.RCE],
  'config-drift-external-modification': [EnterpriseBlockRuleIds.CONFIG_DRIFT]
};

const ruleById = new Map<EnterpriseRuleId, AuditRuleDefinition>(allAuditRuleDefinitions.map((definition) => [definition.id, definition]));

const promptInjectionPatterns = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now\s+a/i,
  /new\s+system\s+prompt/i,
  /override\s+(system|safety)\s+(prompt|instructions)/i,
  /\[SYSTEM\]/i,
  /[\u200B-\u200D\uFEFF\u2060]/
];

const rcePatterns = [
  /curl\s+[^|]*\|\s*(sh|bash|zsh|powershell)/i,
  /wget\s+[^|]*\|\s*(sh|bash|zsh|powershell)/i,
  /(?:^|[^\w.])eval\s*\(/i,
  /base64\s+(-d|--decode)\s*\|/i,
  /`[^`]*`/,
  /\$\([^)]*\)/
];

const sensitivePathPatterns = [
  /(^|[~/'"`\s])\.ssh(\/|\\|$)/i,
  /\.aws(\/|\\)credentials/i,
  /\.gcloud(\/|\\)(credentials|application_default_credentials)/i,
  /credentials\.json/i,
  /\.netrc\b/i,
  /\.pgpass\b/i,
  /keychain/i,
  /(chrome|edge|firefox).*(login|cookie|credential)/i
];

const secretPatterns = [
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  /\b(postgres|postgresql|mysql|mongodb|redis):\/\/[^@\s]+:[^@\s]+@/i,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s,;}]{8,}/i
];

const safetyBypassPatterns = [
  /(^|\s)--no-verify\b/i,
  /(^|\s)--yes\b/i,
  /(^|\s)--force\b/i,
  /\bbypass\b.*(safety|security|confirm|approval)/i,
  /\b(disable|skip)\b.*(confirm|prompt|verification)/i,
  /allowedTools\s*[:=]\s*["']\*["']/i
];

const destructiveCommandPatterns = [
  /\brm\s+-rf\s+(\/|~|\*)/i,
  /\bdel\s+\/[sq]\b/i,
  /\bRemove-Item\b.*\b-Recurse\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=.+\bof=\/dev\//i,
  /\bformat\s+[A-Z]:/i,
  /\bchmod\s+777\b/i,
  /download-and-run/i
];

const broadPathPatterns = [
  /(^|\s)(\/|\*|~\/|\$HOME\/)(\s|$)/,
  /\b(project|workspace|repo).*(read|write).*(all|\*)/i,
  /\b(all|any)\s+(files|directories|projects|workspaces)\b/i
];

const networkPatterns = [
  /\bhttps?:\/\/[A-Za-z0-9.-]+/i,
  /\b(api|webhook|proxy|endpoint|domain)\s*[:=]\s*["']?[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i
];

const insecureHttpPatterns = [
  /\bhttp:\/\/[A-Za-z0-9.-]+/i,
  /\binsecure\s+(endpoint|http|tls)/i
];

const envPatterns = [
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\b(getenv|os\.environ|Deno\.env\.get)\s*\(/,
  /\$[A-Z][A-Z0-9_]{2,}\b/,
  /\.env\b/i
];

const sensitiveEnvPatterns = [
  /\b[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*\b/
];

const supplyChainPatterns = [
  /\b(npm|pip|cargo|brew|curl|wget)\s+install\b.*(@latest|latest|http:\/\/|https:\/\/)/i,
  /\b(postinstall|preinstall|prepare)\b/i,
  /\.(tgz|zip|tar\.gz)\b/i,
  /\bunpinned\b/i
];

const mcpInjectionPatterns = [
  /(;|&&|\|\||\||`|\$\()/,
  /\b(sh|bash|zsh|powershell|cmd\.exe)\s+-c\b/i
];

const lifecycleScriptPatterns = [
  /"?(preinstall|install|postinstall|preuninstall|postuninstall|prepare)"?\s*:/i,
  /\b(lifecycle|postinstall|preinstall)\s+script\b/i
];

export function calculateTrustScore(findings: readonly Pick<AuditFindingRecord, 'ruleId' | 'severity' | 'blocker'>[]): number {
  if (findings.some((finding) => finding.blocker)) return 0;
  const seenRules = new Set<string>();
  let score = 100;
  for (const finding of findings) {
    const ruleKey = finding.ruleId;
    const deduction = seenRules.has(ruleKey)
      ? 1
      : severityDeductions[finding.severity] ?? severityDeductions[AuditSeverities.LOW];
    seenRules.add(ruleKey);
    score -= deduction;
  }
  return Math.max(0, Math.min(100, score));
}

export function mapTrustScoreToAuditStatus(score: number | undefined, options: { audited?: boolean; hasBlocker?: boolean } = {}): AuditStatus {
  if (options.audited === false || score === undefined) return AuditStatuses.NOT_AUDITED;
  if (options.hasBlocker || score <= 0) return AuditStatuses.SECURITY_RISK;
  if (score >= 80) return AuditStatuses.SAFE;
  if (score >= 60) return AuditStatuses.LOW_RISK;
  if (score >= 40) return AuditStatuses.NEEDS_REVIEW;
  return AuditStatuses.HIGH_RISK;
}

export function summarizeAuditFindings(findings: readonly AuditFindingRecord[], auditedAt = new Date().toISOString()): AuditSummary {
  const trustScore = calculateTrustScore(findings);
  return {
    status: mapTrustScoreToAuditStatus(trustScore, { audited: true, hasBlocker: findings.some((finding) => finding.blocker) }),
    trustScore,
    findingCount: findings.length,
    criticalCount: findings.filter((finding) => finding.severity === AuditSeverities.CRITICAL).length,
    highCount: findings.filter((finding) => finding.severity === AuditSeverities.HIGH).length,
    lastAuditedAt: auditedAt,
    message: findings.length === 0 ? 'Static audit completed with no findings.' : `Static audit found ${findings.length} issue(s).`
  };
}

export function auditStaticResource(input: StaticAuditInput, options: { runId?: string; detectedAt?: string } = {}): StaticAuditResult {
  const detectedAt = options.detectedAt ?? new Date().toISOString();
  const runId = options.runId ?? `audit_${stableHash(`${input.resourceId}:${detectedAt}`)}`;
  const rawFindings = [
    ...detectContentRules(input, runId, detectedAt),
    ...detectMetadataRules(input, runId, detectedAt),
    ...detectBlockers(input, runId, detectedAt)
  ];
  const deduped = dedupeFindings(rawFindings);
  const trustScore = calculateTrustScore(deduped);
  const status = mapTrustScoreToAuditStatus(trustScore, { audited: true, hasBlocker: deduped.some((finding) => finding.blocker) });
  const findings = deduped.map((finding) => ({ ...finding, auditStatus: status }));
  return {
    runId,
    resourceId: input.resourceId,
    resourceType: input.resourceType,
    findings,
    trustScore,
    status,
    summary: summarizeAuditFindings(findings, detectedAt),
    auditedAt: detectedAt
  };
}

export function auditStaticResources(inputs: readonly StaticAuditInput[], options: { runId?: string; detectedAt?: string } = {}): StaticAuditResult[] {
  const detectedAt = options.detectedAt ?? new Date().toISOString();
  return inputs.map((input, index) => auditStaticResource(input, {
    runId: options.runId ? `${options.runId}_${index + 1}` : undefined,
    detectedAt
  }));
}

export function hashAuditSnippet(value: string): string {
  return `fnv1a:${stableHash(value)}`;
}

export function auditRuleDefinition(ruleId: EnterpriseRuleId | string): AuditRuleDefinition | undefined {
  return ruleById.get(ruleId as EnterpriseRuleId);
}

function detectContentRules(input: StaticAuditInput, runId: string, detectedAt: string): AuditFindingRecord[] {
  const text = deobfuscate(input.content ?? '');
  const findings: AuditFindingRecord[] = [];
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.PROMPT_INJECTION, promptInjectionPatterns, text, { skipDescriptive: true }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.RCE, rcePatterns, text, { resourceTypes: COMMAND_RESOURCE_TYPES, skipDescriptive: true }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.CREDENTIAL_THEFT, sensitivePathPatterns, text, { skipDescriptive: false }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.PLAINTEXT_SECRETS, secretPatterns, text, { skipDescriptive: true }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.SAFETY_BYPASS, safetyBypassPatterns, text, { skipDescriptive: true }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.DANGEROUS_COMMANDS, destructiveCommandPatterns, text, { resourceTypes: COMMAND_RESOURCE_TYPES, skipDescriptive: true }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.BROAD_PERMISSIONS, broadPathPatterns, `${input.path ?? ''}\n${text}`, { skipDescriptive: false }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.SUPPLY_CHAIN, supplyChainPatterns, text, { skipDescriptive: true }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.CLI_NETWORK_ACCESS, networkPatterns, text, { resourceTypes: [LocalResourceTypes.CLI_COMMAND, LocalResourceTypes.HOOK, LocalResourceTypes.SKILL, LocalResourceTypes.KIT], skipDescriptive: false }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.CLI_NETWORK_ACCESS, insecureHttpPatterns, text, { resourceTypes: [LocalResourceTypes.CLI_COMMAND, LocalResourceTypes.HOOK, LocalResourceTypes.SKILL, LocalResourceTypes.KIT, LocalResourceTypes.MCP_SERVER], skipDescriptive: false }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.BROAD_PERMISSIONS, envPatterns, text, { skipDescriptive: false }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.CREDENTIAL_THEFT, sensitiveEnvPatterns, text, { skipDescriptive: false }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.MCP_COMMAND_INJECTION, mcpInjectionPatterns, text, { resourceTypes: [LocalResourceTypes.MCP_SERVER, LocalResourceTypes.KIT], skipDescriptive: true }));
  findings.push(...findInContent(input, runId, detectedAt, EnterpriseAuditRuleIds.PLUGIN_LIFECYCLE_SCRIPTS, lifecycleScriptPatterns, text, { resourceTypes: [LocalResourceTypes.PLUGIN, LocalResourceTypes.KIT], skipDescriptive: false }));
  return findings;
}

function detectMetadataRules(input: StaticAuditInput, runId: string, detectedAt: string): AuditFindingRecord[] {
  const metadata = input.metadata ?? {};
  const text = stringifyMetadata(metadata);
  const findings: AuditFindingRecord[] = [];
  if (input.permissionSummary) {
    const categories = new Set(input.permissionSummary.categories);
    if (categories.has(PermissionCategories.NETWORK) && (categories.has(PermissionCategories.SECRET) || categories.has(PermissionCategories.SHELL) || categories.has(PermissionCategories.DATABASE) || categories.has(PermissionCategories.FILESYSTEM))) {
      findings.push(makeFinding(EnterpriseAuditRuleIds.PERMISSION_COMBO_RISK, input, runId, detectedAt, { evidence: 'permission-combination', metadata: permissionMetadata(input.permissionSummary) }));
    }
    if (input.permissionSummary.details.some((detail) => isBroadTarget(detail.target))) {
      findings.push(makeFinding(EnterpriseAuditRuleIds.BROAD_PERMISSIONS, input, runId, detectedAt, { evidence: 'broad-permission-target', metadata: permissionMetadata(input.permissionSummary) }));
    }
  }
  if (isUnknownSource(metadata, input)) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.UNKNOWN_SOURCE, input, runId, detectedAt, { evidence: 'unknown-source', metadata }));
  }
  if (hasCliCredentialStorage(input, text)) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.CLI_CREDENTIAL_STORAGE, input, runId, detectedAt, { evidence: 'cli-credential-storage', metadata }));
  }
  if (hasCliBinarySourceRisk(input, text)) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.CLI_BINARY_SOURCE, input, runId, detectedAt, { evidence: 'cli-binary-source', metadata }));
  }
  if (hasCliReferenceScopeRisk(input, metadata)) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.CLI_PERMISSION_SCOPE, input, runId, detectedAt, { evidence: 'cli-reference-scope', metadata }));
  }
  if (hasStaticCommandDeclaration(input)) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.CLI_PERMISSION_SCOPE, input, runId, detectedAt, { evidence: 'static-command-declaration', metadata: permissionMetadata(input.permissionSummary) }));
  }
  if (hasCliAggregateRisk(input)) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.CLI_AGGREGATE_RISK, input, runId, detectedAt, { evidence: 'cli-aggregate-risk', metadata: permissionMetadata(input.permissionSummary) }));
  }
  if (input.resourceType === LocalResourceTypes.PLUGIN && (hasHashRisk(metadata) || hasUntrustedSource(metadata))) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.PLUGIN_SOURCE_TRUST, input, runId, detectedAt, { evidence: 'plugin-source-trust', metadata }));
  }
  if (input.resourceType === LocalResourceTypes.PLUGIN && hasLifecycleScripts(metadata)) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.PLUGIN_LIFECYCLE_SCRIPTS, input, runId, detectedAt, { evidence: 'plugin-lifecycle-scripts', metadata }));
  }
  if (input.resourceType === LocalResourceTypes.MCP_SERVER && mcpCommandText(metadata).some((part) => mcpInjectionPatterns.some((pattern) => pattern.test(part)))) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.MCP_COMMAND_INJECTION, input, runId, detectedAt, { evidence: 'mcp-command-injection', metadata }));
  }
  if (input.resourceType === LocalResourceTypes.MCP_SERVER && hasMcpBroadFilesystem(metadata)) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.BROAD_PERMISSIONS, input, runId, detectedAt, { evidence: 'mcp-broad-filesystem', metadata }));
  }
  if (supplyChainPatterns.some((pattern) => pattern.test(text))) {
    findings.push(makeFinding(EnterpriseAuditRuleIds.SUPPLY_CHAIN, input, runId, detectedAt, { evidence: 'supply-chain-metadata', metadata }));
  }
  return findings;
}

function detectBlockers(input: StaticAuditInput, runId: string, detectedAt: string): AuditFindingRecord[] {
  const metadata = input.metadata ?? {};
  const findings: AuditFindingRecord[] = [];
  if (hasPathTraversalOrAbsoluteWrite(input, metadata)) {
    findings.push(makeFinding(EnterpriseBlockRuleIds.PATH_TRAVERSAL, input, runId, detectedAt, { evidence: 'path-traversal-or-absolute-write', metadata }));
  }
  if (hasHashRisk(metadata)) {
    findings.push(makeFinding(EnterpriseBlockRuleIds.HASH_MISMATCH, input, runId, detectedAt, { evidence: 'hash-mismatch', metadata }));
  }
  const missingMcpVars = missingRequiredMcpVariables(metadata);
  if (missingMcpVars.length > 0) {
    findings.push(makeFinding(EnterpriseBlockRuleIds.MCP_REQUIRED_VARIABLE_MISSING, input, runId, detectedAt, { evidence: 'mcp-required-variable-missing', metadata: { missingVariables: missingMcpVars } }));
  }
  const plaintextMcpVars = plaintextSensitiveMcpVariables(metadata);
  if (plaintextMcpVars.length > 0) {
    findings.push(makeFinding(EnterpriseBlockRuleIds.MCP_SENSITIVE_VARIABLE_PLAINTEXT, input, runId, detectedAt, { evidence: 'mcp-sensitive-variable-plaintext', metadata: { variableNames: plaintextMcpVars } }));
  }
  if (hasConfigDrift(metadata)) {
    findings.push(makeFinding(EnterpriseBlockRuleIds.CONFIG_DRIFT, input, runId, detectedAt, { evidence: 'config-drift', metadata }));
  }
  if (hasAuthorizationShrink(metadata)) {
    findings.push(makeFinding(EnterpriseBlockRuleIds.AUTHORIZATION_SHRINK, input, runId, detectedAt, { evidence: 'authorization-shrink', metadata }));
  }
  if (requiresRollbackSnapshot(metadata) && !hasRollbackSnapshot(metadata)) {
    findings.push(makeFinding(EnterpriseBlockRuleIds.MISSING_ROLLBACK_SNAPSHOT, input, runId, detectedAt, { evidence: 'missing-rollback-snapshot', metadata }));
  }
  return findings;
}

function findInContent(
  input: StaticAuditInput,
  runId: string,
  detectedAt: string,
  ruleId: EnterpriseRuleId,
  patterns: readonly RegExp[],
  text: string,
  options: { resourceTypes?: readonly LocalResourceType[]; skipDescriptive?: boolean } = {}
): AuditFindingRecord[] {
  if (!text || (options.resourceTypes && !options.resourceTypes.includes(input.resourceType))) return [];
  const mask = descriptiveLineMask(text);
  const findings: AuditFindingRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (options.skipDescriptive && mask[index]) continue;
    const line = lines[index] ?? '';
    if (patterns.some((pattern) => pattern.test(line))) {
      findings.push(makeFinding(ruleId, input, runId, detectedAt, {
        lineStart: index + 1,
        lineEnd: index + 1,
        snippet: line,
        evidence: 'content-pattern'
      }));
    }
  }
  return findings;
}

function makeFinding(
  ruleId: EnterpriseRuleId,
  input: StaticAuditInput,
  runId: string,
  detectedAt: string,
  evidence: { lineStart?: number; lineEnd?: number; snippet?: string; evidence: string; metadata?: unknown }
): AuditFindingRecord {
  const definition = ruleById.get(ruleId);
  if (!definition) throw new Error(`Unknown audit rule ${ruleId}`);
  const trustScoreImpact = definition.blocker ? 100 : definition.deduction;
  const lineKey = evidence.lineStart ? `:${evidence.lineStart}` : '';
  const evidenceKey = stableHash(`${runId}:${input.resourceId}:${ruleId}:${input.path ?? ''}${lineKey}:${evidence.evidence}`);
  return {
    id: `finding_${evidenceKey}`,
    runId,
    ruleId,
    harnessRuleId: definition.harnessRuleId,
    resourceId: input.resourceId,
    bindingId: input.bindingId,
    resourceType: input.resourceType,
    agentId: input.agentId,
    projectId: input.projectId,
    kitId: input.kitId,
    severity: definition.severity,
    auditStatus: definition.blocker ? AuditStatuses.SECURITY_RISK : mapTrustScoreToAuditStatus(100 - trustScoreImpact, { audited: true }),
    trustScoreImpact,
    permissionCategory: definition.permissionCategory,
    path: input.path,
    lineStart: evidence.lineStart,
    lineEnd: evidence.lineEnd,
    snippetHash: evidence.snippet ? hashAuditSnippet(evidence.snippet) : undefined,
    pathSummary: summarizePath(input.path),
    title: definition.title,
    description: definition.description,
    impactScope: {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      bindingId: input.bindingId,
      agentId: input.agentId,
      projectId: input.projectId,
      kitId: input.kitId
    },
    remediation: definition.remediation,
    relatedEventIds: [...(input.relatedEventIds ?? [])],
    metadata: redactValue({
      evidence: evidence.evidence,
      resourceName: input.name,
      metadata: evidence.metadata
    }) as Record<string, unknown>,
    detectedAt,
    blocker: definition.blocker
  };
}

function rule(
  id: EnterpriseAuditRuleId,
  harnessRuleId: string,
  title: string,
  severity: AuditSeverity,
  permissionCategory: PermissionCategory,
  applicableResourceTypes: LocalResourceType[],
  description: string,
  remediation: string,
  acceptanceCategories: string[]
): AuditRuleDefinition {
  return {
    id,
    harnessRuleId,
    title,
    severity,
    deduction: severityDeductions[severity],
    applicableResourceTypes,
    permissionCategory,
    description,
    remediation,
    blocker: false,
    acceptanceCategories
  };
}

function blockRule(
  id: EnterpriseBlockRuleId,
  harnessRuleId: string,
  title: string,
  permissionCategory: PermissionCategory,
  description: string,
  remediation: string,
  acceptanceCategories: string[]
): AuditRuleDefinition {
  return {
    id,
    harnessRuleId,
    title,
    severity: AuditSeverities.CRITICAL,
    deduction: 100,
    applicableResourceTypes: ALL_RESOURCE_TYPES,
    permissionCategory,
    description,
    remediation,
    blocker: true,
    acceptanceCategories
  };
}

function dedupeFindings(findings: AuditFindingRecord[]): AuditFindingRecord[] {
  const seen = new Set<string>();
  const output: AuditFindingRecord[] = [];
  for (const finding of findings) {
    const key = [
      finding.ruleId,
      finding.resourceId,
      finding.bindingId ?? '',
      finding.path ?? '',
      finding.lineStart ?? '',
      finding.snippetHash ?? ''
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(finding);
  }
  return output;
}

function descriptiveLineMask(content: string): boolean[] {
  const mask: boolean[] = [];
  let inCodeFence = false;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      mask.push(true);
    } else {
      mask.push(inCodeFence || trimmed.startsWith('>'));
    }
  }
  return mask;
}

function deobfuscate(input: string): string {
  return [...input].filter((char) => !/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD\u180E\uFE00-\uFE0F]/u.test(char)).join('');
}

function stringifyMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata);
}

function permissionMetadata(summary: PermissionSummary | undefined): Record<string, unknown> {
  if (!summary) return {};
  return {
    categories: summary.categories,
    items: summary.items,
    detailTargets: summary.details.map((detail) => detail.target).filter(Boolean)
  };
}

function isUnknownSource(metadata: Record<string, unknown>, input: StaticAuditInput): boolean {
  if (input.resourceType === LocalResourceTypes.AGENT_CONFIG || input.resourceType === LocalResourceTypes.PROJECT) return false;
  const source = readString(metadata, 'source') ?? readString(metadata, 'sourceUrl') ?? readString(metadata, 'gitOrigin') ?? readString(metadata, 'serverRecordId') ?? readString(metadata, 'manifestPath');
  if (source) return false;
  if (metadata.trustedSource === true || metadata.centralStoreManaged === true || metadata.nativeDirectoryManaged === true) return false;
  return metadata.unknownSource === true || metadata.sourceMissing === true;
}

function hasCliCredentialStorage(input: StaticAuditInput, text: string): boolean {
  if (!isCliRelated(input.resourceType)) return false;
  return /(credential|token|secret|password).*(store|file|path|plaintext)|(\.netrc|\.aws\/credentials|\.config\/.*token)/i.test(text);
}

function hasCliBinarySourceRisk(input: StaticAuditInput, text: string): boolean {
  if (input.resourceType !== LocalResourceTypes.CLI_COMMAND && input.resourceType !== LocalResourceTypes.KIT) return false;
  return /("?(binaryPath|commandPath|installPath)"?\s*:\s*"?(\/tmp|\/var\/tmp|.*Downloads|.*Desktop)|userWritableInstallPath|missingSignature|unsigned|hashMissing|unauthorizedCommandPath)/i.test(text);
}

function hasCliReferenceScopeRisk(input: StaticAuditInput, metadata: Record<string, unknown>): boolean {
  if (!CLI_REFERENCE_RESOURCE_TYPES.includes(input.resourceType)) return false;
  const refs = readStringArray(metadata, 'referencedResourceIds');
  const known = new Set(input.knownResourceIds ?? []);
  if (refs.some((ref) => known.size > 0 && !known.has(ref))) return true;
  return readStringArray(metadata, 'cliReferences').length > 0 || metadata.missingReference === true;
}

function hasStaticCommandDeclaration(input: StaticAuditInput): boolean {
  if (!STATIC_COMMAND_RESOURCE_TYPES.includes(input.resourceType)) return false;
  return input.permissionSummary?.items.includes(PermissionItems.SHELL_COMMAND) ?? false;
}

function hasCliAggregateRisk(input: StaticAuditInput): boolean {
  if (input.resourceType !== LocalResourceTypes.CLI_COMMAND && input.resourceType !== LocalResourceTypes.KIT) return false;
  const categories = new Set(input.permissionSummary?.categories ?? []);
  const elevated = [PermissionCategories.SHELL, PermissionCategories.SECRET, PermissionCategories.FILESYSTEM, PermissionCategories.DATABASE].some((category) => categories.has(category));
  return categories.has(PermissionCategories.NETWORK) && elevated;
}

function hasHashRisk(metadata: Record<string, unknown>): boolean {
  return metadata.hashMismatch === true
    || metadata.packageHashMismatch === true
    || metadata.hashStatus === 'mismatch'
    || metadata.packageHashStatus === 'mismatch'
    || metadata.signatureStatus === 'invalid';
}

function hasUntrustedSource(metadata: Record<string, unknown>): boolean {
  return metadata.untrustedSource === true || metadata.signatureStatus === 'missing' || metadata.sourceTrust === 'unknown';
}

function hasLifecycleScripts(metadata: Record<string, unknown>): boolean {
  const scripts = recordValue(metadata, 'scripts');
  if (scripts && Object.keys(scripts).some((key) => lifecycleScriptPatterns.some((pattern) => pattern.test(key)))) return true;
  return readStringArray(metadata, 'lifecycleScripts').length > 0;
}

function mcpCommandText(metadata: Record<string, unknown>): string[] {
  const parts = [
    readString(metadata, 'command'),
    readString(metadata, 'cwd'),
    ...readStringArray(metadata, 'args')
  ].filter((value): value is string => Boolean(value));
  return parts;
}

function hasMcpBroadFilesystem(metadata: Record<string, unknown>): boolean {
  const command = readString(metadata, 'command') ?? '';
  const args = readStringArray(metadata, 'args').join(' ');
  return /filesystem/i.test(command) && broadPathPatterns.some((pattern) => pattern.test(args));
}

function hasPathTraversalOrAbsoluteWrite(input: StaticAuditInput, metadata: Record<string, unknown>): boolean {
  const paths = [
    input.path,
    readString(metadata, 'targetPath'),
    readString(metadata, 'writePath'),
    readString(metadata, 'outputPath')
  ].filter((value): value is string => Boolean(value));
  const writeIntent = metadata.writeIntent === true || metadata.operationKind === 'write' || metadata.operation === 'write';
  return paths.some((value) => /\.\.(\/|\\)/.test(value) || (writeIntent && isUnauthorizedAbsolutePath(value, metadata)));
}

function missingRequiredMcpVariables(metadata: Record<string, unknown>): string[] {
  const required = readStringArray(metadata, 'requiredEnv');
  const env = recordValue(metadata, 'env') ?? {};
  return required.filter((key) => !(key in env));
}

function plaintextSensitiveMcpVariables(metadata: Record<string, unknown>): string[] {
  const env = recordValue(metadata, 'env') ?? {};
  return Object.entries(env)
    .filter(([key, value]) => isSensitiveName(key) && typeof value === 'string' && !isSecureReference(value))
    .map(([key]) => key);
}

function hasConfigDrift(metadata: Record<string, unknown>): boolean {
  return metadata.drifted === true
    || metadata.externalModified === true
    || metadata.driftStatus === 'DRIFTED'
    || metadata.driftStatus === 'EXTERNALLY_MODIFIED'
    || metadata.driftStatus === 'HASH_CHANGED'
    || metadata.configDrift === true;
}

function hasAuthorizationShrink(metadata: Record<string, unknown>): boolean {
  return metadata.authStatus === 'AUTH_REVOKED'
    || metadata.authStatus === 'SECURITY_DELISTED'
    || metadata.securityDelisted === true
    || metadata.authorizationShrunk === true;
}

function requiresRollbackSnapshot(metadata: Record<string, unknown>): boolean {
  return metadata.requiresRollback === true || metadata.requiresBackup === true || metadata.writeRequiresBackup === true;
}

function hasRollbackSnapshot(metadata: Record<string, unknown>): boolean {
  return Boolean(readString(metadata, 'backupSnapshotId') || readString(metadata, 'rollbackSnapshotId') || metadata.rollbackSnapshotAvailable === true);
}

function isCliRelated(resourceType: LocalResourceType): boolean {
  return CLI_RELATED_RESOURCE_TYPES.includes(resourceType);
}

function isBroadTarget(value: string | undefined): boolean {
  if (!value) return false;
  return broadPathPatterns.some((pattern) => pattern.test(value));
}

function isUnauthorizedAbsolutePath(value: string, metadata: Record<string, unknown>): boolean {
  if (!/^([A-Za-z]:[\\/]|\/)/.test(value)) return false;
  const allowedRoots = readStringArray(metadata, 'authorizedRoots');
  if (allowedRoots.length === 0) return true;
  return !allowedRoots.some((root) => value === root || value.startsWith(`${root.replace(/[\\/]$/, '')}/`));
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function recordValue(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isSensitiveName(value: string): boolean {
  return /(token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i.test(value);
}

function isSecureReference(value: string): boolean {
  return /^(secure-store:|securestore:|SecureStore:|\$\{[A-Z0-9_]+\}|\*{4,}|redacted:|hash:)/.test(value);
}

function summarizePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts[0]}/.../${parts[parts.length - 1]}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
