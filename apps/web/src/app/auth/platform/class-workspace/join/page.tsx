import type { Metadata } from 'next';
import { ClassJoin } from '@/features/platform/ClassJoin';

export const metadata: Metadata = {
  title: '加入課班',
  description: '輸入邀請碼加入課班工作區。',
};

export default function ClassWorkspaceJoinPage() {
  return <ClassJoin />;
}
