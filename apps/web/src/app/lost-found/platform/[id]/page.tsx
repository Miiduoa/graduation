import { PlatformLostFound } from '@/features/lost-found/PlatformLostFound';
import type { ServiceListSearchParams } from '@/lib/serviceListNavigation';

export default async function PlatformLostFoundDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ServiceListSearchParams>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  return <PlatformLostFound mode="detail" id={id} search={search} />;
}
