const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { PublicCafeteriaService, resetPublicCafeteriaCache } = require(
  join(process.env.PUBLIC_CAFETERIA_COMPILED, 'service.js'),
);
const catalog = require(join(process.env.PUBLIC_CAFETERIA_COMPILED, 'cafeteriaCatalog.js'));

if (!process.env.PUBLIC_CAFETERIA_TEST_DATABASE_URL) {
  test('PostgreSQL integration requires PUBLIC_CAFETERIA_TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  const { Pool } = require(process.env.PUBLIC_CAFETERIA_TEST_DEPS ? join(process.env.PUBLIC_CAFETERIA_TEST_DEPS, 'pg') : 'pg');
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
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id),
        name text NOT NULL,
        zone_label text,
        opening_hours text,
        description text,
        merchant_mode text,
        review_status text NOT NULL DEFAULT 'unverified',
        source_url text,
        external_order_url text,
        source_label text,
        source_updated_at timestamptz,
        contact_name text,
        phone text,
        email text,
        review_notes text,
        reviewer_id text
      );
      CREATE TABLE food_menu_items (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id),
        location_id text NOT NULL REFERENCES food_locations(id),
        name text NOT NULL,
        section_name text,
        description text,
        price_minor integer,
        available boolean,
        sold_out boolean
      );
      CREATE TABLE food_orders (id text PRIMARY KEY, tenant_id text, total integer);
    `);
  });

  after(async () => {
    await pool.end();
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await control.end();
  });

  async function seed() {
    resetPublicCafeteriaCache();
    await pool.query("DELETE FROM food_menu_items");
    await pool.query("DELETE FROM food_locations");
    await pool.query("DELETE FROM tenants");
    await pool.query("INSERT INTO tenants VALUES ('pu','open'), ('cgu','open'), ('ntu','provisioned')");
    await pool.query(
      `INSERT INTO food_locations
        (id, tenant_id, name, zone_label, opening_hours, merchant_mode, review_status, contact_name, phone, email, review_notes, reviewer_id)
       VALUES
        ('stall','pu','校內咖啡店','學生餐廳','11:00–14:00','info_only','unverified','店長','04-111','a@b.test','內部備註','op-1'),
        ('other','cgu','他校餐廳',null,null,'info_only','verified','別人','02-222','c@d.test','別校備註','op-2')`,
    );
    await pool.query(
      `INSERT INTO food_menu_items (id, tenant_id, location_id, name, section_name, price_minor, available, sold_out)
       VALUES ('toast','pu','stall','蔬菜吐司','吐司',60,true,false),
              ('secret','cgu','other','他校套餐',null,90,true,false)`,
    );
  }

  test('postgres catalog is school-scoped, omits private columns, and hides closed schools', async () => {
    await seed();
    const pu = await service.list('pu');
    assert.equal(pu.cafeterias.length, 1);
    assert.equal(pu.cafeterias[0].id, 'stall');
    assert.equal(pu.menus[0].price, 60);
    catalog.assertNoPrivateCafeteriaFields(pu.cafeterias);
    catalog.assertNoPrivateCafeteriaFields(pu.menus);
    const cgu = await service.list('cgu');
    assert.equal(cgu.cafeterias[0].id, 'other');
    assert.equal(
      pu.cafeterias.some((row) => row.id === 'other'),
      false,
    );
    assert.deepEqual(await service.list('ntu'), { schoolId: 'ntu', cafeterias: [], menus: [] });
  });
}
