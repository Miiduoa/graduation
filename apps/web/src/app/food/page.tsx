import { nuniEnabled } from '@/lib/nuni/server';
import { FoodWorkspace } from '@/features/food/FoodWorkspace';

export default async function FoodPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const v2 = nuniEnabled() && process.env.CAMPUS_ASSISTANT_ENABLED === 'true' &&
    process.env.CAMPUS_ASSISTANT_V2_ENABLED === 'true';
  return (
    <FoodWorkspace
      initialTenant={typeof params.tenant === 'string' ? params.tenant : ''}
      initialLocation={
        v2 && !params.order && typeof params.location === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(params.location)
          ? params.location
          : ''
      }
      initialOrder={typeof params.order === 'string' ? params.order : ''}
    />
  );
}
