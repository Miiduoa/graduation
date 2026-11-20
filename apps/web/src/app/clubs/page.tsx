'use client';

import { GroupDirectory } from '../groups/GroupDirectory';

export default function ClubsPage(props: {
  searchParams?: Promise<{ school?: string; schoolId?: string; campus?: string }>;
}) {
  return <GroupDirectory mode="clubs" searchParams={props.searchParams} />;
}
