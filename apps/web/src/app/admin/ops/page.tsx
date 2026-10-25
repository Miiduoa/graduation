import type { Metadata } from 'next';
import { OpsConsole } from '@/features/platform/OpsConsole';

export const metadata: Metadata = {
  title: '完整管理台',
  description: '學校、人員、店家、課班掛靠與操作紀錄。',
};

export default function OpsPage() {
  return <OpsConsole />;
}
