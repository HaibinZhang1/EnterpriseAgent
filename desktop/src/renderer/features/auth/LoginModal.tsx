import { useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import type { UiError } from '../../types/desktop';

export function LoginModal({ error, busy, onClose, onLogin }: { error?: UiError; busy: boolean; onClose: () => void; onLogin: (username: string, password: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Modal title="登录 Enterprise Agent Hub" onClose={onClose} size="small">
      <form className="grid" onSubmit={(event) => { event.preventDefault(); onLogin(username, password); }}>
        <label className="field">
          <span>手机号 / 账号</span>
          <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label className="field">
          <span>密码</span>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        {error ? <ErrorState error={error} title="登录失败" /> : null}
        <Button type="submit" tone="primary" disabled={busy}>{busy ? '登录中' : '登录'}</Button>
      </form>
    </Modal>
  );
}
