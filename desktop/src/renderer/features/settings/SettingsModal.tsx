import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import type { UiError } from '../../types/desktop';

export function SettingsModal({
  config,
  error,
  busy,
  canChangePassword = true,
  onClose,
  onSave,
  onChangePassword,
  onOpenUpdate
}: {
  config: Record<string, unknown>;
  error?: UiError;
  busy: boolean;
  canChangePassword?: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  onChangePassword: () => void;
  onOpenUpdate: () => void;
}) {
  const [baseURL, setBaseURL] = useState('');
  const [theme, setTheme] = useState('system');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  useEffect(() => {
    setBaseURL(typeof config.baseURL === 'string' ? config.baseURL : '');
    setTheme(normalizeTheme(config.theme));
    setNotificationsEnabled(typeof config.notificationsEnabled === 'boolean' ? config.notificationsEnabled : true);
  }, [config]);
  return (
    <Modal title="设置" onClose={onClose}>
      <section className="grid">
        <label className="field">
          <span>服务端地址</span>
          <input className="input" value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
        </label>
        <label className="field">
          <span>主题</span>
          <select className="select" value={theme} onChange={(event) => setTheme(event.target.value)}>
            <option value="glass-dark">玻璃深色</option>
            <option value="glass-light">玻璃浅色</option>
            <option value="system">跟随系统</option>
          </select>
        </label>
        <label className="card-action-row">
          <input type="checkbox" checked={notificationsEnabled} onChange={(event) => setNotificationsEnabled(event.target.checked)} />
          <span>启用通知提醒</span>
        </label>
        <p className="muted">Token、API Key、密码等敏感信息不保存到 Renderer 或普通设置文件。</p>
        {error ? <ErrorState error={error} title="保存失败" /> : null}
        <div className="card-action-row">
          <Button tone="primary" disabled={busy} onClick={() => onSave({ baseURL, theme, notificationsEnabled })}>{busy ? '保存中' : '保存设置'}</Button>
          {canChangePassword ? <Button onClick={onChangePassword}>修改密码</Button> : null}
          <Button onClick={onOpenUpdate}>客户端更新</Button>
        </div>
      </section>
    </Modal>
  );
}

function normalizeTheme(value: unknown): 'glass-dark' | 'glass-light' | 'system' {
  return value === 'glass-dark' || value === 'glass-light' || value === 'system' ? value : 'system';
}
