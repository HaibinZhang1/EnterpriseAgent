import type { UiError } from '../types/desktop';

export function ErrorState({ error, title = '加载失败' }: { error?: UiError; title?: string }) {
  return (
    <div className="state error-state" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{error?.message ?? '操作失败，请稍后重试。'}</p>
        {error?.requestID ? <div className="request-id">requestId: {error.requestID}</div> : null}
      </div>
    </div>
  );
}
