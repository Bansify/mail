import React, { useState } from 'react';
import {
  Inbox,
  Star,
  Send,
  FileText,
  Trash2,
  Archive,
  Settings,
  PenTool,
  Search,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Menu,
  X,
  Mail as MailIcon,
} from 'lucide-react';
import { useMail } from '../context/MailContext';
import type { EmailFolder } from '../types/email';
import { APP_DOCK } from '../data/dock';
import { SOCIAL_LINKS } from '../data/social';

export interface RailItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  url?: string;
  logoSrc?: string;
}

const FOLDERS: Array<{ id: EmailFolder; label: string; icon: RailItem['icon'] }> = [
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

const DockTile: React.FC<{ item: RailItem; active?: boolean }> = ({ item, active }) => {
  const [failed, setFailed] = useState(false);
  const Icon = item.icon;
  return (
    <span
      className={`w-[34px] h-[34px] rounded-[10px] bg-[#0494f4] overflow-hidden flex items-center justify-center ring-1 ring-black/5 dark:ring-white/10 transition group-hover:brightness-110 ${
        active ? 'outline outline-2 outline-offset-2 outline-[#0494f4]/60' : ''
      }`}
    >
      {item.logoSrc && !failed ? (
        <img src={item.logoSrc} alt="" loading="lazy" onError={() => setFailed(true)} className="w-full h-full object-cover" />
      ) : (
        <Icon className="w-1/2 h-1/2 text-white" strokeWidth={1.75} />
      )}
    </span>
  );
};

/**
 * Five cards, the same shape as the official website: rail, navigation, content with a
 * search pill above it, and the app dock. Only the name, the icon and the content differ.
 */
export const MailShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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

  const [open, setOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [panes, setPanes] = useState<RailItem[]>([]);
  const [paneCollapsed, setPaneCollapsed] = useState<Record<string, boolean>>({});

  const openPane = (item: RailItem) =>
    setPanes((list) => (list.some((p) => p.id === item.id) ? list : [...list, item].slice(-2)));
  const isDark = theme === 'dark';
  const initial = (currentUser.name || currentUser.username || 'B').slice(0, 1).toUpperCase();

  const row = (folder: (typeof FOLDERS)[number], isOpen: boolean) => {
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

  const panel = (variant: 'desktop' | 'drawer') => {
    const isOpen = variant === 'drawer' ? true : open;
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
                onClick={() => setOpen((v) => !v)}
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
                onClick={() => (variant === 'drawer' ? setMobileNav(false) : setOpen(false))}
                title="Collapse"
                aria-label="Collapse panel"
                className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#333333] cursor-pointer shrink-0"
              >
                {variant === 'drawer' ? <X className="w-4 h-4" strokeWidth={1.75} /> : <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
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
          {FOLDERS.map((folder) => row(folder, isOpen))}
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
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
                onClick={() => setOpen(true)}
                title="Expand panel"
                aria-label="Expand panel"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#333333] cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>
          )}

          <a
            href={`${accountUrl.replace(/\/+$/, '')}/account`}
            title={currentUser.email}
            className={`w-full flex items-center gap-2.5 py-3 hover:bg-zinc-50 dark:hover:bg-[#333333] ${
              isOpen ? 'px-3' : 'justify-center px-0'
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
            {isOpen && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleTheme();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleTheme();
                  }
                }}
                title={isDark ? 'Switch to light' : 'Switch to dark'}
                aria-label="Toggle theme"
                className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#333333] cursor-pointer shrink-0"
              >
                {isDark ? <Sun className="w-4 h-4" strokeWidth={1.75} /> : <Moon className="w-4 h-4" strokeWidth={1.75} />}
              </span>
            )}
          </a>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-[100dvh] w-full flex-col gap-3 bg-[#f5f6f7] p-3 dark:bg-[#212121]">
      <div className="flex flex-1 min-h-0 gap-3">
        <div className="hidden md:block shrink-0">{panel('desktop')}</div>

        {mobileNav && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileNav(false)}
              className="absolute inset-0 bg-black/40 cursor-default"
            />
            <div className="absolute left-3 top-3 bottom-3">{panel('drawer')}</div>
          </div>
        )}

        <div className="flex flex-1 min-w-0 flex-col gap-3">
          {/* search pill and social card, above the content only */}
          <div className="flex gap-3 shrink-0">
            <div className="flex-1 min-w-0 flex items-center gap-2 h-12 px-4 rounded-full border border-zinc-200 bg-white dark:border-[#333333] dark:bg-[#2a2a2a]">
              <button
                type="button"
                onClick={() => setMobileNav(true)}
                aria-label="Open navigation"
                className="md:hidden w-6 h-6 rounded-lg flex items-center justify-center text-zinc-500 cursor-pointer shrink-0"
              >
                <Menu className="w-5 h-5" strokeWidth={1.75} />
              </button>
              <Search className="w-4 h-4 text-zinc-400 shrink-0" strokeWidth={1.75} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') resetSearch();
                }}
                placeholder="Search mail"
                className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
              />
            </div>

            <div className="hidden sm:flex items-center gap-1.5 h-12 px-3 rounded-2xl border border-zinc-200 bg-white dark:border-[#333333] dark:bg-[#2a2a2a] overflow-x-auto">
              {SOCIAL_LINKS.map((social) => {
                const Icon = social.icon;
                return (
                  <a
                    key={social.id}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${social.label} · ${social.handle}`}
                    aria-label={`${social.label} ${social.handle}`}
                    style={{ backgroundColor: social.color }}
                    className="group w-[34px] h-[34px] rounded-[10px] flex items-center justify-center shrink-0 ring-1 ring-black/10 dark:ring-white/15 transition group-hover:brightness-110"
                  >
                    <Icon className="w-4 h-4 text-white" strokeWidth={1.75} />
                  </a>
                );
              })}
            </div>
          </div>

          <main className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-[#333333] dark:bg-[#2a2a2a]">
            {children}
          </main>
        </div>

        {panes.map((item) => {
          const isCollapsed = !!paneCollapsed[item.id];
          return (
            <section
              key={item.id}
              className={`hidden lg:flex shrink-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-[#333333] dark:bg-[#2a2a2a] ${
                isCollapsed ? 'w-14' : 'w-[38%] max-w-[560px]'
              }`}
              aria-label={item.label}
            >
              <div className={`flex items-center gap-2 h-12 px-3 shrink-0 border-b border-zinc-200 dark:border-[#333333] ${isCollapsed ? 'justify-center px-0' : ''}`}>
                {isCollapsed ? (
                  <button
                    type="button"
                    onClick={() => setPaneCollapsed((m) => ({ ...m, [item.id]: false }))}
                    title={item.label}
                    aria-label={`Expand ${item.label}`}
                    className="group w-10 h-10 rounded-xl flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-[#333333] cursor-pointer"
                  >
                    <DockTile item={item} />
                  </button>
                ) : (
                  <>
                    <DockTile item={item} />
                    <span className="text-[13px] font-semibold truncate">{item.label}</span>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-[#0494f4]"
                      >
                        Open in tab
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setPaneCollapsed((m) => ({ ...m, [item.id]: true }))}
                      title="Collapse"
                      aria-label="Collapse"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#333333] cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanes((list) => list.filter((p) => p.id !== item.id))}
                      title="Close"
                      aria-label="Close"
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-[#333333] cursor-pointer"
                    >
                      <X className="w-4 h-4" strokeWidth={1.75} />
                    </button>
                  </>
                )}
              </div>
              {!isCollapsed && item.url && (
                <iframe src={item.url} title={item.label} className="flex-1 w-full border-0 bg-white" loading="lazy" />
              )}
            </section>
          );
        })}

        <aside
          className="hidden lg:flex w-16 shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-zinc-200 bg-white py-3 dark:border-[#333333] dark:bg-[#2a2a2a]"
          aria-label="Bansify apps"
        >
          <a
            href={`${accountUrl.replace(/\/+$/, '')}/account`}
            title={currentUser.email}
            aria-label="Account"
            className="mb-1 w-9 h-9 rounded-full overflow-hidden bg-[#0494f4] text-white flex items-center justify-center text-xs font-bold"
          >
            {currentUser.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              initial
            )}
          </a>
          <div className="w-6 h-px bg-zinc-200 dark:bg-[#333333] mb-1" />

          {APP_DOCK.map((item) => (
            <React.Fragment key={item.id}>
              <button
                type="button"
                onClick={() => openPane(item)}
                title={item.label}
                aria-label={`Open ${item.label}`}
                className="group cursor-pointer rounded-[10px]"
              >
                <DockTile item={item} active={panes.some((p) => p.id === item.id)} />
              </button>
              <div className="w-5 h-px bg-zinc-200 dark:bg-[#333333]" />
            </React.Fragment>
          ))}

        </aside>
      </div>
    </div>
  );
};
