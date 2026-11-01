'use client';
import { use } from 'react';
import { ClubAdmin } from '../../ClubAdmin';
export default function ClubPage(props: {
  params: Promise<{ groupId: string }>;
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  return <ClubAdmin groupId={use(props.params).groupId} searchParams={props.searchParams} />;
}
