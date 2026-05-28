import type { ReactNode } from 'react';
import type { AppTab, OfflineState, SessionUser } from '../types/desktop';
import { TopBar } from './TopBar';

export function Shell({
  active,
  onChangeTab,
  user,
  offline,
  unreadCount,
  onNotifications,
  onAccount,
  onSettings,
  children
}: {
  active: AppTab;
  onChangeTab: (tab: AppTab) => void;
  user?: SessionUser;
  offline?: OfflineState;
  unreadCount: number;
  onNotifications: () => void;
  onAccount: () => void;
  onSettings: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <TopBar
        active={active}
        onChangeTab={onChangeTab}
        user={user}
        offline={offline}
        unreadCount={unreadCount}
        onNotifications={onNotifications}
        onAccount={onAccount}
        onSettings={onSettings}
      />
      {offline?.online === false ? <div className="offline-banner">当前离线：新增服务端动作已暂停，本地清理和查看仍可用。</div> : <div />}
      {children}
    </div>
  );
}
