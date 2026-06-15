import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LocalDatabase } from '../db/local-database';
import { redactForLog } from '../../shared/redaction';
import {
  aggregateResourceStatus,
  AuthStatuses,
  AuditStatuses,
  contentTypeFromPath,
  createEmptyPermissionSummary,
  createNotAuditedSummary,
  DetectionStatuses,
  DriftStatuses,
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
  type AuthStatus,
  type DetectionStatus,
  type DriftStatus,
  type FileBackedResource,
  type LifecycleStatus,
  type LocalEventRecord,
  type LocalEventStatus,
  type LocalEventType,
  type LocalResource,
  type LocalResourceSnapshot,
  type LocalResourceSourceType,
  type LocalResourceType,
  type ManagedMode,
  type OperationStatus,
  type PathStatus,
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
  metadata?: Record<string, unknown>;
}

export class LocalLifecycleRepository {
  constructor(private readonly db: LocalDatabase) {}

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

  listResources(): LocalResourceSnapshot {
    this.backfillLegacyResourcesIfNeeded();
    const resources = this.db.query<ResourceRow>(
      `SELECT id, type, name, display_name, description, source_type, source_id, source_path,
              version, latest_version, sha256, package_hash, managed, central_store_managed,
              native_directory_managed, ea_managed_fallback, permission_summary_json,
              audit_summary_json, metadata_json, created_at, last_scanned_at,
              last_modified_at, last_event_at
       FROM local_resources
       ORDER BY COALESCE(last_scanned_at, created_at) DESC, display_name ASC`
    ).map(mapResourceRow);
    const bindings = this.db.query<BindingRow>(
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
       ORDER BY created_at DESC
       LIMIT 200`
    ).map(mapEventRow);

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
          status: aggregateResourceStatus({ auditStatus: resource.auditSummary.status }),
          scopeLabel: '未绑定'
        }];
      }
      return resourceBindings.map((binding) => ({
        resource,
        binding,
        files: filesByBinding.get(binding.id) ?? [],
        events: eventsByResource.get(resource.id) ?? [],
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
      this.upsertLegacyResourceGraph({
        resourceType: LocalResourceTypes.KIT,
        sourceId: tool.extensionId,
        name: tool.toolName,
        targetPath: tool.target,
        status: tool.status,
        sourceType: inferSourceType(metadata, tool.target),
        managed: Boolean(metadata.managed),
        nativeDirectoryManaged: metadata.source === 'known_tool_scan',
        metadata: { ...metadata, toolName: tool.toolName, legacyTable: 'local_tools' },
        createdAt: tool.createdAt ?? now,
        updatedAt: tool.updatedAt ?? now
      });
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
    await this.recordResourceGraph({
      resourceType: LocalResourceTypes.KIT,
      sourceId: input.extensionId,
      name: input.toolName,
      targetPath: input.target,
      status: input.status ?? 'scanned',
      sourceType: inferSourceType(input.metadata, input.target),
      managed: Boolean(input.metadata?.managed),
      nativeDirectoryManaged: input.metadata?.source === 'known_tool_scan',
      metadata: { ...(input.metadata ?? {}), toolName: input.toolName, discoveredBy: 'local_inventory_scan' },
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
      operationStatus: OperationStatuses.FAILURE,
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
      auditSummary: auditStatus === AuditStatuses.NOT_AUDITED
        ? createNotAuditedSummary()
        : { ...createNotAuditedSummary(), status: auditStatus, message: '来自服务端或本地状态的风险标记' },
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
    await this.upsertBinding(binding);
    const file = await this.createFileBackedResource(resourceId, bindingId, input.targetPath, metadata, now);
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
      return {
        resourceId,
        bindingId,
        path: targetPath,
        contentType: isFile ? contentTypeFromPath(targetPath) : 'unknown',
        size: targetStat.size,
        lastKnownMtime: targetStat.mtime.toISOString(),
        lastKnownSize: targetStat.size,
        lastKnownHash: hash,
        currentHash: hash,
        externalModified: false,
        drifted: false,
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

  private async recordLocalEvent(input: {
    eventType: LocalEventType;
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
  }): Promise<void> {
    const idempotencyKey = `local:${input.eventType}:${input.resourceId ?? 'none'}:${input.bindingId ?? 'none'}:${input.errorCode ?? 'info'}`;
    await this.db.run(
      `INSERT OR REPLACE INTO local_events(
        id, idempotency_key, device_id, event_type, resource_id, binding_id, resource_type,
        agent_id, project_id, kit_id, result, error_code, failure_reason, suggestion,
        offline_created, sync_status, payload_json, status, attempt_count, created_at, updated_at
      ) VALUES (?, ?, 'local-inventory-scanner', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, ?, ?)`,
      [
        `local_event_${Buffer.from(idempotencyKey).toString('base64url')}`,
        idempotencyKey,
        input.eventType,
        input.resourceId ?? null,
        input.bindingId ?? null,
        input.resourceType ?? null,
        input.agentId ?? null,
        input.projectId ?? null,
        input.kitId ?? null,
        input.status,
        input.errorCode ?? null,
        input.failureReason ?? null,
        input.suggestion ?? null,
        input.syncStatus,
        JSON.stringify(redactForLog({ ...(input.metadata ?? {}), message: input.message })),
        input.syncStatus === SyncStatuses.LOCAL_ONLY ? 'accepted' : 'pending',
        input.createdAt,
        input.createdAt
      ]
    );
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
