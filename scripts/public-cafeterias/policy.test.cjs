const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const {
  PublicCafeteriaError,
  PublicCafeteriaService,
  createWindowLimiter,
  requirePublicSchoolId,
  resetPublicCafeteriaCache,
} = require(join(process.env.PUBLIC_CAFETERIA_COMPILED, 'service.js'));
const catalog = require(join(process.env.PUBLIC_CAFETERIA_COMPILED, 'cafeteriaCatalog.js'));

test('missing or invalid schoolId is 400 and never lists every school', () => {
  for (const value of ['', null, undefined, 'ALL', '../pu', 'pu/cgu', 'PU']) {
    assert.throws(() => requirePublicSchoolId(value), PublicCafeteriaError);
    try {
      requirePublicSchoolId(value);
    } catch (error) {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'SCHOOL_ID_REQUIRED');
    }
  }
});

test('public projection drops contact, phone, email, review notes, reviewer, orders and revenue', () => {
  const row = catalog.parseCafeteriaLocation(
    {
      id: 'stall',
      name: '校內咖啡店',
      contact: '店長',
      contactName: '店長',
      phone: '04-0000000',
      email: 'shop@example.test',
      reviewNote: '內部備註',
      reviewNotes: '內部備註',
      reviewer: '管理員',
      reviewerId: 'op-1',
      reviewedBy: 'op-1',
      orders: [{ id: 'o-1' }],
      revenue: 12000,
      merchantMode: 'info_only',
    },
    'pu',
  );
  const published = catalog.toPublicCafeteriaRecord(row);
  catalog.assertNoPrivateCafeteriaFields(published);
  assert.equal(published.name, '校內咖啡店');
  assert.equal(published.merchantMode, 'info_only');
  for (const field of catalog.PRIVATE_CAFETERIA_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(published, field), false);
  }
});

test('rate limiter blocks a noisy client without changing another client', () => {
  const limiter = createWindowLimiter({ max: 2, windowMs: 60_000 });
  assert.equal(limiter.allow('a', 1), true);
  assert.equal(limiter.allow('a', 2), true);
  assert.equal(limiter.allow('a', 3), false);
  assert.equal(limiter.allow('b', 3), true);
});

function memoryDb(rows) {
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM tenants')) {
        return { rows: rows.tenants.filter((row) => row.id === params[0]) };
      }
      if (sql.includes('FROM food_locations')) {
        return {
          rows: rows.locations
            .filter(
              (row) =>
                row.tenant_id === params[0] && row.public_access === true && row.status === 'open',
            )
            .map((row) => ({
              id: row.id,
              name: row.name,
              zone_label: row.zone_label,
              opening_hours: null,
              description: row.description,
              merchant_mode: row.merchant_mode,
              review_status: 'unverified',
              source_url: row.source_url,
              external_order_url: row.external_order_url,
              source_label: row.source_label,
              source_updated_at: row.source_updated_at,
            })),
        };
      }
      if (sql.includes('FROM food_menu_items')) {
        const allowed = new Set(params[1] ?? []);
        return {
          rows: rows.menus.filter(
            (row) => row.tenant_id === params[0] && allowed.has(row.location_id),
          ),
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

test('school A cannot read school B, and a closed school is empty', async () => {
  resetPublicCafeteriaCache();
  const service = new PublicCafeteriaService(
    memoryDb({
      tenants: [
        { id: 'pu', state: 'open' },
        { id: 'cgu', state: 'open' },
        { id: 'ntu', state: 'provisioned' },
      ],
      locations: [
        {
          id: 'stall',
          tenant_id: 'pu',
          name: '校內咖啡店',
          zone_label: '學生餐廳',
          description: null,
          merchant_mode: 'info_only',
          public_access: true,
          status: 'open',
          source_url: null,
          external_order_url: null,
          source_label: null,
          source_updated_at: null,
          phone: '不該被選出',
        },
        {
          id: 'private',
          tenant_id: 'pu',
          name: '內部餐廳',
          zone_label: null,
          description: null,
          merchant_mode: 'info_only',
          public_access: false,
          status: 'open',
          source_url: null,
          external_order_url: null,
          source_label: null,
          source_updated_at: null,
        },
        {
          id: 'other',
          tenant_id: 'cgu',
          name: '他校餐廳',
          zone_label: null,
          description: null,
          merchant_mode: 'info_only',
          public_access: true,
          status: 'open',
          source_url: null,
          external_order_url: null,
          source_label: null,
          source_updated_at: null,
        },
      ],
      menus: [
        {
          id: 'toast',
          tenant_id: 'pu',
          location_id: 'stall',
          name: '蔬菜吐司',
          section_name: '吐司',
          description: null,
          price_minor: 60,
          available: true,
          sold_out: false,
        },
        {
          id: 'hidden-private',
          tenant_id: 'pu',
          location_id: 'private',
          name: '內部套餐',
          section_name: null,
          description: null,
          price_minor: 80,
          available: true,
          sold_out: false,
        },
        {
          id: 'secret',
          tenant_id: 'cgu',
          location_id: 'other',
          name: '他校套餐',
          section_name: null,
          description: null,
          price_minor: 90,
          available: true,
          sold_out: false,
        },
      ],
    }),
  );
  const pu = await service.list('pu');
  assert.equal(pu.schoolId, 'pu');
  assert.equal(pu.cafeterias.length, 1);
  assert.equal(pu.cafeterias[0].name, '校內咖啡店');
  assert.equal(pu.menus[0].name, '蔬菜吐司');
  assert.equal(
    pu.menus.some((row) => row.id === 'hidden-private'),
    false,
  );
  catalog.assertNoPrivateCafeteriaFields(pu.cafeterias);
  catalog.assertNoPrivateCafeteriaFields(pu.menus);
  const cgu = await service.list('cgu');
  assert.deepEqual(
    cgu.cafeterias.map((row) => row.id),
    ['other'],
  );
  assert.equal(
    pu.cafeterias.some((row) => row.id === 'other' || row.schoolId === 'cgu'),
    false,
  );
  const closed = await service.list('ntu');
  assert.deepEqual(closed, { schoolId: 'ntu', cafeterias: [], menus: [] });
});
