import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LocalDatabase } from '../db/local-database';
import { LocalEventQueue, type LocalEventStatus as LocalEventQueueStatus } from '../events/local-event-queue';
import type { ExecutionPlan } from '../executor/types';
import {
  auditStaticResource,
  summarizeAuditFindings,
  type AuditFindingRecord,
  type AuditSeverity
} from '../../shared/local-audit';
import { redactForLog, redactString } from '../../shared/redaction';
import { DesktopErrorException, makeDesktopError } from '../../shared/errors';
import {
  aggregateResourceStatus,
  AuthStatuses,
  AuditStatuses,
  contentTypeFromPath,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  DetectionStatuses,
  DriftStatuses,
  extractKitManifest,
  LifecycleStatuses,
  LocalEventTypes,
  LocalResourceSourceTypes,
  LocalResourceTypes,
  ManagedModes,
  OperationStatuses,
  PathStatuses,
  resourceScopeLabel,
  ResourceScopeTypes,
  SyncStatuses,
  WriteModes,
  type AuditStatus,
  type AuditSummary,
  type AuthStatus,
  type DetectionStatus,
  type DriftStatus,
  type FileBackedResource,
  type KitManifest,
  type KitResourceRef,
  type LifecycleStatus,
  type LocalEventRecord,
  type LocalEventStatus,
  type LocalEventType,
  type LocalResource,
  type LocalResourceRow,
  type LocalResourceSnapshot,
  type LocalResourceSourceType,
  type LocalResourceType,
  type ManagedMode,
  type OperationStatus,
  type PathStatus,
  type PermissionCategory,
  type PermissionSummary,
  type ResourceBinding,
  type ResourceScopeType,
  type SyncStatus,
  type WriteMode
} from '../../shared/local-resources';

export interface LocalLifecycleStateHint {
  extensionId: string;
  state: string;
  message?: string;
}

export interface LocalLifecycleHintApplySummary {
  applied: number;
  ignored: number;
}

export interface LocalLifecycleSnapshot {
  extensions: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
  targets: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  mcpInstallations: Array<Record<string, unknown>>;
  pluginInstallations: Array<Record<string, unknown>>;
  resources: LocalResourceSnapshot;
}

export interface LocalMcpInstallationRecord {
  id: string;
  extensionId: string;
  target: string;
  status: string;
  configPath?: string;
  secureRef?: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScannedLocalExtensionRecord {
  extensionId: string;
  name?: string;
  summary?: string;
  version?: string;
  target?: string;
  kind?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface LocalScanFailureRecord {
  path?: string;
  code: string;
  message: string;
  resourceType?: LocalResourceType;
  sourceType?: LocalResourceSourceType;
  target?: string;
  agentId?: string;
  projectId?: string;
  operationStatus?: OperationStatus;
  metadata?: Record<string, unknown>;
}

export interface AgentResourceRecord {
  resourceType: LocalResourceType;
  sourceId: string;
  name: string;
  agentId: string;
  description?: string;
  version?: string;
  targetPath?: string;
  status: string;
  sourceType?: LocalResourceSourceType;
  managed?: boolean;
  nativeDirectoryManaged?: boolean;
  eaManagedFallback?: boolean;
  projectId?: string;
  scopeType?: ResourceScopeType;
  permissionSummary?: PermissionSummary;
  auditSummary?: AuditSummary;
  metadata?: Record<string, unknown>;
}

export interface AgentEventRecord {
  eventType: LocalEventType;
  resourceType?: LocalResourceType;
  sourceId?: string;
  agentId: string;
  projectId?: string;
  targetPath?: string;
  status: LocalEventStatus;
  message: string;
  errorCode?: string;
  failureReason?: string;
  suggestion?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditFindingFilters {
  resourceType?: LocalResourceType;
  resourceId?: string;
  bindingId?: string;
  agentId?: string;
  projectId?: string;
  kitId?: string;
  ruleId?: string;
  severity?: AuditSeverity;
  auditStatus?: AuditStatus;
  path?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface AuditFindingDetail {
  finding: AuditFindingRecord;
  relatedEvents: LocalEventRecord[];
}

export interface ProjectRemovalBlocker {
  resourceId: string;
  bindingId?: string;
  resourceType: LocalResourceType;
  name: string;
  agentId?: string;
  kitId?: string;
  targetPath?: string;
  lifecycleStatus: LifecycleStatus;
  operationStatus: OperationStatus;
}

export interface ProjectRemovalValidation {
  projectId: string;
  exists: boolean;
  allowed: boolean;
  blockers: ProjectRemovalBlocker[];
  projectPath?: string;
  pathStatus?: PathStatus;
  cleanupGuidance: string;
}

export interface ProjectRemovalResult {
  validation: ProjectRemovalValidation;
  removed: boolean;
  planId?: string;
  executionId?: string;
  eventId?: string;
}

export interface ProjectScanTarget {
  projectId: string;
  name: string;
  targetPath: string;
  metadata: Record<string, unknown>;
}

export interface StaticAuditAllResourcesResult {
  runId: string;
  audited: number;
  skipped: number;
  failed: number;
  findingCount: number;
  eventIds: string[];
  failures: Array<{
    resourceId: string;
    bindingId?: string;
    targetPath?: string;
    errorCode: string;
    message: string;
  }>;
}

export interface LocalPathCheckResult {
  resourceId?: string;
  bindingId?: string;
  resourceType?: LocalResourceType;
  targetPath: string;
  pathStatus: PathStatus;
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  size?: number;
  mtime?: string;
  currentHash?: string;
  drifted?: boolean;
  eventId: string;
  checkedAt: string;
  message: string;
}

export interface LocalFilePreviewResult {
  resourceId?: string;
  bindingId?: string;
  resourceType?: LocalResourceType;
  targetPath: string;
  previewAvailable: boolean;
  contentType?: FileBackedResource['contentType'];
  size?: number;
  redactedContent?: string;
  failureReason?: string;
  suggestion?: string;
  eventId: string;
  previewedAt: string;
}

export interface KitApplicationTargetRecord {
  scopeType: ResourceScopeType;
  agentId?: string;
  projectId?: string;
  scopePath?: string;
  targetPath?: string;
}

export interface KitBindingRecordResult {
  resourceId: string;
  bindingId: string;
  resourceType: LocalResourceType;
}

export interface RemovedKitBindingRecord {
  resourceId: string;
  bindingId: string;
  resourceType: LocalResourceType;
  agentId?: string;
  projectId?: string;
  targetPath?: string;
}

export class LocalLifecycleRepository {
  constructor(
    private readonly db: LocalDatabase,
    private readonly eventQueue: LocalEventQueue = new LocalEventQueue(db)
  ) {}

  list(): LocalLifecycleSnapshot {
    return {
      extensions: this.db.query<Record<string, unknown>>(
        `SELECT extension_id as extensionId, name, summary, visibility, status, cached_at as cachedAt, updated_at as updatedAt
         FROM local_extensions ORDER BY updated_at DESC`
      ),
      versions: this.db.query<Record<string, unknown>>(
        `SELECT extension_id as extensionId, version, package_sha256 as packageSha256, status, cached_at as cachedAt, updated_at as updatedAt
         FROM local_extension_versions ORDER BY updated_at DESC`
      ),
      targets: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT id, extension_id as extensionId, target, status, metadata_json as metadataJson, updated_at as updatedAt
         FROM local_targets ORDER BY updated_at DESC`
      )),
      tools: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT id, extension_id as extensionId, target, tool_name as toolName, status, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
         FROM local_tools ORDER BY updated_at DESC`
      )),
      projects: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT project_id as projectId, name, extension_id as extensionId, status, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
         FROM local_projects ORDER BY updated_at DESC`
      )),
      mcpInstallations: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT id, extension_id as extensionId, target, status, config_path as configPath, secure_ref as secureRef, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
         FROM mcp_local_installations ORDER BY updated_at DESC`
      )),
      pluginInstallations: withMetadata(this.db.query<Record<string, unknown>>(
        `SELECT id, extension_id as extensionId, target, status, adapter_id as adapterId, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
         FROM plugin_local_installations ORDER BY updated_at DESC`
      )),
      resources: this.listResources()
    };
  }

  listProjectScanTargets(): ProjectScanTarget[] {
    return this.db.query<{ project_id: string; name: string; metadata_json: string }>(
      `SELECT project_id, name, metadata_json
       FROM local_projects
       ORDER BY updated_at DESC`
    ).flatMap((row) => {
      const metadata = safeParseObject(row.metadata_json);
      const targetPath = stringValue(metadata.target)
        ?? stringValue(metadata.projectPath)
        ?? stringValue(metadata.path)
        ?? stringValue(metadata.rootPath);
      if (!targetPath) return [];
      return [{
        projectId: row.project_id,
        name: row.name,
        targetPath,
        metadata
      }];
    });
  }

  async runStaticAuditForAllResources(input: { requestID?: string; runId?: string } = {}): Promise<StaticAuditAllResourcesResult> {
    const runId = input.runId ?? `static_audit_${randomUUID()}`;
    const now = new Date().toISOString();
    const snapshot = this.listResources();
    const eventIds: string[] = [];
    const failures: StaticAuditAllResourcesResult['failures'] = [];
    let audited = 0;
    let skipped = 0;
    let failed = 0;
    let findingCount = 0;

    for (const row of snapshot.rows) {
      if (row.resource.type === LocalResourceTypes.AUDIT_FINDING || row.resource.type === LocalResourceTypes.LOCAL_EVENT) {
        skipped += 1;
        continue;
      }
      const binding = row.binding;
      const targetPath = binding?.targetPath ?? row.resource.sourcePath;
      try {
        const content = await staticAuditContentForRow(row);
        const audit = auditStaticResource({
          resourceId: row.resource.id,
          bindingId: binding?.id,
          resourceType: row.resource.type,
          name: row.resource.displayName || row.resource.name,
          path: targetPath,
          content,
          agentId: binding?.agentId,
          projectId: binding?.projectId,
          kitId: binding?.kitId,
          permissionSummary: row.resource.permissionSummary,
          metadata: {
            ...row.resource.metadata,
            binding: binding ? redactForLog(binding.metadata) : undefined,
            sourceType: row.resource.sourceType,
            staticOnly: true
          },
          knownResourceIds: snapshot.resources.map((resource) => resource.id),
          relatedEventIds: row.events.map((event) => event.eventId)
        }, { runId: `${runId}_${audited + skipped + failed + 1}`, detectedAt: now });
        await this.upsertAuditRunFindings(audit.runId, audit.findings, [{ resourceId: row.resource.id, bindingId: binding?.id }]);
        const eventId = await this.recordLocalEvent({
          eventType: LocalEventTypes.STATIC_AUDIT_RUN,
          operationId: runId,
          resourceId: row.resource.id,
          bindingId: binding?.id,
          resourceType: row.resource.type,
          agentId: binding?.agentId,
          projectId: binding?.projectId,
          kitId: binding?.kitId,
          status: 'success',
          message: `静态审计完成：${audit.summary.findingCount} 项发现，Trust Score ${audit.trustScore}。`,
          suggestion: audit.summary.criticalCount > 0 || audit.summary.highCount > 0 ? '先处理高风险审计发现，再执行写入或启用操作。' : undefined,
          syncStatus: SyncStatuses.LOCAL_ONLY,
          createdAt: now,
          metadata: {
            requestID: input.requestID,
            runId: audit.runId,
            trustScore: audit.trustScore,
            auditSummary: audit.summary,
            staticOnly: true,
            targetPath
          }
        });
        eventIds.push(eventId);
        audited += 1;
        findingCount += audit.findings.length;
      } catch (error) {
        failed += 1;
        const errorCode = error instanceof SyntaxError ? 'static_audit_parse_failed' : errorCodeForAudit(error);
        const message = error instanceof Error ? error.message : 'Static audit failed';
        failures.push({
          resourceId: row.resource.id,
          bindingId: binding?.id,
          targetPath,
          errorCode,
          message
        });
        const eventId = await this.recordLocalEvent({
          eventType: LocalEventTypes.AUDIT_FAILED,
          operationId: runId,
          resourceId: row.resource.id,
          bindingId: binding?.id,
          resourceType: row.resource.type,
          agentId: binding?.agentId,
          projectId: binding?.projectId,
          kitId: binding?.kitId,
          status: 'failure',
          message: '静态审计失败。',
          errorCode,
          failureReason: message,
          suggestion: '修复资源内容或路径权限后重新运行静态审计。',
          syncStatus: SyncStatuses.LOCAL_ONLY,
          createdAt: now,
          metadata: { requestID: input.requestID, targetPath, staticOnly: true }
        });
        eventIds.push(eventId);
      }
    }

    return { runId, audited, skipped, failed, findingCount, eventIds, failures };
  }

  async checkResourcePath(input: { resourceId?: string; bindingId?: string; targetPath?: string; requestID?: string; operationId?: string } = {}): Promise<LocalPathCheckResult> {
    const targetRow = input.bindingId
      ? this.db.query<{
        resource_id: string;
        resource_type: LocalResourceType;
        source_path?: string;
        binding_id?: string;
        target_path?: string;
        agent_id?: string;
        project_id?: string;
        kit_id?: string;
        drift_status: DriftStatus;
        external_modified: number;
        drifted: number;
        metadata_json?: string;
      }>(
        `SELECT r.id as resource_id, r.type as resource_type, r.source_path, b.id as binding_id,
                b.target_path, b.agent_id, b.project_id, b.kit_id, b.drift_status,
                b.external_modified, b.drifted, b.metadata_json
         FROM resource_bindings b
         JOIN local_resources r ON r.id = b.resource_id
         WHERE b.id = ?
         LIMIT 1`,
        [input.bindingId]
      )[0]
      : input.resourceId
        ? this.db.query<{
          resource_id: string;
          resource_type: LocalResourceType;
          source_path?: string;
          binding_id?: string;
          target_path?: string;
          agent_id?: string;
          project_id?: string;
          kit_id?: string;
          drift_status: DriftStatus;
          external_modified: number;
          drifted: number;
          metadata_json?: string;
        }>(
          `SELECT r.id as resource_id, r.type as resource_type, r.source_path, b.id as binding_id,
                  b.target_path, b.agent_id, b.project_id, b.kit_id, b.drift_status,
                  b.external_modified, b.drifted, b.metadata_json
           FROM local_resources r
           LEFT JOIN resource_bindings b ON b.resource_id = r.id
           WHERE r.id = ?
           ORDER BY b.updated_at DESC
           LIMIT 1`,
          [input.resourceId]
        )[0]
        : undefined;

    if ((input.bindingId || input.resourceId) && !targetRow && !input.targetPath) {
      throw new DesktopErrorException(makeDesktopError('resource_not_found', '未找到可检查路径的本地资源记录。', input.requestID, input));
    }

    const targetPath = input.targetPath ?? targetRow?.target_path ?? targetRow?.source_path;
    if (!targetPath) {
      throw new DesktopErrorException(makeDesktopError('validation_failed', '路径检查需要 bindingId、resourceId 或 targetPath。', input.requestID, input));
    }

    const now = new Date().toISOString();
    const operationId = input.operationId ?? `path_check_${randomUUID()}`;
    let pathStatus: PathStatus = PathStatuses.OK;
    let exists = false;
    let isFile = false;
    let isDirectory = false;
    let size: number | undefined;
    let mtime: string | undefined;
    let currentHash: string | undefined;
    let drifted: boolean | undefined;
    let errorCode: string | undefined;
    let failureReason: string | undefined;

    try {
      const targetStat = await stat(targetPath);
      exists = true;
      isFile = targetStat.isFile();
      isDirectory = targetStat.isDirectory();
      size = targetStat.size;
      mtime = targetStat.mtime.toISOString();
      if (!isFile && !isDirectory) pathStatus = PathStatuses.INVALID;
    } catch (error) {
      pathStatus = pathStatusForCheckError(error);
      errorCode = pathCheckErrorCode(error);
      failureReason = errorMessage(error);
    }

    if (pathStatus === PathStatuses.OK && isFile && targetRow?.binding_id) {
      try {
        const fileBytes = await readFile(targetPath);
        currentHash = sha256(fileBytes);
        const previous = this.db.query<{ last_known_hash: string; current_hash?: string }>(
          `SELECT last_known_hash, current_hash
           FROM file_backed_resources
           WHERE binding_id = ? AND path = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
          [targetRow.binding_id, targetPath]
        )[0];
        const previousHash = previous?.current_hash ?? previous?.last_known_hash;
        drifted = Boolean(previousHash && previousHash !== currentHash);
        await this.upsertFileBackedResource({
          resourceId: targetRow.resource_id,
          bindingId: targetRow.binding_id,
          path: targetPath,
          contentType: contentTypeFromPath(targetPath),
          size: size ?? fileBytes.length,
          lastKnownMtime: mtime ?? now,
          lastKnownSize: size ?? fileBytes.length,
          lastKnownHash: previous?.last_known_hash ?? currentHash,
          currentHash,
          externalModified: drifted,
          drifted,
          previewAvailable: previewableFile(targetPath, size ?? fileBytes.length),
          metadata: { ...safeParseObject(targetRow.metadata_json), pathCheckedAt: now }
        });
      } catch (error) {
        pathStatus = pathStatusForCheckError(error);
        errorCode = pathCheckErrorCode(error);
        failureReason = errorMessage(error);
      }
    }

    if (targetRow?.binding_id) {
      const nextDriftStatus = currentHash
        ? drifted ? DriftStatuses.HASH_CHANGED : DriftStatuses.UNKNOWN
        : targetRow.drift_status;
      await this.db.run(
        `UPDATE resource_bindings
         SET path_status = ?, drift_status = ?, current_hash = COALESCE(?, current_hash),
             external_modified = ?, drifted = ?, last_event_at = ?, updated_at = ?
         WHERE id = ?`,
        [
          pathStatus,
          nextDriftStatus,
          currentHash ?? null,
          currentHash ? (drifted ? 1 : 0) : targetRow.external_modified,
          currentHash ? (drifted ? 1 : 0) : targetRow.drifted,
          now,
          now,
          targetRow.binding_id
        ]
      );
    }

    const ok = pathStatus === PathStatuses.OK;
    const message = ok
      ? `路径检查完成：${targetPath}`
      : `路径检查发现异常：${pathStatusLabel(pathStatus)}。`;
    const eventId = await this.recordLocalEvent({
      eventType: ok ? LocalEventTypes.PATH_CHECKED : LocalEventTypes.PATH_ERROR,
      operationId,
      resourceId: targetRow?.resource_id ?? input.resourceId,
      bindingId: targetRow?.binding_id ?? input.bindingId,
      resourceType: targetRow?.resource_type,
      agentId: targetRow?.agent_id,
      projectId: targetRow?.project_id,
      kitId: targetRow?.kit_id,
      status: ok ? 'success' : 'failure',
      message,
      errorCode,
      failureReason,
      suggestion: ok ? undefined : '检查路径是否存在、权限是否允许读取，或清理失效的本地资源绑定。',
      syncStatus: SyncStatuses.LOCAL_ONLY,
      createdAt: now,
      metadata: {
        requestID: input.requestID,
        targetPath,
        pathStatus,
        exists,
        isFile,
        isDirectory,
        size,
        mtime,
        currentHash,
        drifted,
        staticOnly: true
      }
    });

    return {
      resourceId: targetRow?.resource_id ?? input.resourceId,
      bindingId: targetRow?.binding_id ?? input.bindingId,
      resourceType: targetRow?.resource_type,
      targetPath,
      pathStatus,
      exists,
      isFile,
      isDirectory,
      size,
      mtime,
      currentHash,
      drifted,
      eventId,
      checkedAt: now,
      message
    };
  }

  async checkTrackedResourcePathByTargetPath(targetPath: string, requestID?: string): Promise<LocalPathCheckResult | undefined> {
    const binding = this.db.query<{ id: string }>(
      `SELECT id FROM resource_bindings WHERE target_path = ? ORDER BY updated_at DESC LIMIT 1`,
      [targetPath]
    )[0];
    if (!binding) return undefined;
    return this.checkResourcePath({ bindingId: binding.id, requestID });
  }

  async previewResourceFile(input: { resourceId?: string; bindingId?: string; targetPath?: string; requestID?: string; operationId?: string } = {}): Promise<LocalFilePreviewResult> {
    const targetRow = input.bindingId
      ? this.db.query<{
        resource_id: string;
        resource_type: LocalResourceType;
        source_path?: string;
        binding_id?: string;
        target_path?: string;
        agent_id?: string;
        project_id?: string;
        kit_id?: string;
      }>(
        `SELECT r.id as resource_id, r.type as resource_type, r.source_path, b.id as binding_id,
                b.target_path, b.agent_id, b.project_id, b.kit_id
         FROM resource_bindings b
         JOIN local_resources r ON r.id = b.resource_id
         WHERE b.id = ?
         LIMIT 1`,
        [input.bindingId]
      )[0]
      : input.resourceId
        ? this.db.query<{
          resource_id: string;
          resource_type: LocalResourceType;
          source_path?: string;
          binding_id?: string;
          target_path?: string;
          agent_id?: string;
          project_id?: string;
          kit_id?: string;
        }>(
          `SELECT r.id as resource_id, r.type as resource_type, r.source_path, b.id as binding_id,
                  b.target_path, b.agent_id, b.project_id, b.kit_id
           FROM local_resources r
           LEFT JOIN resource_bindings b ON b.resource_id = r.id
           WHERE r.id = ?
           ORDER BY b.updated_at DESC
           LIMIT 1`,
          [input.resourceId]
        )[0]
        : undefined;

    if ((input.bindingId || input.resourceId) && !targetRow && !input.targetPath) {
      throw new DesktopErrorException(makeDesktopError('resource_not_found', '未找到可预览文件的本地资源记录。', input.requestID, input));
    }

    const targetPath = input.targetPath ?? targetRow?.target_path ?? targetRow?.source_path;
    if (!targetPath) {
      throw new DesktopErrorException(makeDesktopError('validation_failed', '文件预览需要 bindingId、resourceId 或 targetPath。', input.requestID, input));
    }

    const now = new Date().toISOString();
    const operationId = input.operationId ?? `file_preview_${randomUUID()}`;
    let previewAvailable = false;
    let contentType: FileBackedResource['contentType'] | undefined;
    let size: number | undefined;
    let redactedContent: string | undefined;
    let failureReason: string | undefined;
    let suggestion: string | undefined;
    let errorCode: string | undefined;

    try {
      const targetStat = await stat(targetPath);
      size = targetStat.size;
      contentType = contentTypeFromPath(targetPath);
      if (!targetStat.isFile()) {
        failureReason = '目标路径不是文件，无法预览。';
        suggestion = '选择具体文件资源或进入目录内的文件记录。';
        errorCode = 'target_path_not_file';
      } else if (!previewableFile(targetPath, targetStat.size)) {
        failureReason = targetStat.size > 256 * 1024 ? '文件超过 256 KiB 预览限制。' : `文件类型 ${contentType} 不支持文本预览。`;
        suggestion = '仅预览小型 json、toml、yaml、markdown 或 text 文件；其他文件仍可执行路径检查和静态审计。';
        errorCode = targetStat.size > 256 * 1024 ? 'preview_file_too_large' : 'preview_type_not_supported';
      } else {
        redactedContent = redactString(await readFile(targetPath, 'utf8'));
        previewAvailable = true;
      }
    } catch (error) {
      failureReason = errorMessage(error);
      suggestion = '检查路径是否存在、权限是否允许读取，或清理失效的本地资源绑定。';
      errorCode = pathCheckErrorCode(error);
    }

    const eventId = await this.recordLocalEvent({
      eventType: previewAvailable ? LocalEventTypes.FILE_PREVIEWED : LocalEventTypes.FILE_PREVIEW_FAILED,
      operationId,
      resourceId: targetRow?.resource_id ?? input.resourceId,
      bindingId: targetRow?.binding_id ?? input.bindingId,
      resourceType: targetRow?.resource_type,
      agentId: targetRow?.agent_id,
      projectId: targetRow?.project_id,
      kitId: targetRow?.kit_id,
      status: previewAvailable ? 'success' : 'failure',
      message: previewAvailable ? `文件预览完成：${targetPath}` : `文件预览不可用：${failureReason ?? '未知原因'}`,
      errorCode,
      failureReason,
      suggestion,
      syncStatus: SyncStatuses.LOCAL_ONLY,
      createdAt: now,
      metadata: {
        requestID: input.requestID,
        targetPath,
        contentType,
        size,
        previewAvailable,
        redacted: previewAvailable,
        staticOnly: true
      }
    });

    return {
      resourceId: targetRow?.resource_id ?? input.resourceId,
      bindingId: targetRow?.binding_id ?? input.bindingId,
      resourceType: targetRow?.resource_type,
      targetPath,
      previewAvailable,
      contentType,
      size,
      redactedContent,
      failureReason,
      suggestion,
      eventId,
      previewedAt: now
    };
  }

  listResources(): LocalResourceSnapshot {
    this.backfillLegacyResourcesIfNeeded();
    const rawResources = this.db.query<ResourceRow>(
      `SELECT id, type, name, display_name, description, source_type, source_id, source_path,
              version, latest_version, sha256, package_hash, managed, central_store_managed,
              native_directory_managed, ea_managed_fallback, permission_summary_json,
              audit_summary_json, metadata_json, created_at, last_scanned_at,
              last_modified_at, last_event_at
       FROM local_resources
       ORDER BY COALESCE(last_scanned_at, created_at) DESC, display_name ASC`
    ).map(mapResourceRow);
    const rawBindings = this.db.query<BindingRow>(
      `SELECT id, resource_id, resource_type, agent_id, project_id, kit_id, scope_type, scope_path,
              target_path, managed_mode, write_mode, detection_status, lifecycle_status, path_status,
              auth_status, audit_status, drift_status, operation_status, sync_status, last_known_hash,
              current_hash, external_modified, drifted, backup_snapshot_id, last_execution_id,
              last_event_at, metadata_json, updated_at
       FROM resource_bindings
       ORDER BY updated_at DESC`
    ).map(mapBindingRow);
    const files = this.db.query<FileRow>(
      `SELECT resource_id, binding_id, path, content_type, size, last_known_mtime, last_known_size,
              last_known_hash, current_hash, last_managed_hash, external_modified, drifted,
              preview_available, backup_snapshot_id, metadata_json
       FROM file_backed_resources
       ORDER BY updated_at DESC`
    ).map(mapFileRow);
    const events = this.db.query<EventRow>(
      `SELECT id, idempotency_key, event_type, operation_id, execution_id, resource_id, binding_id,
              resource_type, agent_id, project_id, kit_id, result, status, error_code, failure_reason,
              suggestion, offline_created, sync_status, server_ack_status, payload_json, created_at, synced_at
       FROM local_events
       ORDER BY created_at DESC`
    ).map(mapEventRow);
    const findings = this.listAuditFindings();
    const findingsByResource = groupBy(findings, (finding) => finding.resourceId);
    const resources = rawResources.map((resource) => {
      const resourceFindings = findingsByResource.get(resource.id) ?? [];
      if (resourceFindings.length === 0) return resource;
      return {
        ...resource,
        auditSummary: summarizeAuditFindings(resourceFindings, latestString(resourceFindings.map((finding) => finding.detectedAt)) ?? new Date().toISOString())
      };
    });
    const bindings = rawBindings.map((binding) => {
      const bindingFindings = findingsForBinding(findingsByResource.get(binding.resourceId) ?? [], binding.id);
      if (bindingFindings.length === 0) return binding;
      return {
        ...binding,
        auditStatus: summarizeAuditFindings(bindingFindings, latestString(bindingFindings.map((finding) => finding.detectedAt)) ?? binding.updatedAt ?? new Date().toISOString()).status
      };
    });

    const bindingsByResource = groupBy(bindings, (binding) => binding.resourceId);
    const filesByBinding = groupBy(files, (file) => file.bindingId);
    const eventsByResource = groupBy(events, (event) => event.resourceId ?? '');
    const rows: LocalResourceSnapshot['rows'] = resources.flatMap((resource): LocalResourceSnapshot['rows'] => {
      const resourceBindings = bindingsByResource.get(resource.id) ?? [];
      if (resourceBindings.length === 0) {
        return [{
          resource,
          binding: undefined,
          files: [],
          events: eventsByResource.get(resource.id) ?? [],
          findings: findingsByResource.get(resource.id) ?? [],
          status: aggregateResourceStatus({ auditStatus: resource.auditSummary.status }),
          scopeLabel: '未绑定'
        }];
      }
      return resourceBindings.map((binding) => ({
        resource,
        binding,
        files: filesByBinding.get(binding.id) ?? [],
        events: eventsByResource.get(resource.id) ?? [],
        findings: findingsForBinding(findingsByResource.get(resource.id) ?? [], binding.id),
        status: aggregateResourceStatus(binding),
        scopeLabel: resourceScopeLabel(binding)
      }));
    });
    const generatedAt = new Date().toISOString();
    return {
      resources,
      bindings,
      files,
      events,
      findings,
      rows,
      summary: {
        resourceCount: resources.length,
        bindingCount: bindings.length,
        fileCount: files.length,
        eventCount: events.length,
        pendingSyncEvents: events.filter((event) => event.syncStatus === SyncStatuses.PENDING_SYNC).length,
        failureCount: rows.filter((row) => row.status.tone === 'danger').length,
        lastScannedAt: latestString(resources.map((resource) => resource.lastScannedAt)),
        generatedAt
      }
    };
  }

  async upsertAuditRunFindings(runId: string, findings: AuditFindingRecord[], scopes?: Array<{ resourceId: string; bindingId?: string }>): Promise<void> {
    const affectedScopes = uniqueScopes([
      ...findings.map((finding) => ({ resourceId: finding.resourceId, bindingId: finding.bindingId })),
      ...(scopes ?? [])
    ]);
    await this.db.transaction((tx) => {
      tx.run(`DELETE FROM local_audit_findings WHERE run_id = ?`, [runId]);
      for (const scope of affectedScopes) {
        if (scope.bindingId) {
          tx.run(`DELETE FROM local_audit_findings WHERE resource_id = ? AND binding_id = ?`, [scope.resourceId, scope.bindingId]);
        } else {
          tx.run(`DELETE FROM local_audit_findings WHERE resource_id = ? AND binding_id IS NULL`, [scope.resourceId]);
        }
      }
      for (const finding of findings) {
        tx.run(
          `INSERT INTO local_audit_findings(
            id, run_id, rule_id, harness_rule_id, resource_id, binding_id, resource_type,
            agent_id, project_id, kit_id, severity, audit_status, trust_score_impact,
            permission_category, path, line_start, line_end, snippet_hash, path_summary,
            title, description, impact_scope_json, remediation, related_event_ids_json,
            metadata_json, detected_at, resolved_at, blocker
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          auditFindingParams({ ...finding, runId })
        );
      }
      for (const scope of affectedScopes) {
        const resourcePersisted = tx.query<AuditFindingRow>(
          `SELECT *
           FROM local_audit_findings
           WHERE resource_id = ?`,
          [scope.resourceId]
        ).map(mapAuditFindingRow);
        const resourceSummary = summarizeAuditFindings(resourcePersisted, latestString(resourcePersisted.map((finding) => finding.detectedAt)) ?? new Date().toISOString());
        tx.run(
          `UPDATE local_resources
           SET audit_summary_json = ?, last_scanned_at = ?
           WHERE id = ?`,
          [JSON.stringify(redactForLog(resourceSummary)), resourceSummary.lastAuditedAt ?? new Date().toISOString(), scope.resourceId]
        );
        const bindingFindings = scope.bindingId
          ? findingsForBinding(resourcePersisted, scope.bindingId)
          : resourcePersisted;
        const bindingSummary = summarizeAuditFindings(bindingFindings, latestString(bindingFindings.map((finding) => finding.detectedAt)) ?? resourceSummary.lastAuditedAt ?? new Date().toISOString());
        tx.run(
          `UPDATE resource_bindings
           SET audit_status = ?, updated_at = ?
           WHERE resource_id = ? AND (? IS NULL OR id = ?)`,
          [bindingSummary.status, bindingSummary.lastAuditedAt ?? new Date().toISOString(), scope.resourceId, scope.bindingId ?? null, scope.bindingId ?? null]
        );
      }
    });
  }

  listAuditFindings(filters: AuditFindingFilters = {}): AuditFindingRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number | null> = [];
    addFilter(clauses, params, 'resource_type', filters.resourceType);
    addFilter(clauses, params, 'resource_id', filters.resourceId);
    addFilter(clauses, params, 'binding_id', filters.bindingId);
    addFilter(clauses, params, 'agent_id', filters.agentId);
    addFilter(clauses, params, 'project_id', filters.projectId);
    addFilter(clauses, params, 'kit_id', filters.kitId);
    addFilter(clauses, params, 'rule_id', filters.ruleId);
    addFilter(clauses, params, 'severity', filters.severity);
    addFilter(clauses, params, 'audit_status', filters.auditStatus);
    if (filters.path) {
      clauses.push('path LIKE ?');
      params.push(`%${filters.path}%`);
    }
    if (filters.since) {
      clauses.push('detected_at >= ?');
      params.push(filters.since);
    }
    if (filters.until) {
      clauses.push('detected_at <= ?');
      params.push(filters.until);
    }
    const limit = filters.limit === undefined ? undefined : Math.max(1, Math.min(filters.limit, 2000));
    if (limit !== undefined) params.push(limit);
    return this.db.query<AuditFindingRow>(
      `SELECT *
       FROM local_audit_findings
       ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY detected_at DESC, severity ASC, rule_id ASC
       ${limit !== undefined ? 'LIMIT ?' : ''}`,
      params
    ).map(mapAuditFindingRow);
  }

  getAuditFinding(findingId: string): AuditFindingDetail | undefined {
    const finding = this.db.query<AuditFindingRow>(
      `SELECT *
       FROM local_audit_findings
       WHERE id = ?
       LIMIT 1`,
      [findingId]
    ).map(mapAuditFindingRow)[0];
    if (!finding) return undefined;
    const relatedById = finding.relatedEventIds.length > 0
      ? this.db.query<EventRow>(
        `SELECT id, idempotency_key, event_type, operation_id, execution_id, resource_id, binding_id,
                resource_type, agent_id, project_id, kit_id, result, status, error_code, failure_reason,
                suggestion, offline_created, sync_status, server_ack_status, payload_json, created_at, synced_at
         FROM local_events
         WHERE id IN (${finding.relatedEventIds.map(() => '?').join(',')})
         ORDER BY created_at DESC`,
        finding.relatedEventIds
      ).map(mapEventRow)
      : [];
    const relatedByScope = this.db.query<EventRow>(
      `SELECT id, idempotency_key, event_type, operation_id, execution_id, resource_id, binding_id,
              resource_type, agent_id, project_id, kit_id, result, status, error_code, failure_reason,
              suggestion, offline_created, sync_status, server_ack_status, payload_json, created_at, synced_at
       FROM local_events
       WHERE resource_id = ?
          OR (? IS NOT NULL AND binding_id = ?)
          OR (? IS NOT NULL AND agent_id = ?)
          OR (? IS NOT NULL AND project_id = ?)
          OR (? IS NOT NULL AND kit_id = ?)
       ORDER BY created_at DESC
       LIMIT 50`,
      [
        finding.resourceId,
        finding.bindingId ?? null,
        finding.bindingId ?? null,
        finding.agentId ?? null,
        finding.agentId ?? null,
        finding.projectId ?? null,
        finding.projectId ?? null,
        finding.kitId ?? null,
        finding.kitId ?? null
      ]
    ).map(mapEventRow);
    return {
      finding,
      relatedEvents: dedupeEvents([...relatedById, ...relatedByScope])
    };
  }

  private backfillLegacyResourcesIfNeeded(): void {
    const now = new Date().toISOString();
    const versionByExtension = new Map<string, LegacyVersionRow>();
    for (const version of this.db.query<LegacyVersionRow>(
      `SELECT extension_id as extensionId, version, package_sha256 as packageSha256, status, updated_at as updatedAt
       FROM local_extension_versions
       ORDER BY updated_at DESC`
    )) {
      if (!versionByExtension.has(version.extensionId)) versionByExtension.set(version.extensionId, version);
    }

    const targetRows = this.db.query<LegacyTargetRow>(
      `SELECT extension_id as extensionId, target, status, metadata_json as metadataJson, updated_at as updatedAt
       FROM local_targets
       ORDER BY updated_at DESC`
    );
    const targetsByExtension = groupBy(targetRows, (row) => row.extensionId);
    const extensionRows = this.db.query<LegacyExtensionRow>(
      `SELECT extension_id as extensionId, name, summary, visibility, status, cached_at as cachedAt, updated_at as updatedAt
       FROM local_extensions
       ORDER BY updated_at DESC`
    );
    const extensionIds = new Set<string>();
    for (const extension of extensionRows) {
      extensionIds.add(extension.extensionId);
      const targets = targetsByExtension.get(extension.extensionId) ?? [];
      const version = versionByExtension.get(extension.extensionId);
      const targetMetadata = safeParseObject(targets[0]?.metadataJson);
      const resourceType = resourceTypeFromExtensionKind(legacyKindFromMetadata(targetMetadata) ?? legacyKindFromExtensionId(extension.extensionId));
      const status = extension.status ?? version?.status ?? targets[0]?.status ?? 'scanned';
      const sourceType = extension.visibility === 'authorized_cache'
        ? LocalResourceSourceTypes.CENTRAL_STORE
        : inferSourceType(targetMetadata, targets[0]?.target);
      this.upsertLegacyResourceGraph({
        resourceType,
        sourceId: extension.extensionId,
        name: extension.name ?? extension.extensionId,
        description: extension.summary,
        version: version?.version,
        packageHash: version?.packageSha256,
        targetPath: targets[0]?.target,
        status,
        sourceType,
        managed: extension.visibility === 'authorized_cache',
        centralStoreManaged: sourceType === LocalResourceSourceTypes.CENTRAL_STORE,
        nativeDirectoryManaged: targetMetadata.source === 'known_tool_scan',
        metadata: { ...targetMetadata, legacyTable: 'local_extensions' },
        bindingKey: targets.length === 0 ? `legacy:${extension.extensionId}` : undefined,
        createBinding: targets.length === 0,
        createdAt: extension.cachedAt ?? now,
        updatedAt: extension.updatedAt ?? now
      });
      for (const target of targets) {
        const metadata = safeParseObject(target.metadataJson);
        this.upsertLegacyResourceGraph({
          resourceType,
          sourceId: extension.extensionId,
          name: extension.name ?? extension.extensionId,
          description: extension.summary,
          version: version?.version,
          packageHash: version?.packageSha256,
          targetPath: target.target,
          status: target.status,
          sourceType: inferSourceType(metadata, target.target),
          managed: Boolean(metadata.managed),
          centralStoreManaged: isCentralStoreSource(metadata, target.target),
          nativeDirectoryManaged: metadata.source === 'known_tool_scan',
          metadata: { ...metadata, legacyTable: 'local_targets' },
          updatedAt: target.updatedAt ?? extension.updatedAt ?? now
        });
      }
    }

    for (const target of targetRows) {
      if (extensionIds.has(target.extensionId)) continue;
      const metadata = safeParseObject(target.metadataJson);
      this.upsertLegacyResourceGraph({
        resourceType: resourceTypeFromExtensionKind(legacyKindFromMetadata(metadata) ?? legacyKindFromExtensionId(target.extensionId)),
        sourceId: target.extensionId,
        name: target.extensionId,
        targetPath: target.target,
        status: target.status,
        sourceType: inferSourceType(metadata, target.target),
        managed: Boolean(metadata.managed),
        centralStoreManaged: isCentralStoreSource(metadata, target.target),
        nativeDirectoryManaged: metadata.source === 'known_tool_scan',
        metadata: { ...metadata, legacyTable: 'local_targets' },
        updatedAt: target.updatedAt ?? now
      });
    }

    for (const mcp of this.db.query<LegacyMcpRow>(
      `SELECT id, extension_id as extensionId, target, status, config_path as configPath, secure_ref as secureRef,
              metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
       FROM mcp_local_installations`
    )) {
      const sourceId = mcp.extensionId ?? mcp.id;
      const targetPath = mcp.configPath ?? mcp.target;
      const metadata = safeParseObject(mcp.metadataJson);
      this.upsertLegacyResourceGraph({
        resourceType: LocalResourceTypes.MCP_SERVER,
        sourceId,
        name: sourceId,
        targetPath,
        status: mcp.status,
        sourceType: inferSourceType(metadata, targetPath),
        managed: true,
        metadata: { ...metadata, secureRef: mcp.secureRef, legacyTable: 'mcp_local_installations' },
        createdAt: mcp.createdAt ?? now,
        updatedAt: mcp.updatedAt ?? now
      });
    }

    for (const plugin of this.db.query<LegacyPluginRow>(
      `SELECT id, extension_id as extensionId, target, status, adapter_id as adapterId,
              metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
       FROM plugin_local_installations`
    )) {
      const sourceId = plugin.extensionId ?? plugin.id;
      const metadata = safeParseObject(plugin.metadataJson);
      this.upsertLegacyResourceGraph({
        resourceType: LocalResourceTypes.PLUGIN,
        sourceId,
        name: sourceId,
        targetPath: plugin.target,
        status: plugin.status,
        sourceType: inferSourceType(metadata, plugin.target),
        managed: true,
        metadata: { ...metadata, adapterId: plugin.adapterId, legacyTable: 'plugin_local_installations' },
        createdAt: plugin.createdAt ?? now,
        updatedAt: plugin.updatedAt ?? now
      });
    }

    for (const tool of this.db.query<LegacyToolRow>(
      `SELECT extension_id as extensionId, target, tool_name as toolName, status, metadata_json as metadataJson,
              created_at as createdAt, updated_at as updatedAt
       FROM local_tools`
    )) {
      const metadata = safeParseObject(tool.metadataJson);
      const kitManifest = extractKitManifest(metadata);
      if (kitManifest) {
        this.upsertLegacyResourceGraph({
          resourceType: LocalResourceTypes.KIT,
          sourceId: kitManifest.kitId,
          name: kitManifest.name,
          version: kitManifest.version,
          targetPath: tool.target,
          status: tool.status,
          sourceType: LocalResourceSourceTypes.KIT,
          managed: Boolean(metadata.managed),
          nativeDirectoryManaged: false,
          metadata: { ...metadata, kitManifest, toolName: tool.toolName, legacyTable: 'local_tools', legacyToolNormalizedAsKit: true },
          createdAt: tool.createdAt ?? now,
          updatedAt: tool.updatedAt ?? now
        });
      }
    }

    for (const project of this.db.query<LegacyProjectRow>(
      `SELECT project_id as projectId, name, extension_id as extensionId, status, metadata_json as metadataJson,
              created_at as createdAt, updated_at as updatedAt
       FROM local_projects`
    )) {
      const metadata = safeParseObject(project.metadataJson);
      this.upsertLegacyResourceGraph({
        resourceType: LocalResourceTypes.PROJECT,
        sourceId: project.projectId,
        name: project.name,
        targetPath: stringValue(metadata.target),
        status: project.status,
        sourceType: LocalResourceSourceTypes.PROJECT_DIRECTORY,
        managed: false,
        projectId: project.projectId,
        scopeType: ResourceScopeTypes.PROJECT,
        metadata: { ...metadata, extensionId: project.extensionId, legacyTable: 'local_projects' },
        createdAt: project.createdAt ?? now,
        updatedAt: project.updatedAt ?? now
      });
    }
  }

  async recordSkillInstalled(input: { extensionId: string; version: string; packageSha256?: string; name?: string; summary?: string }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO local_extensions(extension_id, name, summary, visibility, status, cached_at, updated_at)
       VALUES (?, ?, ?, 'authorized_cache', 'installed', ?, ?)`,
      [input.extensionId, input.name ?? input.extensionId, input.summary ?? null, now, now]
    );
    await this.db.run(
      `INSERT OR REPLACE INTO local_extension_versions(extension_id, version, package_sha256, status, cached_at, updated_at)
      VALUES (?, ?, ?, 'installed', ?, ?)`,
      [input.extensionId, input.version, input.packageSha256 ?? null, now, now]
    );
    await this.recordResourceGraph({
      resourceType: LocalResourceTypes.SKILL,
      sourceId: input.extensionId,
      name: input.name ?? input.extensionId,
      description: input.summary,
      version: input.version,
      packageHash: input.packageSha256,
      status: 'installed',
      sourceType: LocalResourceSourceTypes.CENTRAL_STORE,
      managed: true,
      centralStoreManaged: true,
      metadata: { discoveredBy: 'skill_install_record', packageSha256: input.packageSha256 },
      now
    });
  }

  async recordScannedExtension(input: ScannedLocalExtensionRecord): Promise<void> {
    const now = new Date().toISOString();
    const status = input.status ?? 'scanned';
    await this.db.run(
      `INSERT OR REPLACE INTO local_extensions(extension_id, name, summary, visibility, status, cached_at, updated_at)
       VALUES (?, ?, ?, 'local_scan', ?, ?, ?)`,
      [input.extensionId, input.name ?? input.extensionId, input.summary ?? null, status, now, now]
    );
    if (input.version) {
      await this.db.run(
        `INSERT OR REPLACE INTO local_extension_versions(extension_id, version, package_sha256, status, cached_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?)`,
        [input.extensionId, input.version, status, now, now]
      );
    }
    if (input.target) {
      await this.recordTarget({
        extensionId: input.extensionId,
        target: input.target,
        status,
        metadata: {
          ...(input.metadata ?? {}),
          kind: input.kind,
          discoveredBy: 'local_inventory_scan'
        }
      });
    }
    await this.recordResourceGraph({
      resourceType: resourceTypeFromExtensionKind(input.kind),
      sourceId: input.extensionId,
      name: input.name ?? input.extensionId,
      description: input.summary,
      version: input.version,
      targetPath: input.target,
      status,
      sourceType: inferSourceType(input.metadata, input.target),
      managed: Boolean(input.metadata?.managed ?? input.metadata?.source === 'local_inventory_scan'),
      centralStoreManaged: isCentralStoreSource(input.metadata, input.target),
      nativeDirectoryManaged: input.metadata?.source === 'known_tool_scan',
      metadata: { ...(input.metadata ?? {}), kind: input.kind, discoveredBy: 'local_inventory_scan' },
      now
    });
  }

  async recordScannedTool(input: { extensionId: string; target: string; toolName: string; status?: string; metadata?: Record<string, unknown> }): Promise<void> {
    const now = new Date().toISOString();
    const kitManifest = extractKitManifest(input.metadata);
    await this.db.run(
      `INSERT OR REPLACE INTO local_tools(id, extension_id, target, tool_name, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localId('tool', input.extensionId, `${input.target}:${input.toolName}`),
        input.extensionId,
        input.target,
        input.toolName,
        input.status ?? 'scanned',
        JSON.stringify(redactForLog({ ...(input.metadata ?? {}), discoveredBy: 'local_inventory_scan' })),
        now,
        now
      ]
    );
    if (!kitManifest) return;
    await this.recordResourceGraph({
      resourceType: LocalResourceTypes.KIT,
      sourceId: kitManifest.kitId,
      name: kitManifest.name,
      version: kitManifest.version,
      targetPath: input.target,
      status: input.status ?? 'scanned',
      sourceType: LocalResourceSourceTypes.KIT,
      managed: Boolean(input.metadata?.managed),
      nativeDirectoryManaged: false,
      metadata: { ...(input.metadata ?? {}), kitManifest, toolName: input.toolName, discoveredBy: 'local_inventory_scan', legacyToolNormalizedAsKit: true },
      now
    });
  }

  async recordScannedProject(input: { projectId: string; name: string; extensionId?: string; status?: string; metadata?: Record<string, unknown> }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO local_projects(project_id, name, extension_id, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.projectId,
        input.name,
        input.extensionId ?? null,
        input.status ?? 'scanned',
        JSON.stringify(redactForLog({ ...(input.metadata ?? {}), discoveredBy: 'local_inventory_scan' })),
        now,
        now
      ]
    );
    await this.recordResourceGraph({
      resourceType: LocalResourceTypes.PROJECT,
      sourceId: input.projectId,
      name: input.name,
      targetPath: stringValue((input.metadata ?? {}).target),
      status: input.status ?? 'scanned',
      sourceType: LocalResourceSourceTypes.PROJECT_DIRECTORY,
      managed: false,
      metadata: { ...(input.metadata ?? {}), extensionId: input.extensionId, discoveredBy: 'local_inventory_scan' },
      projectId: input.projectId,
      scopeType: ResourceScopeTypes.PROJECT,
      now
    });
  }

  async recordTarget(input: { extensionId: string; target: string; status: string; metadata?: Record<string, unknown> }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT OR REPLACE INTO local_targets(id, extension_id, target, status, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`target_${input.extensionId}_${input.target}`, input.extensionId, input.target, input.status, JSON.stringify(redactForLog(input.metadata ?? {})), now]
    );
    await this.recordResourceBindingForKnownTarget({
      extensionId: input.extensionId,
      target: input.target,
      status: input.status,
      metadata: input.metadata,
      now
    });
  }

  async recordMcpInstallation(input: { extensionId: string; target: string; status: string; configPath?: string; secureRef?: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO mcp_local_installations(id, extension_id, target, status, config_path, secure_ref, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [localId('mcp', input.extensionId, input.target), input.extensionId, input.target, input.status, input.configPath ?? null, input.secureRef ?? null, JSON.stringify(redactForLog(input.metadata ?? {}))]
    );
    await this.recordResourceGraph({
      resourceType: LocalResourceTypes.MCP_SERVER,
      sourceId: input.extensionId,
      name: input.extensionId,
      targetPath: input.configPath ?? input.target,
      status: input.status,
      sourceType: inferSourceType(input.metadata, input.configPath ?? input.target),
      managed: true,
      metadata: { ...(input.metadata ?? {}), secureRef: input.secureRef, discoveredBy: 'mcp_installation_record' }
    });
  }

  findMcpInstallation(extensionId: string, target: string): LocalMcpInstallationRecord | undefined {
    const row = this.db.query<Record<string, unknown>>(
      `SELECT id, extension_id as extensionId, target, status, config_path as configPath, secure_ref as secureRef, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
       FROM mcp_local_installations
       WHERE extension_id = ? AND (target = ? OR config_path = ?)
       ORDER BY updated_at DESC
       LIMIT 1`,
      [extensionId, target, target]
    )[0];
    if (!row) return undefined;
    const metadata = typeof row.metadataJson === 'string' ? safeParseJson(row.metadataJson) : {};
    return {
      id: String(row.id),
      extensionId: String(row.extensionId),
      target: String(row.target),
      status: String(row.status),
      configPath: typeof row.configPath === 'string' ? row.configPath : undefined,
      secureRef: typeof row.secureRef === 'string' ? row.secureRef : undefined,
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {},
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : undefined,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined
    };
  }

  async recordPluginInstallation(input: { extensionId: string; target: string; status: string; adapterId?: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO plugin_local_installations(id, extension_id, target, status, adapter_id, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [localId('plugin', input.extensionId, input.target), input.extensionId, input.target, input.status, input.adapterId ?? null, JSON.stringify(redactForLog(input.metadata ?? {}))]
    );
    await this.recordResourceGraph({
      resourceType: LocalResourceTypes.PLUGIN,
      sourceId: input.extensionId,
      name: input.extensionId,
      targetPath: input.target,
      status: input.status,
      sourceType: inferSourceType(input.metadata, input.target),
      managed: true,
      metadata: { ...(input.metadata ?? {}), adapterId: input.adapterId, discoveredBy: 'plugin_installation_record' }
    });
  }

  async markCleaned(input: { extensionId: string; target?: string; kind?: string; metadata?: Record<string, unknown> }): Promise<void> {
    const now = new Date().toISOString();
    const metadata = JSON.stringify(redactForLog({ ...(input.metadata ?? {}), cleanedAt: now }));
    const args = input.target
      ? ['cleaned', metadata, now, input.extensionId, input.target]
      : ['cleaned', now, input.extensionId];
    if (input.kind === 'mcp' && input.target) {
      await this.db.run(`UPDATE mcp_local_installations SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ? AND (target = ? OR config_path = ?)`, [...args, input.target]);
      await this.markResourceBindings(input.extensionId, 'cleaned', metadata, now, input.target);
      return;
    }
    if (input.kind === 'plugin' && input.target) {
      await this.db.run(`UPDATE plugin_local_installations SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ? AND target = ?`, args);
      await this.markResourceBindings(input.extensionId, 'cleaned', metadata, now, input.target);
      return;
    }
    if (input.target) {
      await this.db.run(`UPDATE local_targets SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ? AND target = ?`, args);
      await this.markResourceBindings(input.extensionId, 'cleaned', metadata, now, input.target);
      return;
    }
    await this.db.run(`UPDATE local_extensions SET status = ?, updated_at = ? WHERE extension_id = ?`, args);
    await this.db.run(`UPDATE local_extension_versions SET status = ?, updated_at = ? WHERE extension_id = ?`, args);
    await this.markResourceBindings(input.extensionId, 'cleaned', metadata, now);
  }

  async applyServerStateHints(hints: LocalLifecycleStateHint[]): Promise<LocalLifecycleHintApplySummary> {
    const strongestByExtension = new Map<string, { status: string; hint: LocalLifecycleStateHint; precedence: number }>();
    let ignored = 0;
    let recognized = 0;
    for (const hint of hints) {
      const mapped = mapHintState(hint.state);
      if (!mapped) {
        ignored += 1;
        continue;
      }
      recognized += 1;
      const current = strongestByExtension.get(hint.extensionId);
      if (!current || mapped.precedence < current.precedence) {
        strongestByExtension.set(hint.extensionId, { ...mapped, hint });
      }
    }

    for (const [extensionId, mapped] of strongestByExtension) {
      await this.applyStatus(extensionId, mapped.status, mapped.hint);
    }

    return { applied: strongestByExtension.size, ignored: ignored + recognized - strongestByExtension.size };
  }

  private async applyStatus(extensionId: string, status: string, hint: LocalLifecycleStateHint): Promise<void> {
    const now = new Date().toISOString();
    const metadata = JSON.stringify(redactForLog({ serverStateHint: hint.state, message: hint.message, appliedAt: now }));
    await this.db.run(`UPDATE local_extensions SET status = ?, updated_at = ? WHERE extension_id = ?`, [status, now, extensionId]);
    await this.db.run(`UPDATE local_extension_versions SET status = ?, updated_at = ? WHERE extension_id = ?`, [status, now, extensionId]);
    await this.db.run(`UPDATE local_targets SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ?`, [status, metadata, now, extensionId]);
    await this.db.run(`UPDATE mcp_local_installations SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ?`, [status, metadata, now, extensionId]);
    await this.db.run(`UPDATE plugin_local_installations SET status = ?, metadata_json = ?, updated_at = ? WHERE extension_id = ?`, [status, metadata, now, extensionId]);
    await this.markResourceBindings(extensionId, status, metadata, now);
  }

  async recordScanFailure(input: LocalScanFailureRecord): Promise<void> {
    const now = new Date().toISOString();
    const resourceType = input.resourceType ?? LocalResourceTypes.LOCAL_EVENT;
    const sourceId = `scan-failure:${input.code}:${input.path ?? input.target ?? now}`;
    const resourceId = resourceIdFor(resourceType, sourceId);
    const bindingId = bindingIdFor(resourceId, input.target ?? input.path ?? sourceId);
    const metadata = redactForLog({ ...(input.metadata ?? {}), code: input.code, path: input.path, target: input.target }) as Record<string, unknown>;
    await this.upsertResource({
      id: resourceId,
      type: resourceType,
      name: path.basename(input.path ?? input.target ?? input.code),
      displayName: `扫描失败：${path.basename(input.path ?? input.target ?? input.code)}`,
      description: input.message,
      sourceType: input.sourceType ?? LocalResourceSourceTypes.LOCAL_IMPORT,
      sourceId,
      sourcePath: input.path ?? input.target,
      managed: false,
      centralStoreManaged: false,
      nativeDirectoryManaged: false,
      eaManagedFallback: false,
      permissionSummary: createEmptyPermissionSummary('未提取'),
      auditSummary: createNotAuditedSummary('扫描失败，未运行审计'),
      createdAt: now,
      lastScannedAt: now,
      lastEventAt: now,
      metadata
    });
    await this.upsertBinding({
      id: bindingId,
      resourceId,
      resourceType,
      agentId: input.agentId,
      projectId: input.projectId,
      scopeType: ResourceScopeTypes.CUSTOM_PATH,
      scopePath: input.path ?? input.target,
      targetPath: input.target ?? input.path,
      managedMode: ManagedModes.EXTERNAL_DISCOVERY_ONLY,
      writeMode: WriteModes.READ_ONLY,
      detectionStatus: DetectionStatuses.SCAN_FAILED,
      lifecycleStatus: LifecycleStatuses.UNKNOWN,
      pathStatus: PathStatuses.UNKNOWN,
      authStatus: AuthStatuses.UNKNOWN,
      auditStatus: AuditStatuses.NOT_AUDITED,
      driftStatus: DriftStatuses.UNKNOWN,
      operationStatus: input.operationStatus ?? OperationStatuses.FAILURE,
      syncStatus: SyncStatuses.LOCAL_ONLY,
      externalModified: false,
      drifted: false,
      lastEventAt: now,
      metadata,
      updatedAt: now
    });
    await this.recordLocalEvent({
      eventType: LocalEventTypes.CONFIG_SCAN_FAILED,
      resourceId,
      bindingId,
      resourceType,
      agentId: input.agentId,
      projectId: input.projectId,
      status: 'failure',
      message: input.message,
      errorCode: input.code,
      failureReason: input.message,
      suggestion: '修复本地配置文件后重新扫描。',
      syncStatus: SyncStatuses.LOCAL_ONLY,
      createdAt: now,
      metadata
    });
  }

  async recordAgentResource(input: AgentResourceRecord): Promise<void> {
    await this.recordResourceGraph({
      resourceType: input.resourceType,
      sourceId: input.sourceId,
      name: input.name,
      description: input.description,
      version: input.version,
      targetPath: input.targetPath,
      status: input.status,
      sourceType: input.sourceType ?? LocalResourceSourceTypes.NATIVE_AGENT_DIRECTORY,
      managed: input.managed ?? false,
      nativeDirectoryManaged: input.nativeDirectoryManaged ?? true,
      eaManagedFallback: input.eaManagedFallback ?? false,
      metadata: {
        ...(input.metadata ?? {}),
        agentId: input.agentId,
        discoveredBy: 'agent_inventory_scan'
      },
      agentId: input.agentId,
      projectId: input.projectId,
      scopeType: input.scopeType,
      permissionSummary: input.permissionSummary,
      auditSummary: input.auditSummary
    });
  }

  async recordAgentEvent(input: AgentEventRecord): Promise<void> {
    const now = new Date().toISOString();
    const resourceId = input.resourceType && input.sourceId ? resourceIdFor(input.resourceType, input.sourceId) : undefined;
    const bindingId = resourceId && input.targetPath ? bindingIdFor(resourceId, input.targetPath) : undefined;
    await this.recordLocalEvent({
      eventType: input.eventType,
      resourceId,
      bindingId,
      resourceType: input.resourceType,
      agentId: input.agentId,
      projectId: input.projectId,
      status: input.status,
      message: input.message,
      errorCode: input.errorCode,
      failureReason: input.failureReason,
      suggestion: input.suggestion,
      syncStatus: SyncStatuses.LOCAL_ONLY,
      createdAt: now,
      metadata: {
        ...(input.metadata ?? {}),
        targetPath: input.targetPath
      }
    });
  }

  validateProjectRemoval(projectId: string): ProjectRemovalValidation {
    const projectRows = this.db.query<{
      resource_id: string;
      binding_id?: string;
      name: string;
      target_path?: string;
      source_path?: string;
      path_status?: PathStatus;
    }>(
      `SELECT r.id as resource_id, b.id as binding_id, r.display_name as name, b.target_path, r.source_path, b.path_status
       FROM local_resources r
       LEFT JOIN resource_bindings b ON b.resource_id = r.id
       WHERE r.type = ? AND (r.source_id = ? OR b.project_id = ?)
       ORDER BY b.updated_at DESC
       LIMIT 1`,
      [LocalResourceTypes.PROJECT, projectId, projectId]
    );
    const blockers = this.db.query<{
      resource_id: string;
      binding_id?: string;
      resource_type: LocalResourceType;
      display_name: string;
      agent_id?: string;
      kit_id?: string;
      target_path?: string;
      lifecycle_status: LifecycleStatus;
      operation_status: OperationStatus;
    }>(
      `SELECT r.id as resource_id, b.id as binding_id, b.resource_type, r.display_name, b.agent_id, b.kit_id,
              b.target_path, b.lifecycle_status, b.operation_status
       FROM resource_bindings b
       JOIN local_resources r ON r.id = b.resource_id
       WHERE b.project_id = ?
         AND b.resource_type IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         AND b.lifecycle_status NOT IN (?, ?)
       ORDER BY r.display_name ASC`,
      [
        projectId,
        LocalResourceTypes.AGENT_CONFIG,
        LocalResourceTypes.SKILL,
        LocalResourceTypes.MCP_SERVER,
        LocalResourceTypes.PLUGIN,
        LocalResourceTypes.HOOK,
        LocalResourceTypes.CLI_COMMAND,
        LocalResourceTypes.RULE,
        LocalResourceTypes.MEMORY,
        LocalResourceTypes.SUBAGENT,
        LocalResourceTypes.IGNORE_FILE,
        LocalResourceTypes.KIT,
        LifecycleStatuses.REMOVED,
        LifecycleStatuses.UNINSTALLED
      ]
    ).map((row) => ({
      resourceId: row.resource_id,
      bindingId: row.binding_id ?? undefined,
      resourceType: row.resource_type,
      name: row.display_name,
      agentId: row.agent_id ?? undefined,
      kitId: row.kit_id ?? undefined,
      targetPath: row.target_path ?? undefined,
      lifecycleStatus: row.lifecycle_status,
      operationStatus: row.operation_status
    }));
    const project = projectRows[0];
    const exists = Boolean(project);
    return {
      projectId,
      exists,
      allowed: exists && blockers.length === 0,
      blockers,
      projectPath: project?.target_path ?? project?.source_path ?? undefined,
      pathStatus: project?.path_status ?? undefined,
      cleanupGuidance: !exists
        ? '未找到本地项目管理记录；不会生成删除成功结果，也不会触碰真实项目目录。'
        : blockers.length > 0
          ? '请先停用、卸载、解除接入、移除 Kit 应用或清理本地记录；路径不存在时仍需清理关联资源。'
          : '可删除本地项目管理记录；不会删除用户真实项目目录。'
    };
  }

  async removeProjectManagementRecord(input: { projectId: string; operationId?: string; executionId?: string; requestID?: string }): Promise<ProjectRemovalResult> {
    const validation = this.validateProjectRemoval(input.projectId);
    const now = new Date().toISOString();
    const projectResourceId = resourceIdFor(LocalResourceTypes.PROJECT, input.projectId);
    const operationId = input.operationId ?? `project_remove_${randomUUID()}`;
    const executionId = input.executionId ?? `execution_record_${randomUUID()}`;
    const plan = createProjectRemovalPlan({
      planId: operationId,
      projectId: input.projectId,
      projectResourceId,
      validation,
      requestID: input.requestID
    });
    await this.persistExecutionPlan(plan, validation.allowed ? 'planned' : 'blocked', now);
    const projectBinding = this.db.query<{ id: string }>(
      `SELECT id FROM resource_bindings WHERE resource_id = ? OR (project_id = ? AND resource_type = ?) LIMIT 1`,
      [projectResourceId, input.projectId, LocalResourceTypes.PROJECT]
    )[0];
    if (!validation.allowed) {
      const message = validation.exists
        ? '项目仍有关联资源，禁止删除本地项目管理记录。'
        : '未找到本地项目管理记录，无法删除。';
      const errorCode = validation.exists ? 'project_has_associated_resources' : 'project_record_not_found';
      await this.persistExecutionRecord(executionId, operationId, 'blocked', {
        operation: 'project.remove-record',
        surface: 'projects',
        status: 'blocked',
        planId: operationId,
        executionId,
        validation,
        message,
        failureReason: validation.cleanupGuidance,
        suggestion: validation.cleanupGuidance
      }, now);
      const eventId = await this.recordLocalEvent({
        eventType: LocalEventTypes.PROJECT_RECORD_REMOVAL_BLOCKED,
        operationId,
        executionId,
        resourceId: projectResourceId,
        bindingId: projectBinding?.id,
        resourceType: LocalResourceTypes.PROJECT,
        projectId: input.projectId,
        status: 'failure',
        message,
        errorCode,
        failureReason: validation.cleanupGuidance,
        suggestion: validation.cleanupGuidance,
        syncStatus: SyncStatuses.PENDING_SYNC,
        createdAt: now,
        metadata: { blockers: validation.blockers, requestID: input.requestID }
      });
      return { validation, removed: false, planId: operationId, executionId, eventId };
    }

    try {
      const successResult = {
        operation: 'project.remove-record',
        surface: 'projects',
        status: 'success',
        planId: operationId,
        executionId,
        validation,
        message: '已删除本地项目管理记录，未删除真实项目目录。'
      };
      await this.db.transaction((tx) => {
        tx.run(`DELETE FROM local_projects WHERE project_id = ?`, [input.projectId]);
        tx.run(`DELETE FROM resource_bindings WHERE resource_id = ? AND resource_type = ?`, [projectResourceId, LocalResourceTypes.PROJECT]);
        tx.run(`DELETE FROM local_resources WHERE id = ? AND type = ?`, [projectResourceId, LocalResourceTypes.PROJECT]);
        tx.run(
          `INSERT OR REPLACE INTO execution_records(id, plan_id, status, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [executionId, operationId, 'success', JSON.stringify(redactForLog(successResult)), now, now]
        );
        tx.run(`UPDATE execution_plans SET status = ?, updated_at = ? WHERE id = ?`, ['success', new Date().toISOString(), operationId]);
      });
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : 'Project removal failed';
      await this.persistExecutionRecord(executionId, operationId, 'failure', {
        operation: 'project.remove-record',
        surface: 'projects',
        status: 'failure',
        planId: operationId,
        executionId,
        validation,
        message: '删除本地项目管理记录失败。',
        failureReason
      }, now);
      await this.updateExecutionPlanStatus(operationId, 'failure');
      await this.recordLocalEvent({
        eventType: LocalEventTypes.PROJECT_RECORD_REMOVAL_BLOCKED,
        operationId,
        executionId,
        resourceId: projectResourceId,
        bindingId: projectBinding?.id,
        resourceType: LocalResourceTypes.PROJECT,
        projectId: input.projectId,
        status: 'failure',
        message: '删除本地项目管理记录失败。',
        errorCode: error instanceof Error ? error.name : 'project_record_removal_failed',
        failureReason,
        suggestion: '查看执行记录并重试；不要手工删除真实项目目录。',
        syncStatus: SyncStatuses.PENDING_SYNC,
        createdAt: now,
        metadata: { projectPath: validation.projectPath, requestID: input.requestID }
      });
      throw error;
    }
    const eventId = await this.recordLocalEvent({
      eventType: LocalEventTypes.PROJECT_RECORD_REMOVED,
      operationId,
      executionId,
      resourceId: projectResourceId,
      bindingId: projectBinding?.id,
      resourceType: LocalResourceTypes.PROJECT,
      projectId: input.projectId,
      status: 'success',
      message: '已删除本地项目管理记录，未删除真实项目目录。',
      suggestion: validation.cleanupGuidance,
      syncStatus: SyncStatuses.PENDING_SYNC,
      createdAt: now,
      metadata: { projectPath: validation.projectPath, requestID: input.requestID }
    });
    return { validation, removed: true, planId: operationId, executionId, eventId };
  }

  async recordKitManifest(input: {
    manifest: KitManifest;
    status?: string;
    sourcePath?: string;
    managed?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<{ resourceId: string }> {
    const status = input.status ?? 'metadata_refresh';
    await this.recordResourceGraph({
      resourceType: LocalResourceTypes.KIT,
      sourceId: input.manifest.kitId,
      name: input.manifest.name,
      description: input.manifest.description,
      version: input.manifest.version,
      targetPath: input.sourcePath,
      status,
      sourceType: sourceTypeFromKitManifest(input.manifest),
      managed: input.managed ?? true,
      metadata: {
        ...(input.metadata ?? {}),
        kitManifest: input.manifest,
        kitApplicationStatus: 'UNAPPLIED',
        manifestVersion: input.manifest.version
      },
      permissionSummary: input.manifest.permissionSummary,
      auditSummary: input.manifest.auditSummary
    });
    return { resourceId: resourceIdFor(LocalResourceTypes.KIT, input.manifest.kitId) };
  }

  async recordKitApplicationBinding(input: {
    manifest: KitManifest;
    applicationId: string;
    target: KitApplicationTargetRecord;
    status: string;
    operationId?: string;
    executionId?: string;
    resourceResults?: unknown[];
    metadata?: Record<string, unknown>;
  }): Promise<KitBindingRecordResult> {
    await this.recordKitManifest({
      manifest: input.manifest,
      status: input.status,
      metadata: {
        ...(input.metadata ?? {}),
        kitApplicationStatus: input.status,
        kitApplicationId: input.applicationId,
        target: input.target,
        resourceResults: input.resourceResults
      }
    });
    return this.upsertExistingResourceBinding({
      resourceId: resourceIdFor(LocalResourceTypes.KIT, input.manifest.kitId),
      resourceType: LocalResourceTypes.KIT,
      target: input.target,
      status: input.status,
      kitId: input.manifest.kitId,
      metadata: {
        ...(input.metadata ?? {}),
        managedByKitId: input.manifest.kitId,
        kitApplicationId: input.applicationId,
        kitVersion: input.manifest.version,
        kitApplicationStatus: input.status,
        operationId: input.operationId,
        executionId: input.executionId,
        resourceResults: input.resourceResults
      }
    });
  }

  async recordKitManagedResourceBinding(input: {
    manifest: KitManifest;
    resourceRef: KitResourceRef;
    resourceId: string;
    applicationId: string;
    target: KitApplicationTargetRecord;
    status: string;
    operationId?: string;
    executionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<KitBindingRecordResult | undefined> {
    const resource = this.db.query<{ id: string; type: LocalResourceType }>(
      `SELECT id, type FROM local_resources WHERE id = ? LIMIT 1`,
      [input.resourceId]
    )[0];
    if (!resource) return undefined;
    return this.upsertExistingResourceBinding({
      resourceId: resource.id,
      resourceType: resource.type,
      target: input.target,
      status: input.status,
      kitId: input.manifest.kitId,
      targetPath: input.resourceRef.targetPath ?? input.target.targetPath ?? input.target.scopePath,
      metadata: {
        ...(input.metadata ?? {}),
        managedByKitId: input.manifest.kitId,
        kitApplicationId: input.applicationId,
        kitVersion: input.manifest.version,
        kitResourceRefId: input.resourceRef.refId,
        operationId: input.operationId,
        executionId: input.executionId
      }
    });
  }

  async removeKitApplication(input: { kitId: string; applicationId?: string; operationId?: string; executionId?: string }): Promise<RemovedKitBindingRecord[]> {
    const candidates = this.db.query<{
      id: string;
      resource_id: string;
      resource_type: LocalResourceType;
      agent_id?: string;
      project_id?: string;
      target_path?: string;
      metadata_json: string;
    }>(
      `SELECT id, resource_id, resource_type, agent_id, project_id, target_path, metadata_json
       FROM resource_bindings
       WHERE kit_id = ? OR metadata_json LIKE ?`,
      [input.kitId, `%${input.kitId}%`]
    );
    const removable = candidates.filter((binding) => {
      const metadata = safeParseObject(binding.metadata_json);
      if (metadata.managedByKitId !== input.kitId && metadata.kitId !== input.kitId) return false;
      if (input.applicationId && metadata.kitApplicationId !== input.applicationId) return false;
      return true;
    });
    const removed: RemovedKitBindingRecord[] = [];
    for (const binding of removable) {
      const record = await this.removeKitManagedBinding({ kitId: input.kitId, applicationId: input.applicationId, bindingId: binding.id, operationId: input.operationId, executionId: input.executionId });
      if (record) removed.push(record);
    }
    return removed;
  }

  async removeKitManagedBinding(input: { kitId: string; bindingId: string; applicationId?: string; operationId?: string; executionId?: string }): Promise<RemovedKitBindingRecord | undefined> {
    const binding = this.db.query<{
      id: string;
      resource_id: string;
      resource_type: LocalResourceType;
      agent_id?: string;
      project_id?: string;
      target_path?: string;
      metadata_json: string;
    }>(
      `SELECT id, resource_id, resource_type, agent_id, project_id, target_path, metadata_json
       FROM resource_bindings
       WHERE id = ?
       LIMIT 1`,
      [input.bindingId]
    )[0];
    if (!binding) return undefined;
    const metadata = safeParseObject(binding.metadata_json);
    if (metadata.managedByKitId !== input.kitId && metadata.kitId !== input.kitId) return undefined;
    if (input.applicationId && metadata.kitApplicationId !== input.applicationId) return undefined;
    await this.db.run(`DELETE FROM resource_bindings WHERE id = ?`, [binding.id]);
    return {
      resourceId: binding.resource_id,
      bindingId: binding.id,
      resourceType: binding.resource_type,
      agentId: binding.agent_id ?? undefined,
      projectId: binding.project_id ?? undefined,
      targetPath: binding.target_path ?? undefined
    };
  }

  private async upsertExistingResourceBinding(input: {
    resourceId: string;
    resourceType: LocalResourceType;
    target: KitApplicationTargetRecord;
    status: string;
    kitId: string;
    targetPath?: string;
    metadata: Record<string, unknown>;
  }): Promise<KitBindingRecordResult> {
    const now = new Date().toISOString();
    const targetKey = input.targetPath
      ?? input.target.targetPath
      ?? input.target.scopePath
      ?? input.target.projectId
      ?? input.target.agentId
      ?? input.kitId;
    const bindingId = bindingIdFor(input.resourceId, `${input.kitId}:${targetKey}`);
    const binding = await this.createBinding({
      bindingId,
      resourceId: input.resourceId,
      resourceType: input.resourceType,
      targetPath: input.targetPath ?? input.target.targetPath ?? input.target.scopePath,
      status: input.status,
      metadata: input.metadata,
      projectId: input.target.projectId,
      agentId: input.target.agentId,
      kitId: input.kitId,
      scopeType: input.target.scopeType,
      now
    });
    binding.scopePath = input.target.scopePath ?? input.target.projectId ?? input.target.agentId ?? input.kitId;
    await this.upsertBinding(binding);
    return { resourceId: input.resourceId, bindingId, resourceType: input.resourceType };
  }

  private async recordResourceBindingForKnownTarget(input: { extensionId: string; target: string; status: string; metadata?: Record<string, unknown>; now: string }): Promise<void> {
    const resource = this.db.query<{ id: string; type: LocalResourceType }>(
      `SELECT id, type FROM local_resources WHERE source_id = ? ORDER BY created_at DESC LIMIT 1`,
      [input.extensionId]
    )[0];
    if (!resource) return;
    await this.recordResourceGraph({
      resourceType: resource.type,
      sourceId: input.extensionId,
      name: input.extensionId,
      targetPath: input.target,
      status: input.status,
      sourceType: inferSourceType(input.metadata, input.target),
      managed: Boolean(input.metadata?.managed),
      metadata: input.metadata ?? {},
      now: input.now
    });
  }

  private async recordResourceGraph(input: {
    resourceType: LocalResourceType;
    sourceId: string;
    name: string;
    description?: string;
    version?: string;
    latestVersion?: string;
    sha256?: string;
    packageHash?: string;
    targetPath?: string;
    status: string;
    sourceType: LocalResourceSourceType;
    managed: boolean;
    centralStoreManaged?: boolean;
    nativeDirectoryManaged?: boolean;
    eaManagedFallback?: boolean;
    metadata?: Record<string, unknown>;
    projectId?: string;
    agentId?: string;
    kitId?: string;
    scopeType?: ResourceScopeType;
    permissionSummary?: PermissionSummary;
    auditSummary?: AuditSummary;
    now?: string;
  }): Promise<void> {
    const now = input.now ?? new Date().toISOString();
    const resourceId = resourceIdFor(input.resourceType, input.sourceId);
    const metadata = redactForLog(input.metadata ?? {}) as Record<string, unknown>;
    const auditStatus = mapAuditStatus(input.status);
    await this.upsertResource({
      id: resourceId,
      type: input.resourceType,
      name: input.name,
      displayName: input.name,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourcePath: input.targetPath,
      version: input.version,
      latestVersion: input.latestVersion,
      sha256: input.sha256,
      packageHash: input.packageHash,
      managed: input.managed,
      centralStoreManaged: Boolean(input.centralStoreManaged),
      nativeDirectoryManaged: Boolean(input.nativeDirectoryManaged),
      eaManagedFallback: Boolean(input.eaManagedFallback),
      permissionSummary: input.permissionSummary ?? createEmptyPermissionSummary(permissionLabelFromResourceType(input.resourceType)),
      auditSummary: input.auditSummary ?? (auditStatus === AuditStatuses.NOT_AUDITED
        ? createNotAuditedSummary()
        : { ...createNotAuditedSummary(), status: auditStatus, message: '来自服务端或本地状态的风险标记' }),
      createdAt: now,
      lastScannedAt: now,
      metadata
    });

    const targetKey = input.targetPath ?? input.projectId ?? input.agentId ?? input.kitId;
    if (!targetKey) return;

    const bindingId = bindingIdFor(resourceId, targetKey);
    const binding = await this.createBinding({
      bindingId,
      resourceId,
      resourceType: input.resourceType,
      targetPath: input.targetPath,
      status: input.status,
      metadata,
      projectId: input.projectId,
      agentId: input.agentId ?? inferAgentId(input.metadata, input.targetPath),
      kitId: input.kitId,
      scopeType: input.scopeType,
      now
    });
    const file = await this.createFileBackedResource(resourceId, bindingId, input.targetPath, metadata, now);
    if (file?.drifted) {
      binding.driftStatus = DriftStatuses.HASH_CHANGED;
      binding.externalModified = true;
      binding.drifted = true;
      binding.lastKnownHash = file.lastKnownHash;
      binding.currentHash = file.currentHash;
    }
    await this.upsertBinding(binding);
    if (file) await this.upsertFileBackedResource(file);
  }

  private async createBinding(input: {
    bindingId: string;
    resourceId: string;
    resourceType: LocalResourceType;
    targetPath?: string;
    status: string;
    metadata: Record<string, unknown>;
    projectId?: string;
    agentId?: string;
    kitId?: string;
    scopeType?: ResourceScopeType;
    now: string;
  }): Promise<ResourceBinding> {
    return {
      id: input.bindingId,
      resourceId: input.resourceId,
      resourceType: input.resourceType,
      agentId: input.agentId,
      projectId: input.projectId,
      kitId: input.kitId,
      scopeType: input.scopeType ?? defaultScopeType(input),
      scopePath: input.projectId ?? input.targetPath,
      targetPath: input.targetPath,
      managedMode: managedModeFromMetadata(input.metadata, input.status),
      writeMode: writeModeFromResourceType(input.resourceType),
      detectionStatus: mapDetectionStatus(input.status),
      lifecycleStatus: mapLifecycleStatus(input.status),
      pathStatus: await pathStatusForTarget(input.targetPath),
      authStatus: mapAuthStatus(input.status),
      auditStatus: mapAuditStatus(input.status),
      driftStatus: DriftStatuses.UNKNOWN,
      operationStatus: mapOperationStatus(input.status),
      syncStatus: SyncStatuses.LOCAL_ONLY,
      externalModified: false,
      drifted: false,
      metadata: input.metadata,
      updatedAt: input.now
    };
  }

  private async createFileBackedResource(
    resourceId: string,
    bindingId: string,
    targetPath: string | undefined,
    metadata: Record<string, unknown>,
    now: string
  ): Promise<FileBackedResource | undefined> {
    if (!targetPath || !isLikelyPath(targetPath)) return undefined;
    try {
      const targetStat = await stat(targetPath);
      const isFile = targetStat.isFile();
      const fileBytes = isFile ? await readFile(targetPath) : undefined;
      const hash = fileBytes ? sha256(fileBytes) : sha256(`${targetPath}:${targetStat.mtimeMs}:${targetStat.size}`);
      const existing = this.db.query<{ last_known_hash: string; current_hash?: string }>(
        `SELECT last_known_hash, current_hash
         FROM file_backed_resources
         WHERE binding_id = ? AND path = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [bindingId, targetPath]
      )[0];
      const previousHash = existing?.current_hash ?? existing?.last_known_hash;
      const drifted = Boolean(previousHash && previousHash !== hash);
      return {
        resourceId,
        bindingId,
        path: targetPath,
        contentType: isFile ? contentTypeFromPath(targetPath) : 'unknown',
        size: targetStat.size,
        lastKnownMtime: targetStat.mtime.toISOString(),
        lastKnownSize: targetStat.size,
        lastKnownHash: previousHash ?? hash,
        currentHash: hash,
        externalModified: drifted,
        drifted,
        previewAvailable: isFile && previewableFile(targetPath, targetStat.size),
        metadata
      };
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  private async upsertResource(resource: LocalResource): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO local_resources(
        id, type, name, display_name, description, source_type, source_id, source_path,
        version, latest_version, sha256, package_hash, managed, central_store_managed,
        native_directory_managed, ea_managed_fallback, permission_summary_json, audit_summary_json,
        metadata_json, created_at, last_scanned_at, last_modified_at, last_event_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resource.id,
        resource.type,
        resource.name,
        resource.displayName,
        resource.description ?? null,
        resource.sourceType,
        resource.sourceId ?? null,
        resource.sourcePath ?? null,
        resource.version ?? null,
        resource.latestVersion ?? null,
        resource.sha256 ?? null,
        resource.packageHash ?? null,
        resource.managed ? 1 : 0,
        resource.centralStoreManaged ? 1 : 0,
        resource.nativeDirectoryManaged ? 1 : 0,
        resource.eaManagedFallback ? 1 : 0,
        JSON.stringify(redactForLog(resource.permissionSummary)),
        JSON.stringify(redactForLog(resource.auditSummary)),
        JSON.stringify(redactForLog(resource.metadata)),
        resource.createdAt,
        resource.lastScannedAt ?? null,
        resource.lastModifiedAt ?? null,
        resource.lastEventAt ?? null
      ]
    );
  }

  private upsertLegacyResourceGraph(input: {
    resourceType: LocalResourceType;
    sourceId: string;
    name: string;
    description?: string;
    version?: string;
    packageHash?: string;
    targetPath?: string;
    status: string;
    sourceType: LocalResourceSourceType;
    managed: boolean;
    centralStoreManaged?: boolean;
    nativeDirectoryManaged?: boolean;
    metadata?: Record<string, unknown>;
    projectId?: string;
    agentId?: string;
    kitId?: string;
    scopeType?: ResourceScopeType;
    bindingKey?: string;
    createBinding?: boolean;
    createdAt?: string;
    updatedAt?: string;
  }): void {
    const createdAt = input.createdAt ?? input.updatedAt ?? new Date().toISOString();
    const updatedAt = input.updatedAt ?? createdAt;
    const resourceId = resourceIdFor(input.resourceType, input.sourceId);
    const metadata = redactForLog({ ...(input.metadata ?? {}), legacyBackfill: true }) as Record<string, unknown>;
    const auditStatus = mapAuditStatus(input.status);
    const resourceExists = Number(this.db.query<{ count: number }>('SELECT COUNT(*) as count FROM local_resources WHERE id = ?', [resourceId])[0]?.count ?? 0) > 0;
    if (!resourceExists) {
      this.db.runSync(
        `INSERT INTO local_resources(
          id, type, name, display_name, description, source_type, source_id, source_path,
          version, latest_version, sha256, package_hash, managed, central_store_managed,
          native_directory_managed, ea_managed_fallback, permission_summary_json, audit_summary_json,
          metadata_json, created_at, last_scanned_at, last_modified_at, last_event_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          resourceId,
          input.resourceType,
          input.name,
          input.name,
          input.description ?? null,
          input.sourceType,
          input.sourceId,
          input.targetPath ?? null,
          input.version ?? null,
          input.packageHash ?? null,
          input.managed ? 1 : 0,
          input.centralStoreManaged ? 1 : 0,
          input.nativeDirectoryManaged ? 1 : 0,
          JSON.stringify(redactForLog(createEmptyPermissionSummary(permissionLabelFromResourceType(input.resourceType)))),
          JSON.stringify(redactForLog(auditStatus === AuditStatuses.NOT_AUDITED
            ? createNotAuditedSummary()
            : { ...createNotAuditedSummary(), status: auditStatus, message: '来自旧本地表状态的风险标记' })),
          JSON.stringify(metadata),
          createdAt,
          updatedAt
        ]
      );
    }

    if (input.createBinding === false) return;
    const targetKey = input.bindingKey ?? input.targetPath ?? input.projectId ?? input.agentId ?? input.kitId ?? input.sourceId;
    const bindingId = bindingIdFor(resourceId, targetKey);
    const bindingExists = Number(this.db.query<{ count: number }>('SELECT COUNT(*) as count FROM resource_bindings WHERE id = ?', [bindingId])[0]?.count ?? 0) > 0;
    if (bindingExists) return;
    const inferredAgentId = input.agentId ?? inferAgentId(metadata, input.targetPath);
    const scopeType = input.scopeType ?? defaultScopeType({
      agentId: inferredAgentId,
      projectId: input.projectId,
      kitId: input.kitId,
      targetPath: input.targetPath
    });
    this.db.runSync(
      `INSERT OR REPLACE INTO resource_bindings(
        id, resource_id, resource_type, agent_id, project_id, kit_id, scope_type, scope_path,
        target_path, managed_mode, write_mode, detection_status, lifecycle_status, path_status,
        auth_status, audit_status, drift_status, operation_status, sync_status, external_modified,
        drifted, metadata_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [
        bindingId,
        resourceId,
        input.resourceType,
        inferredAgentId ?? null,
        input.projectId ?? null,
        input.kitId ?? null,
        scopeType,
        input.projectId ?? input.targetPath ?? input.sourceId,
        input.targetPath ?? null,
        managedModeFromMetadata(metadata, input.status),
        writeModeFromResourceType(input.resourceType),
        mapDetectionStatus(input.status),
        mapLifecycleStatus(input.status),
        PathStatuses.UNKNOWN,
        mapAuthStatus(input.status),
        mapAuditStatus(input.status),
        DriftStatuses.UNKNOWN,
        mapOperationStatus(input.status),
        SyncStatuses.LOCAL_ONLY,
        JSON.stringify(redactForLog(metadata)),
        updatedAt
      ]
    );
  }

  private async upsertBinding(binding: ResourceBinding): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO resource_bindings(
        id, resource_id, resource_type, agent_id, project_id, kit_id, scope_type, scope_path,
        target_path, managed_mode, write_mode, detection_status, lifecycle_status, path_status,
        auth_status, audit_status, drift_status, operation_status, sync_status, last_known_hash,
        current_hash, external_modified, drifted, backup_snapshot_id, last_execution_id,
        last_event_at, metadata_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        binding.id,
        binding.resourceId,
        binding.resourceType,
        binding.agentId ?? null,
        binding.projectId ?? null,
        binding.kitId ?? null,
        binding.scopeType,
        binding.scopePath ?? null,
        binding.targetPath ?? null,
        binding.managedMode,
        binding.writeMode,
        binding.detectionStatus,
        binding.lifecycleStatus,
        binding.pathStatus,
        binding.authStatus,
        binding.auditStatus,
        binding.driftStatus,
        binding.operationStatus,
        binding.syncStatus,
        binding.lastKnownHash ?? null,
        binding.currentHash ?? null,
        binding.externalModified ? 1 : 0,
        binding.drifted ? 1 : 0,
        binding.backupSnapshotId ?? null,
        binding.lastExecutionId ?? null,
        binding.lastEventAt ?? null,
        JSON.stringify(redactForLog(binding.metadata)),
        binding.updatedAt ?? new Date().toISOString()
      ]
    );
  }

  private async upsertFileBackedResource(file: FileBackedResource): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO file_backed_resources(
        id, resource_id, binding_id, path, content_type, size, last_known_mtime,
        last_known_size, last_known_hash, current_hash, last_managed_hash, external_modified,
        drifted, preview_available, backup_snapshot_id, metadata_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        fileIdFor(file.resourceId, file.bindingId, file.path),
        file.resourceId,
        file.bindingId,
        file.path,
        file.contentType,
        file.size,
        file.lastKnownMtime,
        file.lastKnownSize,
        file.lastKnownHash,
        file.currentHash ?? null,
        file.lastManagedHash ?? null,
        file.externalModified ? 1 : 0,
        file.drifted ? 1 : 0,
        file.previewAvailable ? 1 : 0,
        file.backupSnapshotId ?? null,
        JSON.stringify(redactForLog(file.metadata ?? {}))
      ]
    );
  }

  private async persistExecutionPlan(plan: ExecutionPlan, status: string, now: string): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO execution_plans(id, status, plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [plan.planId, status, JSON.stringify(redactForLog(plan)), now, now]
    );
  }

  private async updateExecutionPlanStatus(planId: string, status: string): Promise<void> {
    await this.db.run(`UPDATE execution_plans SET status = ?, updated_at = ? WHERE id = ?`, [status, new Date().toISOString(), planId]);
  }

  private async persistExecutionRecord(executionId: string, planId: string, status: string, result: Record<string, unknown>, now: string): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO execution_records(id, plan_id, status, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [executionId, planId, status, JSON.stringify(redactForLog(result)), now, now]
    );
  }

  private async recordLocalEvent(input: {
    eventType: LocalEventType;
    operationId?: string;
    executionId?: string;
    resourceId?: string;
    bindingId?: string;
    resourceType?: LocalResourceType;
    agentId?: string;
    projectId?: string;
    kitId?: string;
    status: LocalEventStatus;
    message: string;
    errorCode?: string;
    failureReason?: string;
    suggestion?: string;
    syncStatus: SyncStatus;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const idempotencyKey = `local:${input.eventType}:${input.operationId ?? 'none'}:${input.resourceId ?? 'none'}:${input.bindingId ?? 'none'}:${input.errorCode ?? 'info'}`;
    const queued = await this.eventQueue.enqueue({
      idempotencyKey,
      deviceID: 'local-inventory-scanner',
      eventType: input.eventType,
      operationID: input.operationId,
      executionID: input.executionId,
      resourceID: input.resourceId,
      bindingID: input.bindingId,
      resourceType: input.resourceType,
      agentID: input.agentId,
      projectID: input.projectId,
      kitID: input.kitId,
      result: input.status,
      errorCode: input.errorCode,
      failureReason: input.failureReason,
      suggestion: input.suggestion,
      offlineCreated: true,
      syncStatus: input.syncStatus,
      status: localQueueStatusFor(input.syncStatus),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      payload: { ...(input.metadata ?? {}), message: input.message }
    });
    return queued.id;
  }

  private async markResourceBindings(extensionId: string, status: string, metadataJson: string, now: string, target?: string): Promise<void> {
    const metadata = safeParseObject(metadataJson);
    const fields = [
      mapDetectionStatus(status),
      mapLifecycleStatus(status),
      mapAuthStatus(status),
      mapAuditStatus(status),
      mapOperationStatus(status),
      JSON.stringify(redactForLog(metadata)),
      now,
      extensionId
    ];
    if (target) {
      await this.db.run(
        `UPDATE resource_bindings
         SET detection_status = ?, lifecycle_status = ?, auth_status = ?, audit_status = ?,
             operation_status = ?, metadata_json = ?, updated_at = ?
         WHERE resource_id IN (SELECT id FROM local_resources WHERE source_id = ?) AND target_path = ?`,
        [...fields, target]
      );
      return;
    }
    await this.db.run(
      `UPDATE resource_bindings
       SET detection_status = ?, lifecycle_status = ?, auth_status = ?, audit_status = ?,
           operation_status = ?, metadata_json = ?, updated_at = ?
       WHERE resource_id IN (SELECT id FROM local_resources WHERE source_id = ?)`,
      fields
    );
  }
}

interface ResourceRow {
  id: string;
  type: LocalResourceType;
  name: string;
  display_name: string;
  description?: string;
  source_type: LocalResourceSourceType;
  source_id?: string;
  source_path?: string;
  version?: string;
  latest_version?: string;
  sha256?: string;
  package_hash?: string;
  managed: number;
  central_store_managed: number;
  native_directory_managed: number;
  ea_managed_fallback: number;
  permission_summary_json: string;
  audit_summary_json: string;
  metadata_json: string;
  created_at: string;
  last_scanned_at?: string;
  last_modified_at?: string;
  last_event_at?: string;
}

async function staticAuditContentForRow(row: LocalResourceRow): Promise<string> {
  const targetPath = row.binding?.targetPath ?? row.resource.sourcePath;
  if (targetPath && isLikelyPath(targetPath)) {
    try {
      const targetStat = await stat(targetPath);
      if (targetStat.isFile() && previewableFile(targetPath, targetStat.size)) {
        return await readFile(targetPath, 'utf8');
      }
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  return JSON.stringify(redactForLog({
    resource: {
      id: row.resource.id,
      type: row.resource.type,
      sourceType: row.resource.sourceType,
      sourceId: row.resource.sourceId,
      sourcePath: row.resource.sourcePath,
      permissionSummary: row.resource.permissionSummary,
      metadata: row.resource.metadata
    },
    binding: row.binding ? {
      id: row.binding.id,
      agentId: row.binding.agentId,
      projectId: row.binding.projectId,
      kitId: row.binding.kitId,
      scopeType: row.binding.scopeType,
      targetPath: row.binding.targetPath,
      pathStatus: row.binding.pathStatus,
      authStatus: row.binding.authStatus,
      driftStatus: row.binding.driftStatus,
      metadata: row.binding.metadata
    } : undefined,
    files: row.files.map((file) => ({
      path: file.path,
      contentType: file.contentType,
      size: file.size,
      drifted: file.drifted,
      previewAvailable: file.previewAvailable
    }))
  }), null, 2);
}

function errorCodeForAudit(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  if (error instanceof Error) return error.name;
  return 'static_audit_failed';
}

interface BindingRow {
  id: string;
  resource_id: string;
  resource_type: LocalResourceType;
  agent_id?: string;
  project_id?: string;
  kit_id?: string;
  scope_type: ResourceScopeType;
  scope_path?: string;
  target_path?: string;
  managed_mode: ManagedMode;
  write_mode: WriteMode;
  detection_status: DetectionStatus;
  lifecycle_status: LifecycleStatus;
  path_status: PathStatus;
  auth_status: AuthStatus;
  audit_status: AuditStatus;
  drift_status: DriftStatus;
  operation_status: OperationStatus;
  sync_status: SyncStatus;
  last_known_hash?: string;
  current_hash?: string;
  external_modified: number;
  drifted: number;
  backup_snapshot_id?: string;
  last_execution_id?: string;
  last_event_at?: string;
  metadata_json: string;
  updated_at?: string;
}

interface FileRow {
  resource_id: string;
  binding_id: string;
  path: string;
  content_type: FileBackedResource['contentType'];
  size: number;
  last_known_mtime: string;
  last_known_size: number;
  last_known_hash: string;
  current_hash?: string;
  last_managed_hash?: string;
  external_modified: number;
  drifted: number;
  preview_available: number;
  backup_snapshot_id?: string;
  metadata_json: string;
}

interface EventRow {
  id: string;
  idempotency_key: string;
  event_type: string;
  operation_id?: string;
  execution_id?: string;
  resource_id?: string;
  binding_id?: string;
  resource_type?: LocalResourceType;
  agent_id?: string;
  project_id?: string;
  kit_id?: string;
  result?: string;
  status?: string;
  error_code?: string;
  failure_reason?: string;
  suggestion?: string;
  offline_created?: number;
  sync_status?: SyncStatus;
  server_ack_status?: 'accepted' | 'rejected' | 'ignored';
  payload_json: string;
  created_at: string;
  synced_at?: string;
}

interface AuditFindingRow {
  id: string;
  run_id: string;
  rule_id: string;
  harness_rule_id?: string;
  resource_id: string;
  binding_id?: string;
  resource_type: LocalResourceType;
  agent_id?: string;
  project_id?: string;
  kit_id?: string;
  severity: AuditSeverity;
  audit_status: AuditStatus;
  trust_score_impact: number;
  permission_category: PermissionCategory;
  path?: string;
  line_start?: number;
  line_end?: number;
  snippet_hash?: string;
  path_summary?: string;
  title: string;
  description: string;
  impact_scope_json: string;
  remediation: string;
  related_event_ids_json: string;
  metadata_json: string;
  detected_at: string;
  resolved_at?: string;
  blocker?: number;
}

interface LegacyVersionRow {
  extensionId: string;
  version?: string;
  packageSha256?: string;
  status?: string;
  updatedAt?: string;
}

interface LegacyTargetRow {
  extensionId: string;
  target: string;
  status: string;
  metadataJson?: string;
  updatedAt?: string;
}

interface LegacyExtensionRow {
  extensionId: string;
  name?: string;
  summary?: string;
  visibility?: string;
  status?: string;
  cachedAt?: string;
  updatedAt?: string;
}

interface LegacyMcpRow {
  id: string;
  extensionId?: string;
  target: string;
  status: string;
  configPath?: string;
  secureRef?: string;
  metadataJson?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface LegacyPluginRow {
  id: string;
  extensionId?: string;
  target: string;
  status: string;
  adapterId?: string;
  metadataJson?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface LegacyToolRow {
  extensionId: string;
  target: string;
  toolName: string;
  status: string;
  metadataJson?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface LegacyProjectRow {
  projectId: string;
  name: string;
  extensionId?: string;
  status: string;
  metadataJson?: string;
  createdAt?: string;
  updatedAt?: string;
}

function mapResourceRow(row: ResourceRow): LocalResource {
  const permissionSummary = safeParseObject(row.permission_summary_json) as Partial<PermissionSummary>;
  const auditSummary = safeParseObject(row.audit_summary_json);
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    displayName: row.display_name,
    description: row.description ?? undefined,
    sourceType: row.source_type,
    sourceId: row.source_id ?? undefined,
    sourcePath: row.source_path ?? undefined,
    version: row.version ?? undefined,
    latestVersion: row.latest_version ?? undefined,
    sha256: row.sha256 ?? undefined,
    packageHash: row.package_hash ?? undefined,
    managed: row.managed === 1,
    centralStoreManaged: row.central_store_managed === 1,
    nativeDirectoryManaged: row.native_directory_managed === 1,
    eaManagedFallback: row.ea_managed_fallback === 1,
    permissionSummary: {
      ...createEmptyPermissionSummary(),
      ...permissionSummary,
      categories: Array.isArray(permissionSummary.categories) ? permissionSummary.categories : [],
      items: Array.isArray(permissionSummary.items) ? permissionSummary.items : [],
      details: Array.isArray(permissionSummary.details) ? permissionSummary.details : []
    },
    auditSummary: {
      ...createNotAuditedSummary(),
      ...(auditSummary && typeof auditSummary === 'object' && !Array.isArray(auditSummary) ? auditSummary : {})
    } as LocalResource['auditSummary'],
    createdAt: row.created_at,
    lastScannedAt: row.last_scanned_at ?? undefined,
    lastModifiedAt: row.last_modified_at ?? undefined,
    lastEventAt: row.last_event_at ?? undefined,
    metadata: safeParseObject(row.metadata_json)
  };
}

function mapBindingRow(row: BindingRow): ResourceBinding {
  return {
    id: row.id,
    resourceId: row.resource_id,
    resourceType: row.resource_type,
    agentId: row.agent_id ?? undefined,
    projectId: row.project_id ?? undefined,
    kitId: row.kit_id ?? undefined,
    scopeType: row.scope_type,
    scopePath: row.scope_path ?? undefined,
    targetPath: row.target_path ?? undefined,
    managedMode: row.managed_mode,
    writeMode: row.write_mode,
    detectionStatus: row.detection_status,
    lifecycleStatus: row.lifecycle_status,
    pathStatus: row.path_status,
    authStatus: row.auth_status,
    auditStatus: row.audit_status,
    driftStatus: row.drift_status,
    operationStatus: row.operation_status,
    syncStatus: row.sync_status,
    lastKnownHash: row.last_known_hash ?? undefined,
    currentHash: row.current_hash ?? undefined,
    externalModified: row.external_modified === 1,
    drifted: row.drifted === 1,
    backupSnapshotId: row.backup_snapshot_id ?? undefined,
    lastExecutionId: row.last_execution_id ?? undefined,
    lastEventAt: row.last_event_at ?? undefined,
    metadata: safeParseObject(row.metadata_json),
    updatedAt: row.updated_at ?? undefined
  };
}

function mapFileRow(row: FileRow): FileBackedResource {
  return {
    resourceId: row.resource_id,
    bindingId: row.binding_id,
    path: row.path,
    contentType: row.content_type,
    size: row.size,
    lastKnownMtime: row.last_known_mtime,
    lastKnownSize: row.last_known_size,
    lastKnownHash: row.last_known_hash,
    currentHash: row.current_hash ?? undefined,
    lastManagedHash: row.last_managed_hash ?? undefined,
    externalModified: row.external_modified === 1,
    drifted: row.drifted === 1,
    previewAvailable: row.preview_available === 1,
    backupSnapshotId: row.backup_snapshot_id ?? undefined,
    metadata: safeParseObject(row.metadata_json)
  };
}

function mapEventRow(row: EventRow): LocalEventRecord {
  const metadata = safeParseObject(row.payload_json);
  const message = stringValue(metadata.message) ?? row.failure_reason ?? row.event_type;
  return {
    eventId: row.id,
    idempotencyKey: row.idempotency_key,
    eventType: row.event_type,
    operationId: row.operation_id ?? undefined,
    executionId: row.execution_id ?? undefined,
    resourceId: row.resource_id ?? undefined,
    bindingId: row.binding_id ?? undefined,
    resourceType: row.resource_type ?? undefined,
    agentId: row.agent_id ?? undefined,
    projectId: row.project_id ?? undefined,
    kitId: row.kit_id ?? undefined,
    status: normalizeEventResult(row.result ?? row.status),
    message,
    errorCode: row.error_code ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    suggestion: row.suggestion ?? undefined,
    offlineCreated: row.offline_created !== 0,
    syncStatus: row.sync_status ?? syncStatusFromQueueStatus(row.status),
    serverAckStatus: row.server_ack_status ?? undefined,
    createdAt: row.created_at,
    syncedAt: row.synced_at ?? undefined,
    metadata
  };
}

function mapAuditFindingRow(row: AuditFindingRow): AuditFindingRecord {
  const relatedEventIds = safeParseJson(row.related_event_ids_json);
  return {
    id: row.id,
    runId: row.run_id,
    ruleId: row.rule_id,
    harnessRuleId: row.harness_rule_id ?? undefined,
    resourceId: row.resource_id,
    bindingId: row.binding_id ?? undefined,
    resourceType: row.resource_type,
    agentId: row.agent_id ?? undefined,
    projectId: row.project_id ?? undefined,
    kitId: row.kit_id ?? undefined,
    severity: row.severity,
    auditStatus: row.audit_status,
    trustScoreImpact: row.trust_score_impact,
    permissionCategory: row.permission_category,
    path: row.path ?? undefined,
    lineStart: row.line_start ?? undefined,
    lineEnd: row.line_end ?? undefined,
    snippetHash: row.snippet_hash ?? undefined,
    pathSummary: row.path_summary ?? undefined,
    title: row.title,
    description: row.description,
    impactScope: safeParseObject(row.impact_scope_json),
    remediation: row.remediation,
    relatedEventIds: Array.isArray(relatedEventIds) ? relatedEventIds.filter((item): item is string => typeof item === 'string') : [],
    metadata: safeParseObject(row.metadata_json),
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at ?? undefined,
    blocker: row.blocker === 1
  };
}

function auditFindingParams(finding: AuditFindingRecord): Array<string | number | null> {
  const redactedMetadata = redactForLog(finding.metadata) as Record<string, unknown>;
  return [
    finding.id,
    finding.runId,
    finding.ruleId,
    finding.harnessRuleId ?? null,
    finding.resourceId,
    finding.bindingId ?? null,
    finding.resourceType,
    finding.agentId ?? null,
    finding.projectId ?? null,
    finding.kitId ?? null,
    finding.severity,
    finding.auditStatus,
    finding.trustScoreImpact,
    finding.permissionCategory,
    finding.path ?? null,
    finding.lineStart ?? null,
    finding.lineEnd ?? null,
    finding.snippetHash ?? null,
    finding.pathSummary ?? null,
    finding.title,
    finding.description,
    JSON.stringify(redactForLog(finding.impactScope)),
    finding.remediation,
    JSON.stringify(redactForLog(finding.relatedEventIds)),
    JSON.stringify(redactedMetadata),
    finding.detectedAt,
    finding.resolvedAt ?? null,
    finding.blocker ? 1 : 0
  ];
}

function findingsForBinding(findings: AuditFindingRecord[], bindingId: string): AuditFindingRecord[] {
  return findings.filter((finding) => !finding.bindingId || finding.bindingId === bindingId);
}

function uniqueScopes(scopes: Array<{ resourceId: string; bindingId?: string }>): Array<{ resourceId: string; bindingId?: string }> {
  const seen = new Set<string>();
  const output: Array<{ resourceId: string; bindingId?: string }> = [];
  for (const scope of scopes) {
    const key = `${scope.resourceId}:${scope.bindingId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(scope);
  }
  return output;
}

function addFilter(clauses: string[], params: Array<string | number | null>, column: string, value: string | undefined): void {
  if (!value) return;
  clauses.push(`${column} = ?`);
  params.push(value);
}

function dedupeEvents(events: LocalEventRecord[]): LocalEventRecord[] {
  const seen = new Set<string>();
  const output: LocalEventRecord[] = [];
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    output.push(event);
  }
  return output;
}

function localQueueStatusFor(syncStatus: SyncStatus): LocalEventQueueStatus {
  if (syncStatus === SyncStatuses.LOCAL_ONLY) return 'accepted';
  if (syncStatus === SyncStatuses.SERVER_REJECTED) return 'rejected';
  if (syncStatus === SyncStatuses.SYNC_FAILED) return 'retryable';
  if (syncStatus === SyncStatuses.SYNCED) return 'accepted';
  return 'pending';
}

function localId(prefix: string, extensionId: string, target: string): string {
  return `${prefix}_${Buffer.from(`${extensionId}:${target}`).toString('base64url')}`;
}

function withMetadata(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const metadata = typeof row.metadataJson === 'string' ? safeParseJson(row.metadataJson) : {};
    const { metadataJson: _metadataJson, ...rest } = row;
    return { ...rest, metadata };
  });
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function safeParseObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  const parsed = safeParseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function createProjectRemovalPlan(input: {
  planId: string;
  projectId: string;
  projectResourceId: string;
  validation: ProjectRemovalValidation;
  requestID?: string;
}): ExecutionPlan {
  return {
    planId: input.planId,
    requestId: input.requestID,
    operation: 'project.remove-record',
    createdAt: new Date().toISOString(),
    dryRun: false,
    riskLevel: 'LOW',
    summary: {
      title: '删除项目管理记录',
      description: '仅删除 EnterpriseAgentHub 本地项目管理记录，不删除用户真实项目目录。',
      targetCount: 1,
      warnings: [
        '删除前必须确认项目下无关联智能体资源。',
        '该计划只作用于本地数据库记录；真实项目目录不在 managedPaths 中。'
      ]
    },
    preconditions: [{
      id: 'project-associated-resources-cleared',
      description: input.validation.allowed
        ? '项目下无阻断删除的关联资源。'
        : input.validation.exists
          ? `项目仍有关联资源：${input.validation.blockers.map((blocker) => blocker.resourceId).join(', ')}`
          : '未找到本地项目管理记录，禁止生成删除成功结果。',
      satisfied: input.validation.allowed,
      errorCode: input.validation.allowed ? undefined : input.validation.exists ? 'project_has_associated_resources' : 'project_record_not_found'
    }],
    steps: [{
      stepId: 'remove-project-management-record',
      action: 'record-state',
      description: '删除 local_projects、PROJECT resource 和 PROJECT binding 中的本地管理记录。',
      rollbackable: false,
      riskLevel: 'LOW',
      managed: true,
      metadata: {
        metadataOnly: true,
        resourceId: input.projectResourceId,
        resourceType: LocalResourceTypes.PROJECT,
        projectId: input.projectId,
        projectPath: input.validation.projectPath,
        pathStatus: input.validation.pathStatus
      }
    }],
    rollbackPolicy: { strategy: 'none', reason: '项目删除只移除本地管理记录；真实项目目录不会被删除。' },
    idempotencyKey: `project:remove-record:${input.projectId}`
  };
}

function resourceIdFor(type: LocalResourceType, sourceId: string): string {
  return `resource_${type.toLowerCase()}_${Buffer.from(sourceId).toString('base64url')}`;
}

function bindingIdFor(resourceId: string, target: string): string {
  return `binding_${Buffer.from(`${resourceId}:${target}`).toString('base64url')}`;
}

function fileIdFor(resourceId: string, bindingId: string, filePath: string): string {
  return `file_${Buffer.from(`${resourceId}:${bindingId}:${filePath}`).toString('base64url')}`;
}

function resourceTypeFromExtensionKind(kind: string | undefined): LocalResourceType {
  if (kind === 'mcp') return LocalResourceTypes.MCP_SERVER;
  if (kind === 'plugin') return LocalResourceTypes.PLUGIN;
  if (kind === 'hook') return LocalResourceTypes.HOOK;
  if (kind === 'cli') return LocalResourceTypes.CLI_COMMAND;
  return LocalResourceTypes.SKILL;
}

function legacyKindFromMetadata(metadata: Record<string, unknown>): string | undefined {
  const kind = stringValue(metadata.kind ?? metadata.manifestKind ?? metadata.type);
  if (kind && ['skill', 'mcp', 'plugin', 'hook', 'cli'].includes(kind.toLowerCase())) return kind.toLowerCase();
  return undefined;
}

function legacyKindFromExtensionId(extensionId: string): string | undefined {
  const normalized = extensionId.toLowerCase();
  if (normalized.startsWith('mcp.') || normalized.startsWith('mcp-') || normalized.startsWith('mcp:')) return 'mcp';
  if (normalized.startsWith('plugin.') || normalized.startsWith('plugin-') || normalized.startsWith('plugin:')) return 'plugin';
  if (normalized.startsWith('hook.') || normalized.startsWith('hook-') || normalized.startsWith('hook:')) return 'hook';
  if (normalized.startsWith('cli.') || normalized.startsWith('cli-') || normalized.startsWith('cli:')) return 'cli';
  return 'skill';
}

function inferSourceType(metadata: Record<string, unknown> | undefined, targetPath: string | undefined): LocalResourceSourceType {
  if (metadata?.source === 'known_tool_scan') return LocalResourceSourceTypes.NATIVE_AGENT_DIRECTORY;
  if (isCentralStoreSource(metadata, targetPath)) return LocalResourceSourceTypes.CENTRAL_STORE;
  if (targetPath && targetPath.includes(`${path.sep}projects${path.sep}`)) return LocalResourceSourceTypes.PROJECT_DIRECTORY;
  if (metadata?.source === 'local_inventory_scan') return LocalResourceSourceTypes.LOCAL_IMPORT;
  return LocalResourceSourceTypes.EXTERNAL_DISCOVERY;
}

function sourceTypeFromKitManifest(manifest: KitManifest): LocalResourceSourceType {
  if (manifest.sourceType === 'central-store') return LocalResourceSourceTypes.CENTRAL_STORE;
  if (manifest.sourceType === 'imported') return LocalResourceSourceTypes.LOCAL_IMPORT;
  return LocalResourceSourceTypes.KIT;
}

function isCentralStoreSource(metadata: Record<string, unknown> | undefined, targetPath: string | undefined): boolean {
  return metadata?.source === 'central_store'
    || Boolean(targetPath && (targetPath.includes(`${path.sep}central-store${path.sep}`) || targetPath.includes('/central-store/')));
}

function inferAgentId(metadata: Record<string, unknown> | undefined, targetPath: string | undefined): string | undefined {
  const adapterId = stringValue(metadata?.adapterId);
  if (adapterId) return adapterId;
  if (targetPath && !isLikelyPath(targetPath)) return targetPath;
  if (targetPath?.includes(`${path.sep}.codex`)) return 'codex';
  if (targetPath?.includes(`${path.sep}.claude`)) return 'claude-code';
  if (targetPath?.includes(`${path.sep}.gemini`)) return 'gemini-cli';
  if (targetPath?.includes(`${path.sep}.cursor`)) return 'cursor';
  if (targetPath?.includes(`${path.sep}.opencode`)) return 'opencode';
  return undefined;
}

function defaultScopeType(input: { agentId?: string; projectId?: string; kitId?: string; targetPath?: string }): ResourceScopeType {
  if (input.kitId) return ResourceScopeTypes.KIT;
  if (input.agentId && input.projectId) return ResourceScopeTypes.AGENT_PROJECT;
  if (input.projectId) return ResourceScopeTypes.PROJECT;
  if (input.agentId) return ResourceScopeTypes.AGENT_GLOBAL;
  if (input.targetPath) return ResourceScopeTypes.CUSTOM_PATH;
  return ResourceScopeTypes.GLOBAL;
}

function managedModeFromMetadata(metadata: Record<string, unknown>, statusValue: string): ManagedMode {
  if (metadata.source === 'known_tool_scan') return ManagedModes.NATIVE_MANAGED;
  if (metadata.discoveredBy === 'skill_install_record') return ManagedModes.SERVER_MANAGED;
  if (statusValue === 'scanned') return ManagedModes.EXTERNAL_DISCOVERY_ONLY;
  return ManagedModes.LOCAL_MANAGED;
}

function writeModeFromResourceType(_type: LocalResourceType): WriteMode {
  return WriteModes.READ_ONLY;
}

async function pathStatusForTarget(targetPath: string | undefined): Promise<PathStatus> {
  if (!targetPath || !isLikelyPath(targetPath)) return PathStatuses.UNKNOWN;
  try {
    await stat(targetPath);
    return PathStatuses.OK;
  } catch (error) {
    if (isMissingFileError(error)) return PathStatuses.MISSING;
    return PathStatuses.INVALID;
  }
}

function mapDetectionStatus(statusValue: string): DetectionStatus {
  const normalized = statusValue.toLowerCase();
  if (normalized.includes('fail')) return DetectionStatuses.SCAN_FAILED;
  if (['removed', 'uninstalled', 'cleaned'].includes(normalized)) return DetectionStatuses.NOT_DETECTED;
  if (['not_configured', 'not-configured'].includes(normalized)) return DetectionStatuses.NOT_CONFIGURED;
  if (['scanned', 'installed', 'enabled', 'connected', 'updated', 'metadata_refresh', 'server_hint_info', 'security_blocked', 'scope_reduced'].includes(normalized)) {
    return DetectionStatuses.DETECTED;
  }
  return DetectionStatuses.UNKNOWN;
}

function mapLifecycleStatus(statusValue: string): LifecycleStatus {
  const normalized = statusValue.toLowerCase();
  if (normalized === 'enabled') return LifecycleStatuses.ENABLED;
  if (normalized === 'connected') return LifecycleStatuses.CONNECTED;
  if (['installed', 'updated'].includes(normalized)) return LifecycleStatuses.INSTALLED;
  if (normalized === 'disabled') return LifecycleStatuses.DISABLED;
  if (['cleaned', 'removed'].includes(normalized)) return LifecycleStatuses.REMOVED;
  if (normalized === 'uninstalled') return LifecycleStatuses.UNINSTALLED;
  if (['scanned', 'security_blocked', 'scope_reduced', 'metadata_refresh', 'server_hint_info', 'delisted'].includes(normalized)) return LifecycleStatuses.RECORDED;
  return LifecycleStatuses.UNKNOWN;
}

function mapAuthStatus(statusValue: string): AuthStatus {
  const normalized = statusValue.toLowerCase();
  if (normalized === 'security_blocked') return AuthStatuses.SECURITY_DELISTED;
  if (normalized === 'scope_reduced') return AuthStatuses.AUTH_REVOKED;
  if (normalized === 'delisted') return AuthStatuses.DELISTED;
  if (['installed', 'enabled', 'connected', 'updated'].includes(normalized)) return AuthStatuses.AUTH_CACHE_VALID;
  return AuthStatuses.UNKNOWN;
}

function mapAuditStatus(statusValue: string): AuditStatus {
  const normalized = statusValue.toLowerCase();
  if (normalized === 'security_blocked' || normalized === 'security_risk') return AuditStatuses.SECURITY_RISK;
  if (normalized === 'high_risk') return AuditStatuses.HIGH_RISK;
  return AuditStatuses.NOT_AUDITED;
}

function mapOperationStatus(statusValue: string): OperationStatus {
  const normalized = statusValue.toLowerCase();
  if (normalized === 'rollback_failed') return OperationStatuses.ROLLBACK_FAILED;
  if (normalized.includes('fail')) return OperationStatuses.FAILURE;
  if (normalized === 'partial_success') return OperationStatuses.PARTIAL_SUCCESS;
  if (normalized === 'rolled_back') return OperationStatuses.ROLLED_BACK;
  if (['installed', 'enabled', 'connected', 'updated', 'cleaned', 'success'].includes(normalized)) return OperationStatuses.SUCCESS;
  return OperationStatuses.IDLE;
}

function permissionLabelFromResourceType(type: LocalResourceType): string {
  if (type === LocalResourceTypes.CLI_COMMAND || type === LocalResourceTypes.HOOK) return '未提取命令权限';
  if (type === LocalResourceTypes.MCP_SERVER) return '未提取网络/环境权限';
  if (type === LocalResourceTypes.PROJECT) return '项目路径';
  return '未声明';
}

function normalizeEventResult(value: string | undefined): LocalEventStatus {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'success' || normalized === 'accepted') return 'success';
  if (normalized === 'partial_success') return 'partial_success';
  if (normalized === 'rolled_back') return 'rolled_back';
  if (normalized === 'rollback_failed') return 'rollback_failed';
  if (normalized === 'failure' || normalized === 'failed' || normalized === 'rejected') return 'failure';
  return 'info';
}

function syncStatusFromQueueStatus(value: string | undefined): SyncStatus {
  const normalized = (value ?? '').toLowerCase();
  if (normalized === 'accepted' || normalized === 'ignored') return SyncStatuses.SYNCED;
  if (normalized === 'rejected') return SyncStatuses.SERVER_REJECTED;
  if (normalized === 'failed' || normalized === 'retryable') return SyncStatuses.SYNC_FAILED;
  return SyncStatuses.PENDING_SYNC;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function latestString(values: Array<string | undefined>): string | undefined {
  const timestamps = values
    .map((value) => value ? new Date(value).getTime() : 0)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (timestamps.length === 0) return undefined;
  return new Date(Math.max(...timestamps)).toISOString();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isLikelyPath(value: string): boolean {
  return path.isAbsolute(value) || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value);
}

function previewableFile(filePath: string, size: number): boolean {
  return size <= 256 * 1024 && ['json', 'toml', 'yaml', 'markdown', 'text'].includes(contentTypeFromPath(filePath));
}

function sha256(value: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function pathStatusForCheckError(error: unknown): PathStatus {
  const code = nodeErrorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') return PathStatuses.MISSING;
  if (code === 'EACCES' || code === 'EPERM') return PathStatuses.NOT_WRITABLE;
  return PathStatuses.INVALID;
}

function pathCheckErrorCode(error: unknown): string {
  const code = nodeErrorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'target_path_not_found';
  if (code === 'EACCES' || code === 'EPERM') return 'target_path_not_writable';
  return 'path_check_failed';
}

function pathStatusLabel(statusValue: PathStatus): string {
  if (statusValue === PathStatuses.MISSING) return '路径不存在';
  if (statusValue === PathStatuses.NOT_WRITABLE) return '路径不可读';
  if (statusValue === PathStatuses.INVALID) return '路径无效';
  if (statusValue === PathStatuses.CONFLICT) return '路径冲突';
  return statusValue;
}

function nodeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Path check failed';
}

function mapHintState(state: string): { status: string; precedence: number } | undefined {
  const normalized = state.toUpperCase();
  if (['SECURITY_DELISTED', 'SECURITY_BLOCK', 'SECURITY_BLOCKED', 'SECURITY_RISK', 'FORCE_DISABLE_MANAGED_ITEMS', 'FORCE_DISABLE'].includes(normalized)) {
    return { status: 'security_blocked', precedence: 1 };
  }
  if (['AUTHORIZATION_SHRINK', 'AUTHORIZATION_REDUCED', 'SCOPE_REDUCED', 'SCOPE_SHRINK'].includes(normalized)) {
    return { status: 'scope_reduced', precedence: 2 };
  }
  if (['DELISTED', 'UNAVAILABLE', 'REMOVED'].includes(normalized)) {
    return { status: 'delisted', precedence: 3 };
  }
  if (['VERSION_REFRESH', 'METADATA_REFRESH', 'REFRESH'].includes(normalized)) {
    return { status: 'metadata_refresh', precedence: 4 };
  }
  if (['INFO', 'INFORMATIONAL'].includes(normalized)) {
    return { status: 'server_hint_info', precedence: 5 };
  }
  return undefined;
}
