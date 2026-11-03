import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { bindProvidencePublicCatalog } = await import(
  pathToFileURL(join(process.env.PLATFORM_AGENT_COMPILED, 'production-catalog.js')).href
);
const source = { retrievedAt: '2026-10-19', mapDataLabel: 'OpenStreetMap 貢獻者' };
const place = {
  id: 'a',
  name: '甲樓',
  lat: 24,
  lng: 120,
  sourceUrl: 'https://www.openstreetmap.org/way/123',
  verification: 'cross-checked',
};
test('public catalog is server-owned, projected and isolated from caller mutation', async () => {
  const read = bindProvidencePublicCatalog(source, [
    place,
    { ...place, id: 'b', verification: 'single-source' },
  ]);
  const first = await read('pu', new AbortController().signal);
  assert.equal(first.places.length, 1);
  assert.equal('verification' in first.places[0], false);
  first.places[0].name = 'tampered';
  assert.equal((await read('pu', new AbortController().signal)).places[0].name, '甲樓');
  await assert.rejects(read('other', new AbortController().signal), {
    code: 'PUBLIC_AGENT_SOURCE_UNAVAILABLE',
  });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(read('pu', abort.signal), { code: 'PUBLIC_AGENT_SOURCE_UNAVAILABLE' });
});
test('lookalike source hostname and invalid coordinates fail closed', () => {
  for (const bad of [
    { ...place, sourceUrl: 'https://wwwXopenstreetmapYorg/way/123' },
    { ...place, lat: 200 },
  ])
    assert.throws(() => bindProvidencePublicCatalog(source, [bad]));
});
