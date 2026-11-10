import type { Metadata } from 'next';
import { AdminWorkspace } from '@/features/admin/AdminWorkspace';

export const metadata: Metadata = {
  title: '平台管理',
  description: '學校、人員、店家、課班掛靠與操作紀錄。',
};

export default function OpsPage() {
  return <AdminWorkspace />;
}
