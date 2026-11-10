import type { Metadata } from 'next';
import { AdminWorkspace } from '@/features/admin/AdminWorkspace';

export const metadata: Metadata = {
  title: '接入審核',
  description: '審核學校接入申請，並開放已建檔學校。',
};

export default function SchoolReviewPage() {
  return <AdminWorkspace />;
}
