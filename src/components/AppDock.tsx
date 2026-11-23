import React from 'react';
import { Fingerprint, HardDrive, Video, ShoppingBag, Bot, GitBranch } from 'lucide-react';
import { useMail } from '../context/MailContext';

const APPS = [
  { id: 'accounts', label: 'Bansify Accounts', icon: Fingerprint, url: 'https://accounts.bansify.com' },
  { id: 'drive', label: 'Bansify Drive', icon: HardDrive, url: 'https://drive.bansify.com' },
  { id: 'meet', label: 'Bansify Meet', icon: Video, url: 'https://meet.bansify.com' },
  { id: 'pay', label: 'Bansify Pay', icon: ShoppingBag, url: 'https://pay.bansify.com' },
  { id: 'ai', label: 'Bansify AI', icon: Bot, url: 'https://ai.bansify.com' },
  { id: 'gitplus', label: 'GitPlus', icon: GitBranch, url: 'https://gitplus.bansify.com' },
];

/** Right-hand app dock, matching the official website: account on top, apps below. */
export const AppDock: React.FC = () => {
  const { currentUser, accountUrl } = useMail();

  return (
    <aside className="hidden lg:flex w-14 h-full shrink-0 flex-col items-center gap-1 border-l border-neutral-200 dark:border-[#333333] py-3">
      <a
        href={`${accountUrl.replace(/\/+$/, '')}/account`}
        title={currentUser.email}
        aria-label="Account centre"
        className="mb-1 w-9 h-9 rounded-full overflow-hidden bg-[#0494f4] text-white flex items-center justify-center text-xs font-bold"
      >
        {currentUser.avatarUrl ? (
          <img src={currentUser.avatarUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          currentUser.avatarText
        )}
      </a>
      <div className="w-6 h-px bg-neutral-200 dark:bg-[#333333] mb-1" />

      {APPS.map((app, index) => {
        const Icon = app.icon;
        return (
          <React.Fragment key={app.id}>
            {index === Math.ceil(APPS.length / 2) && <div className="w-6 h-px bg-neutral-200 dark:bg-[#333333] my-1" />}
            <a
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              title={app.label}
              aria-label={`Open ${app.label}`}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-[#2a2a2a] transition-colors"
            >
              <Icon className="w-5 h-5" strokeWidth={1.75} />
            </a>
          </React.Fragment>
        );
      })}
    </aside>
  );
};
