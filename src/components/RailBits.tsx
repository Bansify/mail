// =============================================================================
// Shared bits of the left rail: the item type and the app tile.
//
// They live in their own file because both `MailShell` (the app dock on the
// right) and `NavPanel` (the folder rail) draw them.
// =============================================================================

import React, { useState } from 'react';

export interface RailItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  url?: string;
  logoSrc?: string;
}

export const DockTile: React.FC<{ item: RailItem; active?: boolean }> = ({ item, active }) => {
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

