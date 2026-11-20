import { redirect } from 'next/navigation';
import { redirectQuery } from '@/lib/legacyPageRedirect';

export default async function ClassroomGradesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  redirect(`/grades${redirectQuery(params, { tab: 'feedback' })}`);
}
