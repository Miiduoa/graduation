'use client';
import { DormWorkflow } from '@/components/dorm/DormWorkflow';
import { useAuth } from '@/components/AuthGuard';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
export default function DormStaffPage() {
  const { user } = useAuth();
  const { schoolId, schoolName } = useCampusBrowseContext();
  return (
    <SiteShell title="輔導員工作台" subtitle="職員服務" schoolName={schoolName}>
      {!user && <p>請先登入校園帳號。</p>}
      {schoolId && <DormWorkflow schoolId={schoolId} uid={user?.uid} initialStaff />}
      <a href={'/dormitory?schoolId=' + encodeURIComponent(schoolId || '')}>宿舍服務</a>
    </SiteShell>
  );
}
