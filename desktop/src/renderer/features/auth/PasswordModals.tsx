import { useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import type { UiError } from '../../types/desktop';

export function ChangePasswordModal({ force, error, busy, onClose, onSubmit }: { force?: boolean; error?: UiError; busy: boolean; onClose: () => void; onSubmit: (oldPassword: string, newPassword: string) => void }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  return (
    <Modal title={force ? '必须修改密码' : '修改密码'} onClose={force ? () => undefined : onClose} size="small">
      <form className="grid" onSubmit={(event) => { event.preventDefault(); onSubmit(oldPassword, newPassword); }}>
        <p className="muted">{force ? '当前账号需要先完成密码更新；修改成功后请使用新密码重新登录。' : '修改后请使用新密码重新登录。'}</p>
        <label className="field">
          <span>当前密码</span>
          <input className="input" type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} autoComplete="current-password" />
        </label>
        <label className="field">
          <span>新密码</span>
          <input className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
        </label>
        {error ? <ErrorState error={error} title="改密失败" /> : null}
        <div className="card-action-row">
          {!force ? <Button onClick={onClose}>取消</Button> : null}
          <Button type="submit" tone="primary" disabled={busy}>{busy ? '提交中' : '确认修改'}</Button>
        </div>
      </form>
    </Modal>
  );
}
