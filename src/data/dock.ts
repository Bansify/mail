import { Fingerprint, HardDrive, Video, ShoppingBag, Bot, GitBranch } from 'lucide-react';
import type { RailItem } from '../components/MailShell';

/** The app dock, identical to the website's. */
export const APP_DOCK: RailItem[] = [
  { id: 'accounts', label: 'Bansify Accounts', icon: Fingerprint, url: 'https://accounts.bansify.com' },
  { id: 'drive', label: 'Bansify Drive', icon: HardDrive, url: 'https://drive.bansify.com' },
  { id: 'meet', label: 'Bansify Meet', icon: Video, url: 'https://meet.bansify.com' },
  { id: 'pay', label: 'Bansify Pay', icon: ShoppingBag, url: 'https://pay.bansify.com' },
  { id: 'ai', label: 'Bansify AI', icon: Bot, url: 'https://ai.bansify.com' },
  { id: 'gitplus', label: 'GitPlus', icon: GitBranch, url: 'https://gitplus.bansify.com' },
];
