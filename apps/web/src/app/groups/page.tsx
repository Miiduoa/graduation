'use client';

import { GroupDirectory } from './GroupDirectory';

export default function GroupsPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  return <GroupDirectory mode="groups" searchParams={props.searchParams} />;
}
