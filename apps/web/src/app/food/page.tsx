import { nuniEnabled } from '@/lib/nuni/server';
import { FoodWorkspace } from '@/features/food/FoodWorkspace';
import { parseFoodItems } from '@/lib/nuni/assistantV2/food';
import { buildCampusNavigationSearch } from '@/lib/campusNavigationLinks';

function queryId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : '';
}

export default async function FoodPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const v2 = nuniEnabled() && process.env.CAMPUS_ASSISTANT_ENABLED === 'true' &&
    process.env.CAMPUS_ASSISTANT_V2_ENABLED === 'true';
  const tenant = queryId(params.tenant);
  const order = queryId(params.order);
  const location = queryId(params.location);
  const campusSearch = buildCampusNavigationSearch({
    get(key) {
      const value = params[key];
      return (Array.isArray(value) ? value[0] : value) ?? null;
    },
  });
  return (
    <FoodWorkspace
      initialTenant={tenant}
      initialLocation={v2 && !order ? location : ''}
      initialOrder={order}
      initialItems={v2 && !order ? parseFoodItems(params.items) : []}
      campusSearch={campusSearch}
    />
  );
}
