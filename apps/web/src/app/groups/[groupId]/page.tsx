'use client';

import { use } from 'react';
import { GroupDiscussion } from '../GroupDiscussion';

export default function GroupDiscussionPage(props: {
  params: Promise<{ groupId: string }>;
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  const { groupId } = use(props.params);
  return <GroupDiscussion groupId={groupId} searchParams={props.searchParams} />;
}
