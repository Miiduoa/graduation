import React from 'react';
import { FlatList, Modal } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import * as service from '../../src/services/titleSearch';
import { TitleHistoryLauncher } from '../../src/screens/social/TitleHistorySearch';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

let mockDb;
let mockUser = { uid: 'alice' };
let mockSchool = 'pu';
let mockLoading = false;
jest.mock('../../src/firebase', () => ({
  getDb: () => { if (!mockDb) throw new Error('Isolated test database is not ready'); return mockDb; },
  isFirebaseMockMode: () => false,
}));
jest.mock('../../src/state/auth', () => ({ useAuth: () => ({ user: mockUser, loading: mockLoading }) }));
jest.mock('../../src/state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../../src/services/demoSession', () => ({ isDemoUid: () => false }));
jest.mock('../../src/ui/useThemeStyleSheet', () => ({ useThemeStyleSheet: (factory) => factory() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const projectId = 'demo-campus-native-title-ui';
const host = process.env.FIRESTORE_EMULATOR_HOST || '';
const match = /^(127\.0\.0\.1|localhost):([0-9]{1,5})$/.exec(host);
if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error('Refusing cloud access: use the dedicated demo-campus-native-title-ui localhost emulator.');
}
const root = path.resolve(__dirname, '../../../..');
const output = path.join(root, 'artifacts/mobile-title-integration');
const report = {
  requestedHead: process.env.SOURCE_HEAD_SHA || '',
  checkout: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  projectId,
  boundary: 'Actual native React component -> actual native service -> real Firebase client -> repository rules in localhost emulator. Expo native hosts, identity hooks, theme and safe-area are test adapters; not a device, native renderer, Firebase Auth or full app E2E.',
  sources: {}, flows: [],
};
const realSearch = service.searchCampusPostTitles;
let environment;
let search;
let clients = [];

function client(uid) {
  const db = environment.authenticatedContext(uid).firestore();
  clients.push(db);
  return db;
}
function launch(onOpenPost = jest.fn()) {
  const view = render(<TitleHistoryLauncher onOpenPost={onOpenPost} />);
  fireEvent.press(view.getByLabelText('找舊貼文'));
  return { view, onOpenPost };
}
function submit(view, text = '二手書') {
  fireEvent.changeText(view.getByLabelText('記得的標題開頭'), text);
  fireEvent.press(view.getByLabelText('搜尋歷史標題'));
}
function rows(view) { return view.UNSAFE_getByType(FlatList).props.data; }
async function count(view, size) {
  await view.findByText(new RegExp(`目前顯示 ${size} 篇`), {}, { timeout: 10000 });
  expect(rows(view)).toHaveLength(size);
}
async function membership(status) {
  await environment.withSecurityRulesDisabled((context) =>
    context.firestore().doc('schools/pu/members/alice').update({ status }));
}
function record(detail = {}) { report.flows.push({ name: expect.getState().currentTestName, ...detail }); }

beforeAll(async () => {
  mkdirSync(path.join(output, 'source'), { recursive: true });
  for (const file of [
    'apps/mobile/src/screens/social/TitleHistorySearch.tsx',
    'apps/mobile/src/services/titleSearch.ts',
    'packages/shared/src/communityTitleSearch.ts',
    'backend/firestore/firestore.rules',
    'apps/mobile/jest.title-history-integration.config.cjs',
    'apps/mobile/integration/title-history/setup.cjs',
    'apps/mobile/integration/title-history/TitleHistorySearch.emulator.test.jsx',
    '.github/workflows/campus-mobile-title-history.yml',
  ]) {
    const bytes = readFileSync(path.join(root, file));
    report.sources[file] = createHash('sha256').update(bytes).digest('hex');
    const destination = path.join(output, 'source', file);
    mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, bytes);
  }
  // Fail rather than silently accepting the project's global Firebase mocks.
  expect(jest.isMockFunction(sdk.getDocsFromServer)).toBe(false);
  expect(jest.isMockFunction(sdk.query)).toBe(false);
  expect(jest.isMockFunction(realSearch)).toBe(false);
  environment = await initializeTestEnvironment({ projectId, firestore: {
    host: match[1], port: Number(match[2]),
    rules: readFileSync(path.join(root, 'backend/firestore/firestore.rules'), 'utf8'),
  } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const documents = [
      ['users/alice', { schoolId: 'pu', status: 'active' }],
      ['users/bob', { schoolId: 'pu', status: 'active' }],
      ['users/charlie', { schoolId: 'other', status: 'active' }],
      ['schools/pu/members/alice', { status: 'active', role: 'student' }],
      ['schools/pu/members/bob', { status: 'active', role: 'student' }],
      ['schools/other/members/charlie', { status: 'active', role: 'student' }],
    ];
    for (let i = 0; i < 1000; i += 1) documents.push([`schools/pu/campusPosts/recent-${i}`, {
      schoolId: 'pu', title: `近期活動 ${i}`, content: '二手書只在內文', createdAt: new Date(1800000000000 + i),
    }]);
    for (let i = 0; i < 45; i += 1) documents.push([`schools/pu/campusPosts/old-${String(i).padStart(3, '0')}`, {
      schoolId: 'pu', title: i === 44 ? '二手書📚' : `二手書 ${String(Math.floor(i / 3)).padStart(2, '0')}`,
      content: '舊學期課本', anonymous: true, createdAt: new Date(1600000000000),
    }]);
    documents.push(['schools/pu/campusPosts/rental', { schoolId: 'pu', title: '租屋 期末套房', content: '', anonymous: false }]);
    documents.push(['schools/other/campusPosts/private', { schoolId: 'other', title: '二手書 他校', content: '', anonymous: true }]);
    for (let offset = 0; offset < documents.length; offset += 400) {
      const batch = db.batch();
      for (const [name, data] of documents.slice(offset, offset + 400)) batch.set(db.doc(name), data);
      await batch.commit();
    }
  });
}, 60000);

beforeEach(async () => {
  mockUser = { uid: 'alice' }; mockSchool = 'pu'; mockLoading = false;
  clients = []; mockDb = client('alice');
  await membership('active');
  // This spy only observes calls and promises; it does not replace the implementation.
  search = jest.spyOn(service, 'searchCampusPostTitles');
});
afterEach(async () => {
  cleanup();
  await Promise.all(clients.map((db) => sdk.enableNetwork(db)));
  if (search) {
    await Promise.allSettled(search.mock.results.filter((result) => result.type === 'return').map((result) => result.value));
    search.mockRestore();
  }
});
afterAll(async () => {
  try { await environment?.cleanup(); }
  finally {
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.info('NATIVE_TITLE_COMPONENT_INTEGRATION', JSON.stringify({ checkout: report.checkout, completedFlows: report.flows.length }));
  }
});

test('student searches 45 historical matches, pages without duplicates and opens a scoped post', async () => {
  const { view, onOpenPost } = launch(); submit(view);
  await count(view, 20);
  expect(rows(view).every((post) => post.id.startsWith('old-'))).toBe(true);
  const sizes = [rows(view).length];
  fireEvent.press(view.getByLabelText('載入更多歷史貼文')); await count(view, 40); sizes.push(rows(view).length);
  fireEvent.press(view.getByLabelText('載入更多歷史貼文')); await count(view, 45); sizes.push(rows(view).length);
  expect(new Set(rows(view).map((post) => post.id)).size).toBe(45);
  expect(view.queryByLabelText('載入更多歷史貼文')).toBeNull();
  fireEvent.press(view.getAllByLabelText('開啟貼文：二手書 00')[0]);
  expect(onOpenPost).toHaveBeenCalledWith({ id: 'old-000', schoolId: 'pu' });
  expect(view.queryByLabelText('記得的標題開頭')).toBeNull();
  record({ cumulativeResults: sizes, uniqueIds: 45, nonmatchingNewerFixtures: 1000 });
});

test('rapid result taps from the real SDK page navigate once', async () => {
  const { view, onOpenPost } = launch(); submit(view); await count(view, 20);
  const target = view.getAllByLabelText('開啟貼文：二手書 00')[0];
  act(() => {
    target.props.onPress();
    target.props.onPress();
  });
  expect(onOpenPost).toHaveBeenCalledTimes(1);
  expect(onOpenPost).toHaveBeenCalledWith({ id: 'old-000', schoolId: 'pu' });
  record({ serverConfirmedResults: 20, navigationCalls: 1 });
});

test('offline next page keeps existing results and retries the exact server cursor', async () => {
  const { view } = launch(); submit(view); await count(view, 20);
  const first = await search.mock.results[0].value;
  const ids = rows(view).map((post) => post.id);
  const cached = await sdk.getDocsFromCache(sdk.query(sdk.collection(mockDb, 'schools/pu/campusPosts'),
    sdk.orderBy('title', 'asc'), sdk.orderBy(sdk.documentId(), 'asc'), sdk.startAt('二手書'),
    sdk.endBefore(service.titlePrefixUpperBound('二手書')), sdk.limit(20)));
  expect(cached.size).toBe(20);
  await sdk.disableNetwork(mockDb);
  fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
  await view.findByLabelText('重試歷史搜尋', {}, { timeout: 10000 });
  await expect(search.mock.results[1].value).rejects.toMatchObject({ code: 'unavailable' });
  expect(rows(view).map((post) => post.id)).toEqual(ids);
  expect(view.queryByText('沒有符合這個標題開頭的貼文。')).toBeNull();
  await sdk.enableNetwork(mockDb);
  fireEvent.press(view.getByLabelText('重試歷史搜尋')); await count(view, 40);
  expect(search.mock.calls[1][2]).toBe(first.nextCursor);
  expect(search.mock.calls[2][2]).toBe(first.nextCursor);
  expect(new Set(rows(view).map((post) => post.id)).size).toBe(40);
  record({ cachedDocuments: cached.size, deniedCode: 'unavailable', restoredResults: 40 });
});

test('revoked membership removes rendered results; restored access restarts at page one', async () => {
  const { view } = launch(); submit(view); await count(view, 20);
  const ids = rows(view).map((post) => post.id);
  await membership('inactive');
  fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
  await view.findByText(/搜尋結果已清除/, {}, { timeout: 10000 });
  await expect(search.mock.results[1].value).rejects.toMatchObject({ code: 'permission-denied' });
  expect(rows(view)).toEqual([]);
  expect(view.queryByLabelText('載入更多歷史貼文')).toBeNull();
  await membership('active');
  fireEvent.press(view.getByLabelText('重試歷史搜尋')); await count(view, 20);
  expect(search.mock.calls[2][2]).toBeNull();
  expect(rows(view).map((post) => post.id)).toEqual(ids);
  record({ deniedCode: 'permission-denied', restoredFromFirstPage: true });
});

test('cross-school access is refused while that school member retains the normal search flow', async () => {
  mockSchool = 'other';
  const onOpenPost = jest.fn(); const { view } = launch(onOpenPost); submit(view);
  await view.findByText(/搜尋結果已清除/, {}, { timeout: 10000 });
  expect(rows(view)).toEqual([]);
  expect(view.queryByText('二手書 他校')).toBeNull();
  mockUser = { uid: 'charlie' }; mockDb = client('charlie');
  view.rerender(<TitleHistoryLauncher onOpenPost={onOpenPost} />);
  fireEvent.press(view.getByLabelText('找舊貼文')); submit(view); await count(view, 1);
  fireEvent.press(view.getByLabelText('開啟貼文：二手書 他校'));
  expect(onOpenPost).toHaveBeenCalledWith({ id: 'private', schoolId: 'other' });
  record({ crossSchoolDenied: true, ownSchoolResults: 1 });
});

test('editing during a genuine SDK request prevents its old results from replacing the new query', async () => {
  const { view } = launch(); submit(view);
  const pending = search.mock.results[0].value;
  fireEvent.changeText(view.getByLabelText('記得的標題開頭'), '租屋');
  await act(async () => { expect((await pending).posts).toHaveLength(20); });
  expect(rows(view)).toEqual([]);
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('租屋');
  fireEvent.press(view.getByLabelText('搜尋歷史標題')); await count(view, 1);
  expect(rows(view)[0].id).toBe('rental');
  record({ supersededRealResults: 20, currentResults: ['rental'] });
});

test.each(['account', 'school', 'signed-out', 'loading'])('a pending real query cannot reopen the old panel after %s changes', async (scope) => {
  const onOpenPost = jest.fn(); const { view } = launch(onOpenPost); submit(view);
  const pending = search.mock.results[0].value;
  if (scope === 'account') { mockUser = { uid: 'bob' }; mockDb = client('bob'); }
  if (scope === 'school') { mockSchool = 'other'; mockUser = { uid: 'charlie' }; mockDb = client('charlie'); }
  if (scope === 'signed-out') mockUser = null;
  if (scope === 'loading') mockLoading = true;
  view.rerender(<TitleHistoryLauncher onOpenPost={onOpenPost} />);
  expect(view.queryByLabelText('記得的標題開頭')).toBeNull();
  await act(async () => { expect((await pending).posts).toHaveLength(20); });
  expect(view.queryByLabelText('記得的標題開頭')).toBeNull();
  expect(onOpenPost).not.toHaveBeenCalled();
  record({ scope, discardedRealResults: 20 });
});

test.each(['close', 'native-back'])('closing via %s while the SDK is pending keeps the next session empty', async (method) => {
  const { view } = launch(); submit(view);
  const pending = search.mock.results[0].value;
  if (method === 'close') fireEvent.press(view.getByLabelText('關閉歷史搜尋'));
  else fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  await act(async () => { expect((await pending).posts).toHaveLength(20); });
  fireEvent.press(view.getByLabelText('找舊貼文'));
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('');
  expect(rows(view)).toEqual([]);
  record({ method, discardedRealResults: 20 });
});

test('a confirmed zero-match server response shows the empty result state', async () => {
  const { view } = launch(); submit(view, '不存在的標題');
  await view.findByText('沒有符合這個標題開頭的貼文。', {}, { timeout: 10000 });
  expect((await search.mock.results[0].value).posts).toEqual([]);
  expect(rows(view)).toEqual([]);
  record({ serverMatches: 0 });
});

test('an offline first search is an error rather than an empty success and recovers on retry', async () => {
  const { view } = launch(); await sdk.disableNetwork(mockDb); submit(view);
  await view.findByLabelText('重試歷史搜尋', {}, { timeout: 10000 });
  expect(view.queryByText('沒有符合這個標題開頭的貼文。')).toBeNull();
  await sdk.enableNetwork(mockDb);
  fireEvent.press(view.getByLabelText('重試歷史搜尋')); await count(view, 20);
  expect(search.mock.calls[1][2]).toBeNull();
  record({ restoredResults: 20 });
});
