import React, { useEffect, useState } from 'react';
import { ChevronRight, Menu, Search, X } from 'lucide-react';
import { useMail } from '../context/MailContext';
import { AccountSheet } from './AccountSheet';
import { AccountAvatarButton } from './AccountAvatarButton';
import { DockTile, type RailItem } from './RailBits';
import { NavPanel } from './NavPanel';
import { APP_DOCK } from '../data/dock';
import { SOCIAL_LINKS } from '../data/social';

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
    accounts,
    sendRemainingToday,
    dailySendLimit,
    sessionMetaStatus,
    refreshSessionMeta,
  } = useMail();

  const [open, setOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  // The shared Accounts sheet. The widget needs the exact avatar that was
  // tapped, because it draws its card under that element.
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);

  const openAccountSheet = (anchor: HTMLElement) => {
    setAccountAnchor(anchor);
    setAccountSheetOpen(true);
  };

  // Shift+A opens the switcher (same shortcut the header used to own).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (event.shiftKey && (event.key === 'A' || event.key === 'a')) {
        event.preventDefault();
        // No pointer anchor from a keyboard: fall back to the first avatar so
        // the card still opens under a real button.
        const anchor =
          (document.querySelector('button[aria-label^="Accounts ("]') as HTMLElement | null) ??
          (document.querySelector('button[aria-label="User profile"]') as HTMLElement | null) ??
          (document.querySelector('button[aria-label="Account details"]') as HTMLElement | null);
        setAccountAnchor(anchor);
        setAccountSheetOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [panes, setPanes] = useState<RailItem[]>([]);
  const [paneCollapsed, setPaneCollapsed] = useState<Record<string, boolean>>({});

  const openPane = (item: RailItem) =>
    setPanes((list) => (list.some((p) => p.id === item.id) ? list : [...list, item].slice(-2)));
  const isDark = theme === 'dark';

  const panel = (variant: 'desktop' | 'drawer') => (
    <NavPanel
      variant={variant}
      // The drawer is always expanded; the desktop rail can be collapsed.
      open={open}
      onToggleRail={() => setOpen((v) => !v)}
      onCloseDrawer={() => setMobileNav(false)}
      onOpenAccountSheet={openAccountSheet}
      isDark={isDark}
      onToggleTheme={toggleTheme}
      onOpenSettings={() => setIsSettingsModalOpen(true)}
      sessionMetaStatus={sessionMetaStatus}
      onRetryQuota={refreshSessionMeta}
      sendRemainingToday={sendRemainingToday}
      dailySendLimit={dailySendLimit}
    />
  );

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
          {/* Phones: menu on the left, search in the middle, the profile avatar
              on the right (the same one the dock shows on a desktop). */}
          <div className="flex md:hidden items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
              className="w-10 h-10 shrink-0 rounded-full border border-zinc-200 bg-white flex items-center justify-center text-zinc-600 dark:border-[#333333] dark:bg-[#2a2a2a] dark:text-zinc-300 cursor-pointer"
            >
              <Menu className="w-5 h-5" strokeWidth={1.75} />
            </button>

            <div className="flex-1 min-w-0 flex items-center gap-2 h-10 px-3 rounded-full border border-zinc-200 bg-white dark:border-[#333333] dark:bg-[#2a2a2a]">
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

            <AccountAvatarButton variant="desktop" compact onOpen={openAccountSheet} />
          </div>

          {/* Tablets and up: the search pill with the social links beside it. */}
          <div className="hidden md:flex gap-3 shrink-0">
            <div className="flex-1 min-w-0 flex items-center gap-2 h-12 px-4 rounded-full border border-zinc-200 bg-white dark:border-[#333333] dark:bg-[#2a2a2a]">
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
              {/* Unchanged desktop detail: the compact avatar still rides in the
                  search pill (tablets have no right dock). */}
              <AccountAvatarButton variant="mobile" compact onOpen={openAccountSheet} />
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
          <AccountAvatarButton variant="desktop" compact onOpen={openAccountSheet} />
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

      {/* The shared Accounts sheet (Mail's fallback if it cannot load). */}
      <AccountSheet
        isOpen={accountSheetOpen}
        anchorEl={accountAnchor}
        onClose={() => setAccountSheetOpen(false)}
      />
    </div>
  );
};
