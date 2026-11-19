'use client';
import { use } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { loginHref } from '@/lib/navigation';
import { ClubProfile } from './ClubProfile';

export function ClubOverview({
  groupId,
  searchParams,
}: {
  groupId: string;
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const params = searchParams ? use(searchParams) : undefined;
  const { school, ready } = useBrowsingSchoolPageContext(params);
  const { user, loading } = useAuth();
  return (
    <SiteShell title="社團" schoolName={ready ? school.name : undefined}>
      {!ready ? (
        <SchoolScopePlaceholder />
      ) : loading ? (
        <p role="status">正在確認帳號…</p>
      ) : !user ? (
        <Link
          href={loginHref(`/groups/${encodeURIComponent(groupId)}/club/overview?schoolId=${encodeURIComponent(school.id)}`)}
        >
          登入後查看社團
        </Link>
      ) : (
        <ClubProfile
          key={JSON.stringify([user.uid, school.id, groupId])}
          uid={user.uid}
          schoolId={school.id}
          groupId={groupId}
        />
      )}
    </SiteShell>
  );
}
