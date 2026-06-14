import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Modal } from '../../components/Modal';
import type { RememberedLoginState, UiError } from '../../types/desktop';

interface LoginModalProps {
  error?: UiError;
  busy: boolean;
  rememberedLogin: RememberedLoginState;
  onClearRememberedLogin: () => void;
  onClose: () => void;
  onLogin: (username: string, password: string, rememberPassword: boolean) => void;
}

export function LoginModal({ error, busy, rememberedLogin, onClearRememberedLogin, onClose, onLogin }: LoginModalProps) {
  const [username, setUsername] = useState(rememberedLogin.username ?? '');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(Boolean(rememberedLogin.remembered && rememberedLogin.autoLogin));

  useEffect(() => {
    if (!rememberedLogin.remembered) {
      setRememberPassword(false);
      return;
    }
    setUsername(rememberedLogin.username ?? '');
    setRememberPassword(Boolean(rememberedLogin.autoLogin));
  }, [rememberedLogin.autoLogin, rememberedLogin.remembered, rememberedLogin.username]);

  const clearRemembered = () => {
    setPassword('');
    setRememberPassword(false);
    onClearRememberedLogin();
  };

  return (
    <Modal title="登录 Enterprise Agent Hub" onClose={onClose} size="small">
      <form className="grid" onSubmit={(event) => { event.preventDefault(); onLogin(username, password, rememberPassword); }}>
        <label className="field">
          <span>手机号 / 账号</span>
          <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label className="field">
          <span>密码</span>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        <label className="checkbox-line">
          <input type="checkbox" checked={rememberPassword} onChange={(event) => setRememberPassword(event.target.checked)} />
          <span>记住密码并自动登录</span>
        </label>
        {rememberedLogin.remembered ? (
          <div className="login-memory-state">
            <span>已保存账号：{rememberedLogin.username ?? '当前账号'}</span>
            <Button type="button" tone="ghost" onClick={clearRemembered}>清除</Button>
          </div>
        ) : null}
        {error ? <ErrorState error={error} title="登录失败" /> : null}
        <Button type="submit" tone="primary" disabled={busy}>{busy ? '登录中' : '登录'}</Button>
      </form>
    </Modal>
  );
}
