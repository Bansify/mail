import { Fingerprint, HardDrive, Video, ShoppingBag, Bot, GitBranch } from 'lucide-react';
import type { RailItem } from '../components/MailShell';

/** The app dock, identical to the website's: same apps, same order, same logos. */
export const APP_DOCK: RailItem[] = [
  { id: 'accounts', label: 'Bansify Accounts', icon: Fingerprint, url: 'https://accounts.bansify.com', logoSrc: 'https://accounts.bansify.com/icon-192.png' },
  { id: 'drive', label: 'Bansify Drive', icon: HardDrive, url: 'https://drive.bansify.com', logoSrc: 'https://drive.bansify.com/icon-192.png' },
  { id: 'meet', label: 'Bansify Meet', icon: Video, url: 'https://meet.bansify.com', logoSrc: 'https://meet.bansify.com/icon-192.png' },
  { id: 'pay', label: 'Bansify Pay', icon: ShoppingBag, url: 'https://pay.bansify.com', logoSrc: 'https://pay.bansify.com/icon-192.png' },
  { id: 'ai', label: 'Bansify AI', icon: Bot, url: 'https://ai.bansify.com', logoSrc: 'https://ai.bansify.com/icon-192.png' },
  { id: 'gitplus', label: 'GitPlus', icon: GitBranch, url: 'https://gitplus.bansify.com', logoSrc: 'https://gitplus.bansify.com/icon-192.png' },
];
