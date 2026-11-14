'use client';
import { use } from 'react';
import { ClubOverview } from '../../../ClubOverview';
export default function ClubOverviewPage(props: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  return <ClubOverview groupId={use(props.params).groupId} searchParams={props.searchParams} />;
}
