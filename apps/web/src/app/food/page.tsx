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
      initialOrder={typeof params.order === 'string' ? params.order : ''}
    />
  );
}
