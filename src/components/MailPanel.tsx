import React from 'react';
import {
  Inbox,
  Star,
  Send,
  FileText,
  Trash2,
  PenTool,
  Search,
  Bell,
  Moon,
  Sun,
  Settings,
  ChevronLeft,
  ChevronRight,
  Mail as MailIcon,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import type { EmailFolder } from '../types/email';

const NAV_ITEMS: Array<{
  folder: EmailFolder;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  { folder: 'inbox', label: 'Inbox', icon: Inbox },
  { folder: 'starred', label: 'Starred', icon: Star },
  { folder: 'sent', label: 'Sent', icon: Send },
  { folder: 'drafts', label: 'Drafts', icon: FileText },
  { folder: 'trash', label: 'Trash', icon: Trash2 },
];

/**
 * The left panel: brand, compose, folder navigation, search, and the account block —
 * the same shape as the official website's panel.
 */
export const MailPanel: React.FC<{ collapsed: boolean; onToggle: () => void }> = ({ collapsed, onToggle }) => {
  const {
    currentFolder,
    setCurrentFolder,
    openCompose,
    currentUser,
    unreadInboxCount,
    searchQuery,
    setSearchQuery,
    resetSearch,
    theme,
    toggleTheme,
    setIsSettingsModalOpen,
    accountUrl,
  } = useMail();

  const open = !collapsed;
  const isDark = theme === 'dark';

  return (
    <aside
      className={`hidden h-full shrink-0 flex-col border-r border-neutral-200 bg-white transition-[width] duration-200 select-none md:flex dark:border-[#333333] dark:bg-[#212121] ${
        open ? 'w-60' : 'w-[68px]'
      }`}
    >
      {/* Brand */}
      <div className={`flex items-center h-14 shrink-0 ${open ? 'gap-2.5 px-4' : 'justify-center px-0'}`}>
        <span className="w-8 h-8 rounded-lg bg-[#0494f4] text-white flex items-center justify-center shrink-0">
          <MailIcon className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </span>
        {open && <span className="text-[18px] font-black tracking-tight text-[#0494f4] dark:text-[#4cb4ff]">Mail</span>}
        {open && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse panel"
            title="Collapse"
            className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
          </button>
        )}
      </div>
      {!open && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand panel"
            title="Expand"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      )}

      <div className={`mx-3 h-px bg-neutral-200 dark:bg-[#333333] ${open ? '' : 'mx-2'}`} />

      {/* Compose */}
      <div className={`py-3 ${open ? 'px-3' : 'px-0 flex justify-center'}`}>
        <button
          type="button"
          onClick={() => openCompose()}
          title="Compose new message"
          className={`flex items-center justify-center gap-2 rounded-xl bg-[#0494f4] hover:bg-[#0382d6] text-white font-semibold shadow-sm transition ${
            open ? 'w-full h-10 text-[13px]' : 'w-11 h-11'
          }`}
        >
          <PenTool className="w-[18px] h-[18px]" strokeWidth={1.75} />
          {open && <span>Compose</span>}
        </button>
      </div>

      {/* Search */}
      {open && (
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 h-9 px-3 rounded-full border border-neutral-200 dark:border-[#333333] bg-white dark:bg-[#212121] focus-within:border-[#0494f4]/40 transition">
            <Search className="w-4 h-4 text-neutral-400" strokeWidth={1.75} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') resetSearch();
              }}
              placeholder="Search mail"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
            />
          </div>
        </div>
      )}

      {/* Folders */}
      <nav className={`space-y-0.5 overflow-y-auto ${open ? 'px-2' : 'px-1.5'}`}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = currentFolder === item.folder;
          const showBadge = item.folder === 'inbox' && unreadInboxCount > 0;
          return (
            <button
              key={item.folder}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => setCurrentFolder(item.folder)}
              className={`relative w-full flex items-center rounded-xl text-[13px] transition-colors cursor-pointer ${
                open ? 'gap-2.5 px-2.5 py-2' : 'w-11 h-11 mx-auto justify-center'
              } ${
                active
                  ? 'bg-[#0494f4]/12 text-[#0494f4] font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a]'
              }`}
            >
              {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[#0494f4]" />}
              <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
              {open && <span className="truncate">{item.label}</span>}
              {open && showBadge && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#0494f4] text-white">
                  {unreadInboxCount > 99 ? '99+' : unreadInboxCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Utilities + account */}
      <div className="mt-auto">
        <div className={`mx-3 h-px bg-neutral-200 dark:bg-[#333333] ${open ? '' : 'mx-2'}`} />
        <div className={`flex items-center gap-1 py-2 ${open ? 'px-3' : 'flex-col items-center px-0'}`}>
          <button
            type="button"
            title="Notifications"
            aria-label="Notifications"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] cursor-pointer"
          >
            <Bell className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? 'Switch to light' : 'Switch to dark'}
            aria-label="Toggle theme"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] cursor-pointer"
          >
            {isDark ? <Sun className="w-[18px] h-[18px]" strokeWidth={1.75} /> : <Moon className="w-[18px] h-[18px]" strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] cursor-pointer"
          >
            <Settings className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
        </div>

        <div className={`mx-3 h-px bg-neutral-200 dark:bg-[#333333] ${open ? '' : 'mx-2'}`} />

        <a
          href={`${accountUrl.replace(/\/+$/, '')}/account`}
          title={currentUser.email}
          className={`w-full flex items-center gap-2.5 py-3 hover:bg-neutral-50 dark:hover:bg-[#2a2a2a] ${
            open ? 'px-3' : 'justify-center px-0'
          }`}
        >
          <span className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-[#0494f4] text-white flex items-center justify-center text-xs font-bold">
            {currentUser.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              currentUser.avatarText
            )}
          </span>
          {open && (
            <span className="min-w-0 text-left">
              <span className="block text-[13px] font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                {currentUser.name || currentUser.username}
              </span>
              <span className="block text-[11px] text-neutral-500 truncate">{currentUser.email}</span>
            </span>
          )}
        </a>
      </div>
    </aside>
  );
};
