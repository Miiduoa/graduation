import React from 'react';
import { FlatList, Modal } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
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
  getDb: () => { if (!mockDb) throw new Error('Isolated database is not ready'); return mockDb; },
  isFirebaseMockMode: () => false,
}));
jest.mock('../../src/state/auth', () => ({ useAuth: () => ({ user: mockUser, loading: mockLoading }) }));
jest.mock('../../src/state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../../src/services/demoSession', () => ({ isDemoUid: () => false }));
jest.mock('../../src/ui/useThemeStyleSheet', () => ({ useThemeStyleSheet: (factory) => factory() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const projectId = 'demo-campus-native-title-ui';
const match = /^(127\.0\.0\.1|localhost):([0-9]{1,5})$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '');
if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error('Resume verification requires the dedicated localhost demo emulator.');
}
const root = path.resolve(__dirname, '../../../..');
const output = path.join(root, 'artifacts/mobile-title-integration');
const report = {
  requestedHead: process.env.SOURCE_HEAD_SHA || '',
  checkout: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  boundary: 'React Native JS component and real service/SDK/rules emulator. Native hosts and identity hooks are adapters; not device navigation, pixel scroll restoration or production Auth.',
  sources: {}, flows: [],
};
let environment;
let clients = [];
let search;
let resume;
const rows = (view) => view.UNSAFE_getByType(FlatList).props.data;
const count = async (view, size) => {
  await view.findByText(new RegExp(`目前顯示 ${size} 篇`), {}, { timeout: 10000 });
  expect(rows(view)).toHaveLength(size);
};
const record = (detail = {}) => report.flows.push({ name: expect.getState().currentTestName, ...detail });
const membership = (status) => environment.withSecurityRulesDisabled((context) =>
  context.firestore().doc('schools/pu/members/alice').update({ status }));
function client(uid) {
  const db = environment.authenticatedContext(uid).firestore(); clients.push(db); return db;
}
async function returnedPanel() {
  const onOpenPost = jest.fn();
  const view = render(<TitleHistoryLauncher onOpenPost={onOpenPost} />);
  fireEvent.press(view.getByLabelText('找舊貼文'));
  fireEvent.changeText(view.getByLabelText('記得的標題開頭'), '二手書');
  fireEvent.press(view.getByLabelText('搜尋歷史標題'));
  await count(view, 20);
  fireEvent.press(view.getAllByLabelText('開啟貼文：二手書 01')[1]);
  await waitFor(() => expect(onOpenPost).toHaveBeenCalledWith({ id: 'old-004', schoolId: 'pu' }));
  fireEvent.press(view.getByLabelText('找舊貼文'));
  return { view, onOpenPost };
}

beforeAll(async () => {
  mkdirSync(path.join(output, 'source'), { recursive: true });
  for (const file of [
    'apps/mobile/src/screens/social/TitleHistorySearch.tsx',
    'apps/mobile/src/services/titleSearch.ts',
    'apps/mobile/integration/title-history/TitleHistoryResume.emulator.test.jsx',
    'apps/mobile/jest.title-history-integration.config.cjs',
    'packages/shared/src/communityTitleSearch.ts',
    'backend/firestore/firestore.rules',
    '.github/workflows/campus-mobile-title-history.yml',
  ]) {
    const bytes = readFileSync(path.join(root, file));
    report.sources[file] = createHash('sha256').update(bytes).digest('hex');
    const destination = path.join(output, 'source', file);
    mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, bytes);
  }
  expect(jest.isMockFunction(sdk.getDocsFromServer)).toBe(false);
  expect(jest.isMockFunction(sdk.getDocFromServer)).toBe(false);
  environment = await initializeTestEnvironment({ projectId, firestore: {
    host: match[1], port: Number(match[2]), rules: readFileSync(path.join(root, 'backend/firestore/firestore.rules'), 'utf8'),
  } });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const documents = [
      ['users/alice', { schoolId: 'pu', status: 'active' }],
      ['users/charlie', { schoolId: 'other', status: 'active' }],
      ['schools/pu/members/alice', { status: 'active', role: 'student' }],
      ['schools/other/members/charlie', { status: 'active', role: 'student' }],
    ];
    for (let i = 0; i < 1000; i += 1) documents.push([`schools/pu/campusPosts/recent-${i}`, {
      schoolId: 'pu', title: `近期活動 ${i}`, content: '不符標題的新文章', createdAt: new Date(1800000000000 + i),
    }]);
    for (let i = 0; i < 85; i += 1) documents.push([`schools/pu/campusPosts/old-${String(i).padStart(3, '0')}`, {
      schoolId: 'pu', title: `二手書 ${String(Math.floor(i / 3)).padStart(2, '0')}`,
      content: '舊課本', anonymous: true, createdAt: new Date(1600000000000),
    }]);
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
  clients = []; mockDb = client('alice'); await membership('active');
  search = jest.spyOn(service, 'searchCampusPostTitles');
  resume = jest.spyOn(service, 'resumeCampusPostTitles');
});
afterEach(async () => {
  cleanup();
  await Promise.all(clients.map((db) => sdk.enableNetwork(db)));
  await Promise.allSettled([search, resume].flatMap((spy) => spy.mock.results.filter((item) => item.type === 'return').map((item) => item.value)));
  jest.restoreAllMocks();
});
afterAll(async () => {
  try { await environment?.cleanup(); }
  finally { writeFileSync(path.join(output, 'resume-report.json'), JSON.stringify(report, null, 2)); }
});

test('returning student explicitly resumes at the last opened post using newly authorized results', async () => {
  const { view } = await returnedPanel();
  expect(rows(view)).toEqual([]);
  expect(search).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('回到上次閱讀位置'));
  await count(view, 20);
  expect(rows(view)[0].id).toBe('old-004');
  expect(rows(view).some((post) => post.id === 'old-003')).toBe(false);
  expect(search).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('載入更多歷史貼文'));
  await count(view, 40);
  expect(new Set(rows(view).map((post) => post.id)).size).toBe(40);
  record({ anchor: 'old-004', staleRowsBeforeResume: 0, newlyAuthorizedPages: [20, 20] });
});

async function changeAnchor(run) {
  const reference = 'schools/pu/campusPosts/old-004';
  let saved;
  await environment.withSecurityRulesDisabled(async (context) => {
    const doc = context.firestore().doc(reference); saved = (await doc.get()).data(); await run(doc);
  });
  return () => environment.withSecurityRulesDisabled((context) => context.firestore().doc(reference).set(saved));
}

test('fresh snapshot resumes inside a title tie without traversing preceding matching pages', async () => {
  const page = await service.resumeCampusPostTitles('pu', '二手書', 'old-064');
  expect(page.posts.map((post) => post.id)).toEqual(Array.from({ length: 20 }, (_, i) => `old-${String(i + 64).padStart(3, '0')}`));
  expect(page.hasMore).toBe(true);
  const last = await service.searchCampusPostTitles('pu', '二手書', page.nextCursor);
  expect(last.posts.map((post) => post.id)).toEqual(['old-084']);
  expect(last.hasMore).toBe(false);
  record({ anchor: 'old-064', matchingFixtures: 85, nonmatchingFixtures: 1000, pageSizes: [20, 1] });
});

test('offline resume rejects a cached anchor and retries the same ID with fresh content', async () => {
  const { view } = await returnedPanel();
  expect((await sdk.getDocFromCache(sdk.doc(mockDb, 'schools/pu/campusPosts/old-004'))).exists()).toBe(true);
  await sdk.disableNetwork(mockDb);
  let restore;
  try {
    fireEvent.press(view.getByLabelText('回到上次閱讀位置'));
    await view.findByLabelText('重試歷史搜尋', {}, { timeout: 10000 });
    expect(rows(view)).toEqual([]);
    expect(view.queryByText(/目前無法定位/)).toBeNull();
    restore = await changeAnchor((doc) => doc.update({ content: '伺服器剛更新的內容' }));
    await sdk.enableNetwork(mockDb);
    fireEvent.press(view.getByLabelText('重試歷史搜尋'));
    await count(view, 20);
    expect(resume.mock.calls).toEqual([['pu', '二手書', 'old-004'], ['pu', '二手書', 'old-004']]);
    expect(rows(view)[0]).toMatchObject({ id: 'old-004', excerpt: '伺服器剛更新的內容' });
    record({ cacheConfirmed: true, staleRowsShown: 0, retryAnchor: 'old-004', freshContent: true });
  } finally { await sdk.enableNetwork(mockDb); await restore?.(); }
});

test.each(['deleted', 'retitled'])('a %s anchor is not replaced by its neighbour and offers a fresh first-page search', async (reason) => {
  const { view } = await returnedPanel();
  const restore = await changeAnchor((doc) => reason === 'deleted' ? doc.delete() : doc.update({ title: '租屋 已改標題' }));
  try {
    fireEvent.press(view.getByLabelText('回到上次閱讀位置'));
    await view.findByText(/目前無法定位上次閱讀的貼文/, {}, { timeout: 10000 });
    expect(rows(view)).toEqual([]);
    expect(view.queryByLabelText('回到上次閱讀位置')).toBeNull();
    fireEvent.press(view.getByLabelText('搜尋歷史標題'));
    await count(view, 20);
    expect(rows(view)[0].id).toBe('old-000');
    expect(rows(view).some((post) => post.id === 'old-004')).toBe(false);
    record({ reason, wrongNeighbourSelected: false, restartFrom: 'old-000' });
  } finally { await restore(); }
});

test('revocation while reading refuses resume; restored membership restarts from the first page', async () => {
  const { view } = await returnedPanel(); await membership('inactive');
  try {
    fireEvent.press(view.getByLabelText('回到上次閱讀位置'));
    await view.findByText(/搜尋結果已清除/, {}, { timeout: 10000 });
    expect(rows(view)).toEqual([]);
    expect(view.queryByLabelText('回到上次閱讀位置')).toBeNull();
    await membership('active');
    fireEvent.press(view.getByLabelText('重試歷史搜尋')); await count(view, 20);
    expect(rows(view)[0].id).toBe('old-000');
    expect(resume).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenLastCalledWith('pu', '二手書', null);
    record({ revokedRows: 0, restoredFromFirstPage: true });
  } finally { await membership('active'); }
});

test('cross-school resume is refused while the other school member keeps their legitimate flow', async () => {
  await expect(service.resumeCampusPostTitles('other', '二手書', 'private')).rejects.toMatchObject({ code: 'permission-denied' });
  mockDb = client('charlie');
  await expect(service.resumeCampusPostTitles('other', '二手書', 'private')).resolves.toMatchObject({ posts: [{ id: 'private', schoolId: 'other' }] });
  await expect(service.resumeCampusPostTitles('pu', '二手書', 'old-064')).rejects.toMatchObject({ code: 'permission-denied' });
  record({ crossSchoolDenied: true, otherSchoolMemberAllowed: true });
});

test('invalid IDs and changed query scope cannot be used as a remembered cursor', async () => {
  await expect(service.resumeCampusPostTitles('pu/other', '二手書', 'old-004')).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(service.resumeCampusPostTitles('pu', '二手書', '../old-004')).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(service.resumeCampusPostTitles('pu', '租屋', 'old-004')).rejects.toMatchObject({ code: 'history-position-unavailable' });
  record({ scopeValidation: true });
});

test('editing the query discards a pending real resume result', async () => {
  const { view } = await returnedPanel();
  fireEvent.press(view.getByLabelText('回到上次閱讀位置'));
  const pending = resume.mock.results[0].value;
  fireEvent.changeText(view.getByLabelText('記得的標題開頭'), '近期活動');
  fireEvent.press(view.getByLabelText('搜尋歷史標題'));
  await count(view, 20);
  await act(async () => { expect((await pending).posts[0].id).toBe('old-004'); });
  expect(rows(view).every((post) => post.id.startsWith('recent-'))).toBe(true);
  expect(view.queryByLabelText('回到上次閱讀位置')).toBeNull();
  record({ lateResumeDiscarded: true, currentQuery: '近期活動' });
});

test.each(['close', 'native-back'])('%s clears the remembered position while a real resume is pending', async (method) => {
  const { view } = await returnedPanel();
  fireEvent.press(view.getByLabelText('回到上次閱讀位置'));
  const pending = resume.mock.results[0].value;
  if (method === 'close') fireEvent.press(view.getByLabelText('關閉歷史搜尋'));
  else fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  await act(async () => { expect((await pending).posts).toHaveLength(20); });
  fireEvent.press(view.getByLabelText('找舊貼文'));
  expect(view.getByLabelText('記得的標題開頭').props.value).toBe('');
  expect(view.queryByLabelText('回到上次閱讀位置')).toBeNull();
  expect(rows(view)).toEqual([]);
  record({ method, rememberedPositionCleared: true });
});

test.each(['account', 'school', 'sign-out', 'loading'])('pending resume cannot leak into a new %s scope', async (scope) => {
  const { view, onOpenPost } = await returnedPanel();
  fireEvent.press(view.getByLabelText('回到上次閱讀位置'));
  const pending = resume.mock.results[0].value;
  if (scope === 'account') mockUser = { uid: 'bob' };
  if (scope === 'school') { mockUser = { uid: 'charlie' }; mockSchool = 'other'; mockDb = client('charlie'); }
  if (scope === 'sign-out') mockUser = null;
  if (scope === 'loading') mockLoading = true;
  view.rerender(<TitleHistoryLauncher onOpenPost={onOpenPost} />);
  await act(async () => { expect((await pending).posts).toHaveLength(20); });
  expect(view.queryByLabelText('記得的標題開頭')).toBeNull();
  expect(view.queryByLabelText('回到上次閱讀位置')).toBeNull();
  expect(onOpenPost).toHaveBeenCalledTimes(1);
  record({ scope, discardedRealResults: 20 });
});

test('deletion between fresh anchor and page reads cannot silently resume at another post', async () => {
  const originalGet = sdk.getDocFromServer;
  let restore;
  const observed = jest.spyOn(sdk, 'getDocFromServer').mockImplementationOnce(async (...args) => {
    const snapshot = await originalGet(...args);
    restore = await changeAnchor((doc) => doc.delete());
    return snapshot;
  });
  try {
    await expect(service.resumeCampusPostTitles('pu', '二手書', 'old-004')).rejects.toMatchObject({ code: 'history-position-unavailable' });
    expect(observed).toHaveBeenCalledTimes(1);
    record({ realInterleavedDeletion: true, neighbourNotReturned: true });
  } finally { observed.mockRestore(); await restore?.(); }
});

test('retitling a visible historical result before opening must not navigate to an unrelated article', async () => {
  const onOpenPost = jest.fn();
  const view = render(<TitleHistoryLauncher onOpenPost={onOpenPost} />);
  fireEvent.press(view.getByLabelText('找舊貼文'));
  fireEvent.changeText(view.getByLabelText('記得的標題開頭'), '二手書');
  fireEvent.press(view.getByLabelText('搜尋歷史標題'));
  await count(view, 20);
  expect(rows(view).some((post) => post.id === 'old-004')).toBe(true);
  const restore = await changeAnchor((doc) => doc.update({ title: '租屋 已改標題' }));
  try {
    // The old card is still on screen. Only an uncached server recheck may
    // authorize opening it as a result of the original title-prefix search.
    fireEvent.press(view.getAllByLabelText('開啟貼文：二手書 01')[1]);
    await view.findByText(/這篇貼文已刪除或不再提供/, {}, { timeout: 10000 });
    expect(onOpenPost).not.toHaveBeenCalled();
    expect(rows(view).some((post) => post.id === 'old-004')).toBe(false);
    // The same legitimate student can still search by the new title; this
    // must not be implemented as a blanket denial of the document.
    expect(await service.confirmCampusPostTitleOpen('pu', 'old-004', '租屋')).toBe(true);
    record({ renamedFrom: '二手書 01', renamedTo: '租屋 已改標題', staleNavigation: false, legitimateNewPrefixAllowed: true });
  } finally { await restore(); }
});
