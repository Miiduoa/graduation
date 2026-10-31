import { redirect } from 'next/navigation';
import { legacyCourseHref } from '@/features/nuni/studyNavigation';

export default async function ClassWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  redirect(legacyCourseHref(workspaceId, query));
}
