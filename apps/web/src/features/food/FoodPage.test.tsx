// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import FoodPage from '@/app/food/page';
vi.mock('@/features/food/FoodWorkspace', () => ({ FoodWorkspace: () => null }));
afterEach(() => vi.unstubAllEnvs());
it.each([
  ['false', 'false', 'false'],
  ['true', 'false', 'true'],
  ['false', 'true', 'true'],
  ['true', 'true', 'false'],
])('ignores location when gates are %s/%s/%s, retaining main tenant/order semantics', async (assistant, v2, nuni) => {
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', assistant);
  vi.stubEnv('CAMPUS_ASSISTANT_V2_ENABLED', v2);
  vi.stubEnv('CAMPUS_BACKEND', '');
  vi.stubEnv('NUNI_CLASSROOM_ENABLED', nuni);
  for (const params of [{}, { tenant: 'campus', location: 'shop' }, { tenant: 'campus', location: 'shop', order: 'receipt' }]) {
    const page = await FoodPage({ searchParams: Promise.resolve(params) });
    expect(page.props).toEqual({ initialTenant: params.tenant || '', initialOrder: params.order || '', initialLocation: '' });
  }
});
it('parses the new entrance only with all gates and gives order precedence', async () => {
  vi.stubEnv('CAMPUS_ASSISTANT_ENABLED', 'true');
  vi.stubEnv('CAMPUS_ASSISTANT_V2_ENABLED', 'true');
  vi.stubEnv('CAMPUS_BACKEND', 'nuni');
  for (const [location, order, expected] of [['shop', '', 'shop'], ['../bad', '', ''], ['shop', 'receipt', '']]) {
    const page = await FoodPage({ searchParams: Promise.resolve({ tenant: 'campus', location, order }) });
    expect(page.props.initialLocation).toBe(expected);
  }
});
