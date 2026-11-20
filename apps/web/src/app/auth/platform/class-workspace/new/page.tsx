import type { Metadata } from 'next';
import { ClassCreate } from '@/features/platform/ClassCreate';

export const metadata: Metadata = {
  title: '開課班',
  description: '建立課班工作區並產生邀請碼。',
};

export default function ClassWorkspaceCreatePage() {
  return <ClassCreate />;
}
