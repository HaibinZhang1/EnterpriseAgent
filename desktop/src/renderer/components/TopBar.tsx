import type { AppTab, OfflineState, SessionUser } from '../types/desktop';
import { NavTabs } from './NavTabs';

export function TopBar({
  active,
  onChangeTab,
  user,
  offline,
  unreadCount,
  onNotifications,
  onAccount,
  onSettings,
  theme,
  onToggleTheme
}: {
  active: AppTab;
  onChangeTab: (tab: AppTab) => void;
  user?: SessionUser;
  offline?: OfflineState;
  unreadCount: number;
  onNotifications: () => void;
  onAccount: () => void;
  onSettings: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  return (
    <header className="top-bar">
      <div className="brand">
        <div className="brand-mark">EA</div>
        <div className="brand-title">
          <strong>Enterprise Agent Hub</strong>
          <span>{offline?.online === false ? '离线模式' : '桌面客户端'}</span>
        </div>
      </div>
      <NavTabs active={active} onChange={onChangeTab} />
      <div className="top-actions">
        <button type="button" className="icon-button" onClick={onNotifications} aria-label="通知">N{unreadCount > 0 ? ` ${unreadCount}` : ''}</button>
        <button type="button" className="button ghost truncate" onClick={onAccount}>
          {user?.displayName ?? user?.username ?? '登录'}
        </button>
      </div>
    </header>
  );
}
