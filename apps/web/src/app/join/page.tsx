import { redirect } from 'next/navigation';
import { redirectQuery } from '@/lib/legacyPageRedirect';

export default async function JoinPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  redirect(`/login${redirectQuery(params)}`);
}
