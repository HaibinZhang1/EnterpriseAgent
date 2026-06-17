import { asText } from './formatting';
import {
  LocalResourceTypes,
  extractKitManifest,
  type LocalEventRecord,
  type LocalResourceSnapshot
} from '../../shared/local-resources';

export type KitOperationResourceResult = {
  resourceRefId?: string;
  resourceId?: string;
  status: string;
  message: string;
};

export function kitOperationResults(snapshot: LocalResourceSnapshot, kitId: string): KitOperationResourceResult[] {
  return eventsForKit(snapshot, kitId).flatMap(operationResultsFromEvent);
}

function eventsForKit(snapshot: LocalResourceSnapshot, kitId: string): LocalEventRecord[] {
  const kitResourceIds = new Set((snapshot.resources ?? [])
    .filter((resource) => resource.type === LocalResourceTypes.KIT && (resource.sourceId === kitId || extractKitManifest(resource.metadata)?.kitId === kitId))
    .map((resource) => resource.id));
  return (snapshot.events ?? []).filter((event) => (
    event.kitId === kitId
    || (event.resourceId ? kitResourceIds.has(event.resourceId) : false)
    || String(event.metadata?.kitId ?? '') === kitId
    || asRecord(event.metadata?.operationResult)?.kitId === kitId
  ));
}

function operationResultsFromEvent(event: LocalEventRecord): KitOperationResourceResult[] {
  const operationResult = asRecord(event.metadata?.operationResult);
  const resourceResults = operationResult?.resourceResults;
  if (!Array.isArray(resourceResults)) return [];
  return resourceResults.flatMap((result) => {
    const record = asRecord(result);
    if (!record) return [];
    return [{
      resourceRefId: asText(record.resourceRefId, undefined),
      resourceId: asText(record.resourceId, undefined),
      status: asText(record.status, '未知'),
      message: asText(record.message ?? record.failureReason, '无消息')
    }];
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
