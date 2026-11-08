import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
assert.match(host, /^(localhost|127\.0\.0\.1):[0-9]{1,5}$/, 'Refusing non-local Firestore access');
const projectId = 'demo-campus-native-title';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Use the dedicated demo project');
const requireRoot = createRequire(path.join(root, 'package.json'));
const requireMobile = createRequire(path.join(root, 'apps/mobile/package.json'));
const { initializeTestEnvironment } = requireRoot('@firebase/rules-unit-testing');
const sdk = requireMobile('firebase/firestore');
const fixture = path.join(root, 'apps/mobile/.native-title-proof');
const output = path.join(root, 'artifacts/mobile-title-history');
const report = {
  checkout: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  requestedHead: process.env.SOURCE_HEAD_SHA || '',
  boundary: 'Native service compiled for Node; actual Firebase SDK and repository rules in localhost emulator. Not a native screen-to-backend or device test.',
  checks: [], failures: [], sources: {}, pages: [],
};
let environment;
await mkdir(fixture, { recursive: true });
await mkdir(path.join(output, 'source'), { recursive: true });
async function check(name, run) {
  try { await run(); report.checks.push(name); }
  catch (error) { report.failures.push({ name, error: String(error?.stack || error) }); }
}
try {
  const sourcePaths = [
    'apps/mobile/src/services/titleSearch.ts',
    'apps/mobile/src/services/feed.ts',
    'apps/mobile/src/screens/social/PostDetailScreen.tsx',
    'apps/mobile/src/__tests__/PostDetailRecovery.test.tsx',
    'apps/mobile/src/screens/social/TitleHistorySearch.tsx',
    'apps/mobile/src/screens/CommunityScreen.tsx',
    'apps/mobile/src/__tests__/TitleHistorySearch.test.tsx',
    'packages/shared/src/communityTitleSearch.ts',
    'apps/web/src/lib/community/titleSearch.ts',
    'backend/firestore/firestore.rules',
  ];
  for (const file of sourcePaths) {
    const bytes = await readFile(path.join(root, file));
    report.sources[file] = createHash('sha256').update(bytes).digest('hex');
    const destination = path.join(output, 'source', file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const servicePath = path.join(root, 'apps/mobile/src/services/titleSearch.ts');
  const adapter = path.join(fixture, 'firebase.ts');
  await writeFile(adapter, 'export function getDb() { return globalThis.__nativeTitleProofDb; }\n');
  const bundled = path.join(fixture, 'service.cjs');
  await build({
    absWorkingDir: root, entryPoints: [servicePath], outfile: bundled,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    external: ['firebase/*'], alias: { '@campus/shared': path.join(root, 'packages/shared') },
    plugins: [{ name: 'isolated-native-db', setup(builder) {
      builder.onResolve({ filter: /^\.\.\/firebase$/ }, (args) => args.importer === servicePath ? { path: adapter } : undefined);
    } }],
  });
  const { searchCampusPostTitles } = requireMobile(bundled);
  // Verify the same server-only detail reader used after opening a search result.
  const feedPath = path.join(root, 'apps/mobile/src/services/feed.ts');
  const feedBundle = path.join(fixture, 'feed.cjs');
  await build({
    absWorkingDir: root, entryPoints: [feedPath], outfile: feedBundle,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    external: ['firebase/*'],
    plugins: [{ name: 'isolated-native-feed-db', setup(builder) {
      builder.onResolve({ filter: /^\\.\\.\\/firebase$/ }, (args) => args.importer === feedPath ? { path: adapter } : undefined);
    } }],
  });
  const { getCampusPostById } = requireMobile(feedBundle);
  const [hostname, port] = host.split(':');
  environment = await initializeTestEnvironment({ projectId, firestore: {
    host: hostname, port: Number(port), rules: await readFile(path.join(root, 'backend/firestore/firestore.rules'), 'utf8'),
  } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const rows = [
      ['users/alice', { schoolId: 'pu', status: 'active' }],
      ['users/charlie', { schoolId: 'other', status: 'active' }],
      ['schools/pu/members/alice', { status: 'active', role: 'student' }],
      ['schools/other/members/charlie', { status: 'active', role: 'student' }],
    ];
    for (let i = 0; i < 1000; i += 1) rows.push([`schools/pu/campusPosts/recent-${i}`, {
      schoolId: 'pu', title: `近期活動 ${i}`, content: '二手書只在內文出現', createdAt: new Date(1800000000000 + i),
    }]);
    for (let i = 0; i < 45; i += 1) rows.push([`schools/pu/campusPosts/old-${String(i).padStart(3, '0')}`, {
      schoolId: 'pu', title: i === 44 ? '二手書📚' : `二手書 ${Math.floor(i / 3)}`,
      content: '舊課本'.repeat(100), anonymous: true, authorUid: 'not-for-card', mediaUrls: ['never-load-media'],
      createdAt: new Date(1600000000000),
    }]);
    rows.push(['schools/pu/campusPosts/upper', { schoolId: 'pu', title: 'AI project', content: '' }]);
    rows.push(['schools/pu/campusPosts/lower', { schoolId: 'pu', title: 'ai project', content: '' }]);
    rows.push(['schools/other/campusPosts/private', { schoolId: 'other', title: '二手書 他校', content: '' }]);
    for (let offset = 0; offset < rows.length; offset += 400) {
      const batch = db.batch();
      for (const [name, data] of rows.slice(offset, offset + 400)) batch.set(db.doc(name), data);
      await batch.commit();
    }
  });
  const alice = environment.authenticatedContext('alice').firestore();
  globalThis.__nativeTitleProofDb = alice;
  await check('native query finds all 45 old matches without traversing 1000 recent nonmatches', async () => {
    const ids = []; const sizes = []; let cursor = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const page = await searchCampusPostTitles('pu', '二手書', cursor);
      sizes.push(page.posts.length); ids.push(...page.posts.map((post) => post.id));
      assert.ok(page.posts.every((post) => post.schoolId === 'pu' && post.id.startsWith('old-')));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    assert.deepEqual(sizes, [20, 20, 5]); assert.equal(new Set(ids).size, 45); assert.ok(ids.includes('old-044'));
    report.pages = sizes; report.uniquePosts = new Set(ids).size;
  });
  await check('case-sensitive title prefixes do not match body text or substrings', async () => {
    assert.deepEqual((await searchCampusPostTitles('pu', 'AI')).posts.map((post) => post.id), ['upper']);
    assert.deepEqual((await searchCampusPostTitles('pu', 'ai')).posts.map((post) => post.id), ['lower']);
    assert.deepEqual((await searchCampusPostTitles('pu', '課本')).posts, []);
    assert.deepEqual((await searchCampusPostTitles('pu', '手書')).posts, []);
  });
  await check('native card model omits author/media and caps the excerpt', async () => {
    const page = await searchCampusPostTitles('pu', '二手書');
    assert.ok(page.posts.length > 0);
    for (const post of page.posts) {
      assert.deepEqual(Object.keys(post).sort(), ['anonymous', 'excerpt', 'id', 'schoolId', 'title']);
      assert.equal(Array.from(post.excerpt).length, 160);
    }
  });
  await check('offline continuation rejects despite cache; reconnect retries the same page', async () => {
    const first = await searchCampusPostTitles('pu', '二手書');
    const expected = await searchCampusPostTitles('pu', '二手書', first.nextCursor);
    await sdk.disableNetwork(alice);
    try { await assert.rejects(searchCampusPostTitles('pu', '二手書', first.nextCursor), { code: 'unavailable' }); }
    finally { await sdk.enableNetwork(alice); }
    assert.deepEqual((await searchCampusPostTitles('pu', '二手書', first.nextCursor)).posts, expected.posts);
  });
  await check('membership revoked between pages is refused; restored student can continue', async () => {
    const first = await searchCampusPostTitles('pu', '二手書');
    const status = (value) => environment.withSecurityRulesDisabled((context) => context.firestore().doc('schools/pu/members/alice').update({ status: value }));
    await status('inactive');
    try { await assert.rejects(searchCampusPostTitles('pu', '二手書', first.nextCursor), { code: 'permission-denied' }); }
    finally { await status('active'); }
    assert.equal((await searchCampusPostTitles('pu', '二手書', first.nextCursor)).posts.length, 20);
  });
  await check('an authorized student cannot search the other school', async () => {
    await assert.rejects(searchCampusPostTitles('other', '二手書'), { code: 'permission-denied' });
  });
  await check('a guest cannot search the school', async () => {
    globalThis.__nativeTitleProofDb = environment.unauthenticatedContext().firestore();
    try { await assert.rejects(searchCampusPostTitles('pu', '二手書'), { code: 'permission-denied' }); }
    finally { globalThis.__nativeTitleProofDb = alice; }
  });
  await check('the other school member can still find their own post', async () => {
    globalThis.__nativeTitleProofDb = environment.authenticatedContext('charlie').firestore();
    try { assert.deepEqual((await searchCampusPostTitles('other', '二手書')).posts.map((post) => post.id), ['private']); }
    finally { globalThis.__nativeTitleProofDb = alice; }
  });
  await check('cross-school and cross-query cursors are rejected before querying', async () => {
    const first = await searchCampusPostTitles('pu', '二手書');
    await assert.rejects(searchCampusPostTitles('other', '二手書', first.nextCursor), { code: 'invalid-argument' });
    await assert.rejects(searchCampusPostTitles('pu', 'AI', first.nextCursor), { code: 'invalid-argument' });
  });
  await check('a removed cursor document does not make the next page repeat prior posts', async () => {
    const first = await searchCampusPostTitles('pu', '二手書');
    await environment.withSecurityRulesDisabled((context) => context.firestore().doc(`schools/pu/campusPosts/${first.nextCursor.document.id}`).delete());
    const next = await searchCampusPostTitles('pu', '二手書', first.nextCursor);
    assert.equal(next.posts.length, 20);
    const prior = new Set(first.posts.map((post) => post.id));
    assert.ok(next.posts.every((post) => !prior.has(post.id)));
  });
  await check('native post detail uses server confirmation even with an offline cached document', async () => {
    assert.equal((await getCampusPostById('pu', 'old-001'))?.id, 'old-001');
    await sdk.disableNetwork(alice);
    try { await assert.rejects(getCampusPostById('pu', 'old-001'), { code: 'unavailable' }); }
    finally { await sdk.enableNetwork(alice); }
    assert.equal((await getCampusPostById('pu', 'old-001'))?.schoolId, 'pu');
  });
  await check('native post detail denies a revoked member and recovers for an active student', async () => {
    const setStatus = (value) => environment.withSecurityRulesDisabled((context) =>
      context.firestore().doc('schools/pu/members/alice').update({ status: value }));
    await setStatus('inactive');
    try { await assert.rejects(getCampusPostById('pu', 'old-001'), { code: 'permission-denied' }); }
    finally { await setStatus('active'); }
    assert.equal((await getCampusPostById('pu', 'old-001'))?.id, 'old-001');
  });
  await check('native post detail returns no deleted document and refuses the other school', async () => {
    await environment.withSecurityRulesDisabled((context) =>
      context.firestore().doc('schools/pu/campusPosts/old-001').delete());
    assert.equal(await getCampusPostById('pu', 'old-001'), null);
    await assert.rejects(getCampusPostById('other', 'private'), { code: 'permission-denied' });
  });
} catch (error) {
  report.failures.push({ name: 'setup or execution', error: String(error?.stack || error) });
} finally {
  await environment?.cleanup();
  delete globalThis.__nativeTitleProofDb;
  await rm(fixture, { recursive: true, force: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('NATIVE_TITLE_HISTORY', JSON.stringify({ checkout: report.checkout, passed: report.checks.length, failures: report.failures, pages: report.pages }));
  if (report.failures.length) process.exitCode = 1;
}
