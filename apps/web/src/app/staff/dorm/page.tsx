'use client';
import Link from 'next/link';
import { DormWorkflow } from '@/components/dorm/DormWorkflow';
import { useAuth } from '@/components/AuthGuard';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { SiteShell } from '@/components/SiteShell';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
export default function DormStaffPage() {
  const { user, loading: authLoading } = useAuth();
  const { status, schoolId, schoolName, schoolSearch } = useCampusBrowseContext();
  const returnUrl = `/staff/dorm${schoolSearch}`;
  return (
    <SiteShell
      title="輔導員工作台"
      subtitle="處理負責棟別的報修、外宿與包裹，接續追蹤處理進度。"
      schoolName={schoolName}
    >
      {authLoading ? (
        <p role="status">正在確認登入狀態…</p>
      ) : status !== 'ready' || !schoolId ? (
        <SchoolScopePlaceholder />
      ) : !user ? (
        <SchoolAccountRequired
          returnUrl={returnUrl}
          alternative="輔導員工作台使用已獲校方指派的工作帳號。需要報修、查包裹或申請外宿，請前往宿舍服務。"
        />
      ) : (
        <DormWorkflow
          key={`${user.uid}:${schoolId}`}
          schoolId={schoolId}
          uid={user.uid}
          initialStaff
        />
      )}
      <p>
        <Link href={`/dormitory${schoolSearch}`}>需要服務請到宿舍頁</Link>
      </p>
    </SiteShell>
  );
}
