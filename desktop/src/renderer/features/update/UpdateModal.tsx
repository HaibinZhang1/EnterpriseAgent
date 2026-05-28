import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import type { UpdateState } from '../../types/desktop';

export function UpdateModal({
  update,
  busy,
  onClose,
  onCheck,
  onDownload,
  onCancel,
  onInstall
}: {
  update?: UpdateState;
  busy: boolean;
  onClose: () => void;
  onCheck: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onInstall: () => void;
}) {
  const state = update?.state;
  return (
    <Modal title="客户端更新" onClose={onClose} size="small">
      <section className="grid">
        <div className="row-between">
          <span className="muted">当前状态</span>
          <StatusBadge tone={state === 'available' ? 'warn' : state === 'verified' ? 'ok' : 'info'}>{state ?? '未检查'}</StatusBadge>
        </div>
        {update?.version ? <p>版本：{update.version}</p> : null}
        {update?.releaseNotes ? <p className="muted">{update.releaseNotes}</p> : null}
        {update?.error ? <ErrorState error={update.error} title="更新失败" /> : null}
        <div className="card-action-row">
          <Button disabled={busy} onClick={onCheck}>检查</Button>
          <Button tone="primary" disabled={busy || state !== 'available'} onClick={onDownload}>下载</Button>
          <Button disabled={busy || state !== 'verified'} onClick={onInstall}>安装</Button>
          <Button tone="danger" disabled={busy || !state} onClick={onCancel}>取消</Button>
        </div>
      </section>
    </Modal>
  );
}
