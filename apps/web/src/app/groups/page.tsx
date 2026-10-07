'use client';

import { GroupDirectory } from './GroupDirectory';

export default function GroupsPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string }>;
}) {
  return <GroupDirectory mode="groups" searchParams={props.searchParams} />;
}
