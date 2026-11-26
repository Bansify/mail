// =============================================================================
// The left navigation panel (desktop rail and the phone drawer share it).
//
// Split out of `MailShell` so each file stays inside the 500-line budget. It owns
// only its own presentation: folders, Compose, Settings, the send-quota strip and
// the account row. The account itself comes from `useMail`, so this file can
// never fork switching, drafts or caches.
// =============================================================================

import React from 'react';
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  Moon,
  PenTool,
  Send,
  Settings,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import type { EmailFolder } from '../types/email';
import { RailItem, DockTile } from './RailBits';

export const FOLDERS: Array<{ id: EmailFolder; label: string; icon: RailItem['icon'] }> = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'drafts', label: 'Drafts', icon: FileText },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

const BrandTile: React.FC = () => (
  <span className="w-9 h-9 rounded-[10px] bg-[#0494f4] overflow-hidden flex items-center justify-center shrink-0 ring-1 ring-black/5 dark:ring-white/10">
    <img src="/icon-192.png" alt="Bansify Mail" className="w-full h-full object-cover" />
  </span>
);

export interface NavPanelProps {
  variant: 'desktop' | 'drawer';
  /** The desktop rail's collapsed state. The drawer is always expanded. */
  open: boolean;
  onToggleRail: () => void;
  onCloseDrawer: () => void;
  onOpenAccountSheet: (anchor: HTMLElement) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  sessionMetaStatus: 'loading' | 'ready' | 'error';
  onRetryQuota: () => void;
  sendRemainingToday: number | null;
  dailySendLimit: number | null;
}

export const NavPanel: React.FC<NavPanelProps> = ({
  variant,
  open,
  onToggleRail,
  onCloseDrawer,
  onOpenAccountSheet,
  isDark,
  onToggleTheme,
  onOpenSettings,
  sessionMetaStatus,
  onRetryQuota,
  sendRemainingToday,
  dailySendLimit,
}) => {
  const { currentFolder, setCurrentFolder, openCompose, currentUser, unreadInboxCount, accounts } = useMail();
  const isOpen = variant === 'drawer' ? true : open;
  const initial = (currentUser.name || currentUser.username || 'B').slice(0, 1).toUpperCase();
  const accountLabel = accounts.length > 1 ? `Accounts (${accounts.length})` : 'Account details';

  const folderRow = (folder: (typeof FOLDERS)[number]) => {
    const Icon = folder.icon;
    const active = currentFolder === folder.id;
    const badge = folder.id === 'inbox' && unreadInboxCount > 0 ? unreadInboxCount : null;
    return (
      <button
        key={folder.id}
        type="button"
        onClick={() => setCurrentFolder(folder.id)}
        title={folder.label}
        aria-label={folder.label}
        aria-current={active ? 'page' : undefined}
        className={`group relative flex items-center h-10 rounded-xl cursor-pointer ${
          isOpen ? 'w-full' : 'w-10'
        } ${active ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}
      >
        <span
          aria-hidden
          className={`absolute inset-x-0 top-[2px] bottom-[2px] rounded-xl transition-colors ${
            active
              ? 'bg-[#0494f4] shadow-sm shadow-[#0494f4]/25'
              : 'bg-zinc-100/80 group-hover:bg-zinc-200/80 dark:bg-[#303030] dark:group-hover:bg-[#3a3a3a]'
          }`}
        />
        <span className="relative w-10 h-10 flex items-center justify-center shrink-0">
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </span>
        {isOpen && (
          <>
            <span className={`relative ml-2 truncate text-[13px] ${active ? 'font-semibold' : 'font-medium'}`}>
              {folder.label}
            </span>
            {badge && (
              <span
                className={`relative ml-auto mr-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-white/25 text-white' : 'bg-white text-zinc-600 dark:bg-[#212121] dark:text-zinc-300'
                }`}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </>
        )}
      </button>
    );
  };

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-[#333333] dark:bg-[#2a2a2a] ${
        isOpen ? 'w-[260px]' : 'w-16'
      }`}
    >
      <div className={`flex items-center h-16 shrink-0 ${isOpen ? 'gap-2.5 px-3' : 'justify-center px-0'}`}>
        {isOpen ? (
          <>
            <button
              type="button"
              onClick={onToggleRail}
              title="Collapse panel"
              aria-label="Collapse panel"
              className="rounded-[10px] cursor-pointer shrink-0"
            >
              <BrandTile />
            </button>
            <span className="min-w-0 text-[16px] font-black tracking-tight leading-none truncate">
              <span className="text-[#0494f4]">Bansify</span>{' '}
              <span className="text-zinc-900 dark:text-zinc-100">Mail</span>
            </span>
            <button
              type="button"
              onClick={() => (variant === 'drawer' ? onCloseDrawer() : onToggleRail())}
              title="Collapse"
              aria-label="Collapse panel"
              className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#333333] cursor-pointer shrink-0"
            >
              {variant === 'drawer' ? (
                <X className="w-4 h-4" strokeWidth={1.75} />
              ) : (
                <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
              )}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onToggleRail}
            title="Expand panel"
            aria-label="Expand panel"
            className="rounded-[10px] cursor-pointer"
          >
            <BrandTile />
          </button>
        )}
      </div>

      <div className={`pb-2 ${isOpen ? 'px-3' : 'px-0 flex justify-center'}`}>
        <button
          type="button"
          onClick={() => openCompose()}
          title="Compose"
          className={`flex items-center justify-center gap-2 rounded-xl bg-[#0494f4] hover:bg-[#0382d6] text-white font-semibold transition ${
            isOpen ? 'w-full h-10 text-[13px]' : 'w-10 h-10'
          }`}
        >
          <PenTool className="w-[18px] h-[18px]" strokeWidth={1.75} />
          {isOpen && <span>Compose</span>}
        </button>
      </div>

      <div className={`flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 ${isOpen ? 'px-3' : 'px-0 items-center'}`}>
        {FOLDERS.map(folderRow)}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className={`group relative flex items-center h-10 rounded-xl cursor-pointer text-zinc-900 dark:text-zinc-100 ${
            isOpen ? 'w-full' : 'w-10'
          }`}
        >
          <span
            aria-hidden
            className="absolute inset-x-0 top-[2px] bottom-[2px] rounded-xl bg-zinc-100/80 group-hover:bg-zinc-200/80 dark:bg-[#303030] dark:group-hover:bg-[#3a3a3a] transition-colors"
          />
          <span className="relative w-10 h-10 flex items-center justify-center shrink-0">
            <Settings className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </span>
          {isOpen && <span className="relative ml-2 truncate text-[13px] font-medium">Settings</span>}
        </button>
      </div>

      <div className="shrink-0">
        <div className={`mx-3 h-px bg-zinc-200 dark:bg-[#333333] ${isOpen ? '' : 'mx-2'}`} />

        {!isOpen && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={onToggleRail}
              title="Expand panel"
              aria-label="Expand panel"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#333333] cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Send quota: it arrives after the shell, so it shows a neutral
            skeleton, then the real number, or a retry for this strip only. */}
        {isOpen && (
          <div className="px-3 pb-1">
            {sessionMetaStatus === 'loading' && (
              <div aria-hidden="true">
                <div
                  data-testid="quota-skeleton"
                  className="h-2.5 w-32 animate-pulse rounded-full bg-zinc-200 dark:bg-[#3a3a3a]"
                />
              </div>
            )}
            {sessionMetaStatus === 'error' && (
              <button
                type="button"
                onClick={onRetryQuota}
                className="text-left text-[11px] text-[#0494f4] hover:underline cursor-pointer"
              >
                Send limit unavailable — retry
              </button>
            )}
            {sessionMetaStatus === 'ready' && sendRemainingToday !== null && dailySendLimit !== null && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {sendRemainingToday} of {dailySendLimit} sends left today
              </p>
            )}
          </div>
        )}

        <div
          className={`group w-full flex items-center gap-2.5 py-2 hover:bg-zinc-50 dark:hover:bg-[#333333] ${
            isOpen ? 'px-3' : 'justify-center px-0'
          }`}
        >
          <button
            type="button"
            onClick={(event) => onOpenAccountSheet(event.currentTarget)}
            title={`${currentUser.email} — switch account`}
            aria-label={accountLabel}
            aria-haspopup="dialog"
            className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1 text-left cursor-pointer ${
              isOpen ? '' : 'justify-center'
            }`}
          >
            <span className="w-9 h-9 rounded-full overflow-hidden bg-[#0494f4] text-white flex items-center justify-center text-xs font-bold shrink-0">
              {currentUser.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                initial
              )}
            </span>
            {isOpen && (
              <span className="min-w-0 text-left">
                {currentUser.name && (
                  <span className="block text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {currentUser.name}
                  </span>
                )}
                <span className="block text-[11px] text-zinc-500 truncate">{currentUser.email}</span>
              </span>
            )}
          </button>
          {isOpen && (
            <button
              type="button"
              onClick={onToggleTheme}
              title={isDark ? 'Switch to light' : 'Switch to dark'}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#333333] cursor-pointer shrink-0"
            >
              {isDark ? <Sun className="w-4 h-4" strokeWidth={1.75} /> : <Moon className="w-4 h-4" strokeWidth={1.75} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export { DockTile };
