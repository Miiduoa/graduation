import { RequireAdmin } from '@/components/RequireAdmin';
import { SiteShell } from '@/components/SiteShell';

export default function StudentManagementPage() {
  return (
    <SiteShell title="學生資料管理">
      <RequireAdmin>{null}</RequireAdmin>
    </SiteShell>
  );
}
