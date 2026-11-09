import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { GroupsScreen } from '../screens/GroupsScreen';
import { GroupDetailScreen } from '../screens/GroupDetailScreen';
import { GroupPostScreen } from '../screens/GroupPostScreen';
import { applyTheme, clearSchoolTheme, createDarkTheme, createLightTheme } from '../ui/theme';

const mockDb = {};
let mockMemberRole = 'member';
const mockAuth = {
  user: { uid: 'student-a' },
  profile: { uid: 'student-a', displayName: '林同學', role: 'student' },
  isAdmin: false,
};
const mockGroup = {
  id: 'course-actual',
  groupId: 'course-actual',
  schoolId: 'school-a',
  name: '資料結構',
  type: 'course',
  joinCode: 'ABCD2345',
  role: 'member',
  status: 'active',
  isPublished: true,
  verification: { status: 'verified_teacher' },
};
const mockPost = {
  id: 'post-actual',
  title: '樹狀結構的問題',
  body: '平衡樹如何旋轉？',
  kind: 'question',
  authorId: 'student-b',
  authorName: '陳同學',
  topic: '課程討論',
  pinned: true,
  likes: 0,
};
const mockComment = {
  id: 'assistant',
  body: '請先比較左右子樹的高度。',
  authorId: 'campus-assistant',
  authorName: '助理回覆',
  isAI: true,
  generatedBy: 'server',
};

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'school-a' } }) }));
jest.mock('../firebase', () => ({
  getDb: () => mockDb,
  getAuthInstance: () => ({ currentUser: { getIdToken: async () => 'test-token' } }),
  hasUsableFirebaseConfig: () => true,
  getFunctionsInstance: () => mockDb,
  isFirebaseMockMode: () => false,
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/storage', () => ({ storage: { pickImage: jest.fn() } }));
jest.mock('../services/ai', () => ({ chatWithCampusAssistant: jest.fn() }));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn(async () => []),
}));
jest.mock('firebase/firestore', () => {
  let nextId = 0;
  const snapshot = (rows: Array<{ id: string }>) => ({
    docs: rows.map((row) => ({ id: row.id, data: () => row })),
    empty: rows.length === 0,
    size: rows.length,
  });
  return {
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/'), id: path.at(-1) ?? `draft-${++nextId}` }),
    query: (ref: unknown) => ref,
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    documentId: jest.fn(),
    getDocs: jest.fn(async ({ path }: { path: string }) => {
      if (path === 'users/student-a/groups' || path === 'groups') return snapshot([mockGroup]);
      if (path.endsWith('/comments')) return snapshot([mockComment]);
      if (path.endsWith('/posts')) return snapshot([mockPost]);
      return snapshot([]);
    }),
    getDoc: jest.fn(async ({ path }: { path: string }) => {
      const row = path.includes('/members/')
        ? { id: 'student-a', role: mockMemberRole }
        : path.includes('/posts/')
          ? mockPost
          : mockGroup;
      return { id: row.id, exists: () => true, data: () => row };
    }),
    addDoc: jest.fn(),
    setDoc: jest.fn(),
    updateDoc: jest.fn(),
    deleteDoc: jest.fn(),
    serverTimestamp: jest.fn(),
    arrayUnion: jest.fn(),
    arrayRemove: jest.fn(),
    increment: jest.fn(),
  };
});

beforeEach(() => {
  mockMemberRole = 'member';
  clearSchoolTheme();
  applyTheme('light');
});
afterEach(() => {
  act(() => {
    clearSchoolTheme();
    applyTheme('light');
  });
});

test('loaded memberships retain their real join code and navigation without invented activity', async () => {
  const navigation = { navigate: jest.fn() };
  const view = render(<GroupsScreen navigation={navigation} />);
  const course = await view.findByRole('button', { name: '進入課程：資料結構' });
  expect(view.getByText('加入碼 ABCD2345')).toBeTruthy();
  expect(view.queryByText(/位同學今日活躍/)).toBeNull();
  expect(view.queryByText(/Firestore|\(v1\)/)).toBeNull();
  fireEvent.press(course);
  expect(navigation.navigate).toHaveBeenCalledWith('GroupDetail', { groupId: 'course-actual' });

  const input = view.getByLabelText('群組加入碼');
  fireEvent.changeText(input, 'EFGH2345');
  act(() => applyTheme('dark'));
  expect(view.getByLabelText('群組加入碼')).toHaveStyle({
    color: createDarkTheme().colors.text,
    backgroundColor: createDarkTheme().colors.surface2,
  });
  expect(view.getByLabelText('群組加入碼').props.placeholderTextColor).toBe(
    createDarkTheme().colors.muted,
  );
  expect(view.getByLabelText('群組加入碼').props.value).toBe('EFGH-2345');
});

test('discussion controls retain contrast across themes and identify automated replies', async () => {
  const navigation = { navigate: jest.fn() };
  const view = render(
    <GroupDetailScreen navigation={navigation} route={{ params: { groupId: 'course-actual' } }} />,
  );
  await view.findByText('助理回覆');
  expect(view.queryByText(/MVP|Sprint 2/)).toBeNull();
  expect(view.getByRole('button', { name: '全部', selected: true })).toHaveStyle({ minHeight: 44 });
  expect(view.getByText('全部')).toHaveStyle({ color: createLightTheme().colors.onAccent });

  act(() => applyTheme('dark'));
  expect(view.getByText('全部')).toHaveStyle({ color: createDarkTheme().colors.onAccent });
  expect(view.getByText('樹狀結構的問題')).toHaveStyle({ color: createDarkTheme().colors.text });
  expect(view.getByText('助理回覆')).toHaveStyle({
    color: createDarkTheme().colors.accent,
  });
  fireEvent.press(view.getByRole('button', { name: '查看 / 留言' }));
  expect(navigation.navigate).toHaveBeenCalledWith('GroupPost', {
    groupId: 'course-actual',
    postId: 'post-actual',
  });
});

test('a mounted post keeps its comment draft and accessible send state when the theme changes', async () => {
  const view = render(
    <GroupPostScreen route={{ params: { groupId: 'course-actual', postId: 'post-actual' } }} />,
  );
  await view.findByText('樹狀結構的問題');
  expect(view.getByRole('button', { name: '送出留言' })).toBeDisabled();
  const input = view.getByPlaceholderText('輸入留言...');
  fireEvent.changeText(input, '想確認右旋的順序');
  act(() => applyTheme('dark'));
  expect(view.getByPlaceholderText('輸入留言...')).toHaveStyle({
    color: createDarkTheme().colors.text,
    backgroundColor: createDarkTheme().colors.surface2,
  });
  expect(view.getByPlaceholderText('輸入留言...').props.value).toBe('想確認右旋的順序');
  expect(view.getByRole('button', { name: '送出留言' })).not.toBeDisabled();
});

test('非試辦社團關閉後台開關時仍保留安全社員名單入口', async () => {
  const originalType = mockGroup.type;
  const originalFlag = process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED;
  mockGroup.type = 'club';
  process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED = 'false';
  try {
    const navigation = { navigate: jest.fn() };
    const view = render(
      <GroupDetailScreen navigation={navigation} route={{ params: { groupId: 'course-actual' } }} />,
    );
    fireEvent.press(await view.findByRole('button', { name: '社員名單' }));
    expect(navigation.navigate).toHaveBeenCalledWith('GroupMembers', { groupId: 'course-actual' });
    expect(view.queryByText('社團後台')).toBeNull();
  } finally {
    mockGroup.type = originalType;
    if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED;
    else process.env.EXPO_PUBLIC_CLUB_ADMIN_ENABLED = originalFlag;
  }
});

test('R2 exposes group attachments but keeps cover uploads hidden from ordinary members', async () => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'r2';
  const view = render(
    <GroupDetailScreen
      route={{ params: { groupId: 'course-actual' } }}
      navigation={{ navigate: jest.fn() }}
    />,
  );
  try {
    expect(await view.findByText('附加圖片或文件（0）')).toBeTruthy();
    expect(view.queryByText('更換群組封面')).toBeNull();
  } finally {
    view.unmount();
    delete process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND;
  }
});

test('R2 off hides group file upload entries', async () => {
  delete process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND;
  const view = render(
    <GroupDetailScreen
      route={{ params: { groupId: 'course-actual' } }}
      navigation={{ navigate: jest.fn() }}
    />,
  );
  expect(await view.findByText('發布內容')).toBeTruthy();
  expect(view.queryByText('附加圖片或文件（0）')).toBeNull();
  expect(view.queryByText('更換群組封面')).toBeNull();
});

test('R2 lets managers replace a group cover and saves only its path', async () => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'r2';
  mockMemberRole = 'admin';
  const files = require('../services/privateFiles');
  const upload = jest.spyOn(files, 'uploadPrivateFile').mockResolvedValue({ path: 'ignored' });
  const picker = require('../services/storage').storage.pickImage;
  picker.mockResolvedValue({ uri: 'file:///cover', type: 'image/png', name: 'cover.png', size: 5 });
  const previousFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ blob: async () => new Blob(['image'], { type: 'image/png' }) })) as unknown as typeof fetch;
  const view = render(<GroupDetailScreen route={{ params: { groupId: 'course-actual' } }} navigation={{ navigate: jest.fn() }} />);
  try {
    const button = await view.findByText('更換群組封面');
    await act(async () => fireEvent.press(button));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.objectContaining({ path: 'groups/course-actual/cover.png' })));
    expect(require('firebase/firestore').updateDoc).toHaveBeenCalledWith(expect.anything(), { coverUrl: 'groups/course-actual/cover.png' });
  } finally {
    view.unmount(); delete process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND; global.fetch = previousFetch; upload.mockRestore(); mockMemberRole = 'member';
  }
});

test('post attachments enforce the limit and retain progress until success or discard', async () => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'r2';
  const files = require('../services/privateFiles');
  const upload = jest.spyOn(files, 'uploadPrivateFile')
    .mockResolvedValueOnce({ path: 'ignored' })
    .mockRejectedValueOnce(Object.assign(new Error('limited'), { statusCode: 429 }))
    .mockResolvedValue({ path: 'ignored' });
  const picker = require('expo-document-picker').getDocumentAsync;
  const assets = Array.from({ length: 7 }, (_, i) => ({ uri: `file:///${i}`, name: `${i}.txt`, mimeType: 'text/plain' }));
  picker.mockResolvedValueOnce({ canceled: false, assets })
    .mockResolvedValue({ canceled: false, assets: assets.slice(0, 3) });
  const previousFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ blob: async () => new Blob(['text'], { type: 'text/plain' }) })) as unknown as typeof fetch;
  const setDoc = require('firebase/firestore').setDoc;
  setDoc.mockClear();
  const view = render(<GroupDetailScreen route={{ params: { groupId: 'course-actual' } }} />);
  try {
    const attach = await view.findByText('附加圖片或文件（0）');
    await act(async () => fireEvent.press(attach));
    expect(view.getByText('單次最多選取 6 個附件')).toBeTruthy();
    await act(async () => fireEvent.press(view.getByText('附加圖片或文件（0）')));
    fireEvent.changeText(view.getByPlaceholderText('標題'), '附件貼文');
    fireEvent.changeText(view.getByPlaceholderText('內容'), '附件內容');
    await act(async () => fireEvent.press(view.getByText('送出')));
    expect(view.getByText('上傳太頻繁，請稍後再試')).toBeTruthy();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(setDoc).not.toHaveBeenCalled();
    const firstPath = upload.mock.calls[0][0].path;
    await act(async () => fireEvent.press(view.getByText('送出')));
    expect(upload).toHaveBeenCalledTimes(4);
    expect(upload.mock.calls[2][0].path).not.toBe(upload.mock.calls[1][0].path);
    expect(setDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ attachments: expect.arrayContaining([firstPath]) }));
    expect(view.getByText('附加圖片或文件（0）')).toBeTruthy();
    upload.mockRejectedValue(Object.assign(new Error('limited'), { statusCode: 429 }));
    await act(async () => fireEvent.press(view.getByText('附加圖片或文件（0）')));
    fireEvent.changeText(view.getByPlaceholderText('標題'), '另一篇');
    fireEvent.changeText(view.getByPlaceholderText('內容'), '內容');
    await act(async () => fireEvent.press(view.getByText('送出')));
    const discarded = upload.mock.calls[4][0].path;
    fireEvent.press(view.getByText('放棄草稿'));
    await act(async () => fireEvent.press(view.getByText('附加圖片或文件（0）')));
    fireEvent.changeText(view.getByPlaceholderText('標題'), '新草稿');
    fireEvent.changeText(view.getByPlaceholderText('內容'), '內容');
    await act(async () => fireEvent.press(view.getByText('送出')));
    expect(upload.mock.calls[5][0].path).not.toBe(discarded);
  } finally {
    view.unmount();
    delete process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND;
    global.fetch = previousFetch;
    upload.mockRestore();
  }
});

test('post attachments recover from a lost PUT response without repeating confirmed uploads', async () => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'r2';
  const picker = require('expo-document-picker').getDocumentAsync;
  picker.mockResolvedValue({ canceled: false, assets: [
    { uri: 'file:///a', name: 'a.txt', mimeType: 'text/plain' },
    { uri: 'file:///b', name: 'b.txt', mimeType: 'text/plain' },
  ] });
  const previousFetch = global.fetch;
  const stored = new Set<string>();
  const puts: string[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('file:')) return { blob: async () => new Blob(['text'], { type: 'text/plain' }) };
    if (init?.method === 'POST') {
      const { path } = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({ path, url: path, method: 'PUT', headers: { 'If-None-Match': '*' }, expiresAt: 'later', maxBytes: 1000 }) };
    }
    puts.push(url);
    expect(init?.headers).toEqual({ 'If-None-Match': '*' });
    if (stored.has(url)) return { ok: false, status: 412 };
    stored.add(url);
    if (puts.length === 2) throw new TypeError('Response lost');
    return { ok: true, status: 200 };
  }) as unknown as typeof fetch;
  const setDoc = require('firebase/firestore').setDoc;
  setDoc.mockClear();
  const view = render(<GroupDetailScreen route={{ params: { groupId: 'course-actual' } }} />);
  try {
    await view.findByText('附加圖片或文件（0）');
    await act(async () => fireEvent.press(view.getByText('附加圖片或文件（0）')));
    fireEvent.changeText(view.getByPlaceholderText('標題'), '附件貼文');
    fireEvent.changeText(view.getByPlaceholderText('內容'), '附件內容');
    await act(async () => fireEvent.press(view.getByText('送出')));
    expect(setDoc).not.toHaveBeenCalled();
    expect(puts).toHaveLength(2);
    await act(async () => fireEvent.press(view.getByText('送出')));
    expect(puts).toHaveLength(3);
    expect(puts[2]).not.toBe(puts[1]);
    expect(puts[2].split('/').slice(0, 4)).toEqual(puts[1].split('/').slice(0, 4));
    const { parsePrivateFilePath } = require('@campus/shared/src/privateFileAccess');
    puts.forEach((path) => expect(parsePrivateFilePath(path)?.kind).toBe('group-post'));
    expect(setDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ attachments: [puts[0], puts[2]] }));
  } finally {
    view.unmount();
    delete process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND;
    global.fetch = previousFetch;
  }
});
