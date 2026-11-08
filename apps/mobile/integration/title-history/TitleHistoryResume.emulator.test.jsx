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
});
afterEach(async () => {
  cleanup();
  await Promise.all(clients.map((db) => sdk.enableNetwork(db)));
  await Promise.allSettled(search.mock.results.filter((item) => item.type === 'return').map((item) => item.value));
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
