import { PlatformLostFound } from '@/features/lost-found/PlatformLostFound';
import type { ServiceListSearchParams } from '@/lib/serviceListNavigation';

export default async function PlatformLostFoundPostPage({
  searchParams,
}: {
  searchParams: Promise<ServiceListSearchParams>;
}) {
  return <PlatformLostFound mode="create" search={await searchParams} />;
}
