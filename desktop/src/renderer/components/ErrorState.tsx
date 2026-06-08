import type { UiError } from '../types/desktop';

export function ErrorState({ error, title = '加载失败' }: { error?: UiError; title?: string }) {
  return (
    <div className="state error-state" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{error?.message ?? '操作失败，请稍后重试。'}</p>
        {error?.requestID ? <div className="request-id">requestId: {error.requestID}</div> : null}
        {error?.details ? <ErrorDetails details={error.details} /> : null}
      </div>
    </div>
  );
}

function ErrorDetails({ details }: { details: unknown }) {
  const lines = formatDetails(details);
  if (lines.length === 0) return null;
  return (
    <ul className="error-details">
      {lines.map((line) => <li key={line}>{line}</li>)}
    </ul>
  );
}

function formatDetails(details: unknown): string[] {
  if (!details || typeof details !== 'object') return [];
  const record = details as Record<string, unknown>;
  const source = typeof record.details === 'object' && record.details ? record.details as Record<string, unknown> : record;
  const lines: string[] = [];
  pushLine(lines, 'code', record.code);
  pushLine(lines, 'uploadType', source.uploadType);
  pushLine(lines, 'status', source.status);
  pushLine(lines, 'rejectCode', source.rejectCode);
  pushLine(lines, 'fileName', source.fileName ?? source.originalFilename);
  const precheck = source.precheck && typeof source.precheck === 'object' ? source.precheck as Record<string, unknown> : undefined;
  if (precheck) {
    pushLine(lines, 'precheck.status', precheck.status);
    pushLine(lines, 'precheck.rejectCode', precheck.rejectCode);
  }
  return lines.slice(0, 6);
}

function pushLine(lines: string[], label: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  lines.push(`${label}: ${String(value)}`);
}
