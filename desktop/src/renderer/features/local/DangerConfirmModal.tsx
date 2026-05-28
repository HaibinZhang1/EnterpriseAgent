import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import type { UiError } from '../../types/desktop';
import type { ActionResultView } from '../extension/ExtensionActionModal';

export function DangerConfirmModal({
  title,
  message,
  busy,
  error,
  result,
  onClose,
  onConfirm
}: {
  title: string;
  message: string;
  busy?: boolean;
  error?: UiError;
  result?: ActionResultView;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} size="small">
      <p>{message}</p>
      {error ? <ErrorState error={error} title="清理失败" /> : null}
      {result ? <p className="success-text">清理结果：{result.status ?? 'success'}</p> : null}
      <div className="card-action-row">
        <Button onClick={onClose}>取消</Button>
        <Button tone="danger" disabled={busy} onClick={onConfirm}>{busy ? '清理中' : '确认清理'}</Button>
      </div>
    </Modal>
  );
}
