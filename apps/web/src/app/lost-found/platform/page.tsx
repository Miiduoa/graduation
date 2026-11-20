import { PlatformLostFound } from '@/features/lost-found/PlatformLostFound';
import type { ServiceListSearchParams } from '@/lib/serviceListNavigation';

export default async function PlatformLostFoundPage({
  searchParams,
}: {
  searchParams: Promise<ServiceListSearchParams>;
}) {
  return <PlatformLostFound search={await searchParams} />;
}
