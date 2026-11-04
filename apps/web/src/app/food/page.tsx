import { FoodWorkspace } from '@/features/food/FoodWorkspace';

export default async function FoodPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <FoodWorkspace
      initialTenant={typeof params.tenant === 'string' ? params.tenant : ''}
      initialLocation={
        typeof params.location === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(params.location)
          ? params.location
          : ''
      }
      initialOrder={typeof params.order === 'string' ? params.order : ''}
    />
  );
}
