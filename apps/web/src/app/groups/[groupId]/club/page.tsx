'use client';
import { use } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { ClubPortal } from '../../ClubPortal';
import { ClubAdmin } from '../../ClubAdmin';
export default function ClubPage(props: {
  params: Promise<{ groupId: string }>;
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const groupId = use(props.params).groupId;
  const params = props.searchParams ? use(props.searchParams) : undefined;
  const { school, ready } = useBrowsingSchoolPageContext(params);
  const { user } = useAuth();
  return (
    <>
      {ready && user && (
        <ClubPortal
          key={`${user.uid}:${school.id}:${groupId}`}
          uid={user.uid}
          schoolId={school.id}
          groupId={groupId}
        />
      )}
      <h2>既有後台</h2>
      <ClubAdmin groupId={groupId} searchParams={props.searchParams} />
    </>
  );
}
