const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { PublicCafeteriaService, resetPublicCafeteriaCache } = require(
  join(process.env.PUBLIC_CAFETERIA_COMPILED, 'service.js'),
);
const catalog = require(join(process.env.PUBLIC_CAFETERIA_COMPILED, 'cafeteriaCatalog.js'));

if (!process.env.PUBLIC_CAFETERIA_TEST_DATABASE_URL) {
  test(
    'PostgreSQL integration requires PUBLIC_CAFETERIA_TEST_DATABASE_URL',
    { skip: true },
    () => {},
  );
} else {
  const { Pool } = require(
    process.env.PUBLIC_CAFETERIA_TEST_DEPS
      ? join(process.env.PUBLIC_CAFETERIA_TEST_DEPS, 'pg')
      : 'pg',
  );
  const schema = `cafeteria_test_${randomUUID().replaceAll('-', '')}`;
  const control = new Pool({ connectionString: process.env.PUBLIC_CAFETERIA_TEST_DATABASE_URL });
  const pool = new Pool({
    connectionString: process.env.PUBLIC_CAFETERIA_TEST_DATABASE_URL,
    options: `-c search_path=${schema},public`,
    max: 8,
  });
  const db = {
    query(sql, params) {
      return pool.query(sql, params);
    },
  };
  const service = new PublicCafeteriaService(db);

  before(async () => {
    await control.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`
      CREATE TABLE tenants (id text PRIMARY KEY, state text NOT NULL);
      CREATE TABLE food_locations (
        tenant_id text NOT NULL REFERENCES tenants(id),
        id text NOT NULL,
        name text NOT NULL,
        zone_label text,
        description text,
        merchant_mode text,
        status text NOT NULL,
        public_access boolean NOT NULL DEFAULT false,
        source_url text,
        external_order_url text,
        source_label text,
        source_updated_at date,
        contact_name text,
        phone text,
        email text,
        review_notes text,
        reviewer_id text,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE food_menu_versions (
        tenant_id text NOT NULL,
        id text NOT NULL,
        location_id text NOT NULL,
        state text NOT NULL,
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, location_id) REFERENCES food_locations(tenant_id, id)
      );
      CREATE TABLE food_menu_items (
        tenant_id text NOT NULL,
        id text NOT NULL,
        menu_version_id text NOT NULL,
        name text NOT NULL,
        section_name text,
        description text,
        price_minor integer,
        available boolean,
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, menu_version_id) REFERENCES food_menu_versions(tenant_id, id)
      );
      CREATE TABLE food_orders (
        tenant_id text NOT NULL,
        id text NOT NULL,
        total integer,
        PRIMARY KEY (tenant_id, id)
      );
    `);
  });

  after(async () => {
    await pool.end();
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await control.end();
  });

  async function seed() {
    resetPublicCafeteriaCache();
    await pool.query('DELETE FROM food_menu_items');
    await pool.query('DELETE FROM food_menu_versions');
    await pool.query('DELETE FROM food_locations');
    await pool.query('DELETE FROM tenants');
    await pool.query(
      "INSERT INTO tenants VALUES ('pu','open'), ('cgu','open'), ('ntu','provisioned')",
    );
    await pool.query(
      `INSERT INTO food_locations
        (tenant_id, id, name, zone_label, merchant_mode, status, public_access,
         contact_name, phone, email, review_notes, reviewer_id)
       VALUES
        ('pu','stall','校內咖啡店','學生餐廳','info_only','open',true,'店長','04-111','a@b.test','內部備註','op-1'),
        ('pu','private','內部餐廳',null,'info_only','open',false,'店長','04-000','p@b.test','私有','op-1'),
        ('pu','closed','已打烊',null,'info_only','closed',true,'店長','04-222','c@b.test','打烊','op-1'),
        ('pu','suspended','停業',null,'info_only','suspended',true,'店長','04-333','s@b.test','停業','op-1'),
        ('cgu','stall','他校同名店',null,'info_only','open',true,'別人','02-222','c@d.test','別校備註','op-2')`,
    );
    await pool.query(
      `INSERT INTO food_menu_versions (tenant_id, id, location_id, state)
       VALUES ('pu','menu-pu','stall','published'),
              ('pu','menu-private','private','published'),
              ('pu','menu-closed','closed','published'),
              ('pu','menu-suspended','suspended','published'),
              ('pu','draft-pu','stall','draft'),
              ('cgu','menu-pu','stall','published')`,
    );
    await pool.query(
      `INSERT INTO food_menu_items (tenant_id, id, menu_version_id, name, section_name, price_minor, available)
       VALUES ('pu','toast','menu-pu','蔬菜吐司','吐司',60,true),
              ('pu','secret-private','menu-private','內部套餐',null,70,true),
              ('pu','secret-closed','menu-closed','打烊套餐',null,80,true),
              ('pu','secret-suspended','menu-suspended','停業套餐',null,85,true),
              ('pu','hidden','draft-pu','未上架',null,1,true),
              ('cgu','toast','menu-pu','他校吐司',null,90,true)`,
    );
  }

  test('postgres catalog is school-scoped, hides ineligible locations/menus, isolates composite ids', async () => {
    await seed();
    const pu = await service.list('pu');
    assert.equal(pu.cafeterias.length, 1);
    assert.equal(pu.cafeterias[0].id, 'stall');
    assert.equal(pu.cafeterias[0].reviewStatus, 'unverified');
    assert.equal(pu.menus.length, 1);
    assert.equal(pu.menus[0].id, 'toast');
    assert.equal(pu.menus[0].price, 60);
    assert.equal(
      pu.cafeterias.some((row) => ['private', 'closed', 'suspended'].includes(row.id)),
      false,
    );
    assert.equal(
      pu.menus.some((row) =>
        ['secret-private', 'secret-closed', 'secret-suspended', 'hidden'].includes(row.id),
      ),
      false,
    );
    catalog.assertNoPrivateCafeteriaFields(pu.cafeterias);
    catalog.assertNoPrivateCafeteriaFields(pu.menus);

    const cgu = await service.list('cgu');
    assert.equal(cgu.cafeterias.length, 1);
    assert.equal(cgu.cafeterias[0].id, 'stall');
    assert.equal(cgu.cafeterias[0].name, '他校同名店');
    assert.equal(cgu.menus[0].id, 'toast');
    assert.equal(cgu.menus[0].name, '他校吐司');
    assert.equal(cgu.menus[0].price, 90);
    assert.equal(pu.cafeterias[0].name, '校內咖啡店');
    assert.equal(pu.menus[0].name, '蔬菜吐司');
    assert.deepEqual(await service.list('ntu'), { schoolId: 'ntu', cafeterias: [], menus: [] });
  });
}
