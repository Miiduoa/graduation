import { redirect } from 'next/navigation';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigationLinks';

/** 舊店家別名：改導向現有餐飲入口，不再丟空白登入。 */
export default async function ShopsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const campusSearch = buildCampusNavigationSearch({
    get(key) {
      const value = params[key];
      return (Array.isArray(value) ? value[0] : value) ?? null;
    },
  });
  // These hints retain the browsing campus, not a food tenant, order, or school identity.
  redirect(campusServiceHref('/food', campusSearch));
}
