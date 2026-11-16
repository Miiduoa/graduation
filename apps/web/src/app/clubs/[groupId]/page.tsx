'use client';

import { use } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { ClubPortal } from '../../groups/ClubPortal';

export default function ClubDetailPage(props: {
  params: Promise<{ groupId: string }>;
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string; tab?: string }>;
}) {
  const groupId = use(props.params).groupId;
  const params = props.searchParams ? use(props.searchParams) : undefined;
  const { school, ready } = useBrowsingSchoolPageContext(params);
  const { user, loading } = useAuth();
  const listHref =
    ready && school.id ? `/clubs?schoolId=${encodeURIComponent(school.id)}&tab=discover` : '/clubs';
  return (
    <SiteShell title="社團" schoolName={ready ? school.name : undefined}>
      {!ready ? (
        <SchoolScopePlaceholder />
      ) : loading ? (
        <p role="status">正在確認帳號…</p>
      ) : !user ? (
        <section>
          <h2>登入後查看社團</h2>
          <p>請先登入學校帳號，才能查看社團功能與權限。</p>
          <Link
            className="btn primary"
            href={`/login?returnUrl=${encodeURIComponent(`/clubs/${encodeURIComponent(groupId)}?schoolId=${encodeURIComponent(school.id)}&tab=discover`)}`}
          >
            登入學校帳號
          </Link>
        </section>
      ) : (
        <ClubPortal
          key={`${user.uid}:${school.id}:${groupId}`}
          uid={user.uid}
          schoolId={school.id}
          groupId={groupId}
          listHref={listHref}
        />
      )}
    </SiteShell>
  );
}
