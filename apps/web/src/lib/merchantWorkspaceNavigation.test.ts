// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  merchantWorkspaceHref,
  readMerchantWorkspaceLocation,
  type MerchantWorkspaceQueue,
  type MerchantWorkspaceSection,
} from './merchantWorkspaceNavigation';

const identity = { tenantId: 'school-one', locationId: 'Store_A-01' };
const baseQuery = new URLSearchParams({
  tenant: identity.tenantId,
  location: identity.locationId,
}).toString();

function read(query: string) {
  return readMerchantWorkspaceLocation(new URLSearchParams(query));
}

describe('merchant workspace locations', () => {
  it('keeps the list distinct from an invalid or incomplete destination', () => {
    expect(read('')).toEqual({ status: 'list' });
    expect(read('section=orders&queue=active')).toEqual({ status: 'list' });
    expect(read('tenant=school-one')).toEqual({ status: 'invalid' });
    expect(read('location=Store_A-01')).toEqual({ status: 'invalid' });
    expect(read('tenant=&location=')).toEqual({ status: 'invalid' });
  });

  it('omits default UI selectors and restores their explicit values on reload', () => {
    expect(merchantWorkspaceHref(identity)).toBe(`/merchant/workspace?${baseQuery}`);
    expect(merchantWorkspaceHref({ ...identity, section: 'overview', queue: 'all' })).toBe(
      `/merchant/workspace?${baseQuery}`,
    );
    expect(read(baseQuery)).toEqual({
      status: 'selected',
      ...identity,
      section: 'overview',
      queue: 'all',
    });
  });

  it.each(
    (['overview', 'orders'] as MerchantWorkspaceSection[]).flatMap((section) =>
      (['all', 'incoming', 'active'] as MerchantWorkspaceQueue[]).map((queue) => ({
        section,
        queue,
      })),
    ),
  )('restores $section and $queue without changing the workspace identity', (selectors) => {
    const url = new URL(merchantWorkspaceHref({ ...identity, ...selectors }), 'https://nuni.test');
    expect(url.pathname).toBe('/merchant/workspace');
    expect(readMerchantWorkspaceLocation(url.searchParams)).toEqual({
      status: 'selected',
      ...identity,
      ...selectors,
    });
  });

  it.each([
    'tenant=school-one',
    'tenant=other-school',
    'tenant=',
    'location=Store_A-01',
    'location=other-store',
    'location=',
  ])('rejects duplicate identity parameters even when repeated values match: %s', (duplicate) => {
    expect(read(`${baseQuery}&${duplicate}`)).toEqual({ status: 'invalid' });
  });

  it.each([
    { tenantId: 'School-one', locationId: 'Store_A-01' },
    { tenantId: 'school_one', locationId: 'Store_A-01' },
    { tenantId: ' school-one', locationId: 'Store_A-01' },
    { tenantId: 'school-one', locationId: 'Store_A-01 ' },
    { tenantId: '../admin', locationId: 'Store_A-01' },
    { tenantId: 'school-one', locationId: '../orders' },
    { tenantId: 'school-one', locationId: 'one/two' },
    { tenantId: 'school-one', locationId: 'one%2Ftwo' },
    { tenantId: 'school-one', locationId: 'one\\two' },
    { tenantId: 'school-one', locationId: 'Store\u200b_A-01' },
    { tenantId: 'school-one', locationId: 'Store\u0000_A-01' },
    { tenantId: 'school-one', locationId: '店家' },
    { tenantId: 'school-one', locationId: 'x&tenant=another-school' },
    { tenantId: 'school-one', locationId: 'x#orders' },
    { tenantId: 'x', locationId: 'Store_A-01' },
    { tenantId: 'x'.repeat(201), locationId: 'Store_A-01' },
    { tenantId: 'school-one', locationId: 'x'.repeat(121) },
  ])('uses the shared identity contract without repairing ambiguous input %#', (value) => {
    expect(
      read(new URLSearchParams({ tenant: value.tenantId, location: value.locationId }).toString()),
    ).toEqual({ status: 'invalid' });
    expect(merchantWorkspaceHref(value)).toBe('/merchant/workspace');
  });

  it('keeps opaque location IDs case-sensitive instead of combining different stores', () => {
    const upper = merchantWorkspaceHref(identity);
    const lower = merchantWorkspaceHref({ ...identity, locationId: 'store_a-01' });
    expect(upper).not.toBe(lower);
    expect(read(new URL(upper, 'https://nuni.test').search)).toMatchObject({
      locationId: 'Store_A-01',
    });
    expect(read(new URL(lower, 'https://nuni.test').search)).toMatchObject({
      locationId: 'store_a-01',
    });
  });

  it.each([
    'section=admin&queue=private',
    'section=ORDERS&queue=ACTIVE',
    'section=orders&section=orders&queue=active&queue=active',
    'section=overview&section=orders&queue=incoming&queue=active',
  ])('uses safe defaults for unsupported or ambiguous UI selectors: %s', (selectors) => {
    expect(read(`${baseQuery}&${selectors}`)).toEqual({
      status: 'selected',
      ...identity,
      section: 'overview',
      queue: 'all',
    });
  });

  it('defaults selectors independently without discarding a valid filter', () => {
    expect(read(`${baseQuery}&section=orders&section=orders&queue=incoming`)).toEqual({
      status: 'selected',
      ...identity,
      section: 'overview',
      queue: 'incoming',
    });
    expect(read(`${baseQuery}&section=orders&queue=all&queue=active`)).toEqual({
      status: 'selected',
      ...identity,
      section: 'orders',
      queue: 'all',
    });
  });

  it('returns only a location request and never an authorization or confirmed operation', () => {
    const location = read(
      `${baseQuery}&section=orders&queue=active&role=owner&authorized=true&confirmed=1&token=secret&returnUrl=https://other.test&customerName=private`,
    );
    expect(location).toEqual({
      status: 'selected',
      ...identity,
      section: 'orders',
      queue: 'active',
    });
    if (location.status !== 'selected') throw new Error('Expected a selected location');
    expect(
      merchantWorkspaceHref({
        ...location,
        token: 'secret',
        confirmed: true,
        role: 'owner',
      } as Parameters<typeof merchantWorkspaceHref>[0]),
    ).toBe(`/merchant/workspace?${baseQuery}&section=orders&queue=active`);
  });

  it('does not serialize unsupported selectors supplied outside TypeScript', () => {
    const destination = {
      ...identity,
      section: 'https://other.test',
      queue: 'active&confirmed=1',
    } as unknown as Parameters<typeof merchantWorkspaceHref>[0];
    expect(merchantWorkspaceHref(destination)).toBe(`/merchant/workspace?${baseQuery}`);
  });
});
