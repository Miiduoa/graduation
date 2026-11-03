import type { Metadata } from 'next';
import { SchoolAnnouncementsAdmin } from './SchoolAnnouncementsAdmin';

export const metadata: Metadata = {
  title: '校園公告',
  description: '校管在網頁列出、建立與編輯本校公告。',
};

export default function AdminAnnouncementsPage() {
  return <SchoolAnnouncementsAdmin />;
}
