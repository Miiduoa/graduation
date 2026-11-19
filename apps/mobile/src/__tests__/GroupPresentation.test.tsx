import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { GroupsScreen } from '../screens/GroupsScreen';
import { GroupDetailScreen } from '../screens/GroupDetailScreen';
import { GroupPostScreen } from '../screens/GroupPostScreen';
import { applyTheme, clearSchoolTheme, createDarkTheme, createLightTheme } from '../ui/theme';
import { getDocs } from 'firebase/firestore';
import { callClubPortal } from '../services/clubPortal';

const mockDb = {};
let mockMemberRole = 'member';
let mockSchool = { id: 'school-a' };
let mockSelectionReady = true;
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

jest.mock('../services/nuniWebFn', () => ({
  postNuniWebFn: jest.fn(async () => ({ posts: [mockPost], cursor: null, hasMore: false })),
}));

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ school: mockSchool, selectionReady: mockSelectionReady }),
}));
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
jest.mock('../services/clubPortal', () => ({ callClubPortal: jest.fn() }));
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
    doc: (_db: unknown, ...path: string[]) => ({
      path: path.join('/'),
      id: path.at(-1) ?? `draft-${++nextId}`,
    }),
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
  jest.spyOn(require('../services/privateFiles'), 'claimPrivateFile').mockResolvedValue(undefined);
  mockMemberRole = 'member';
  mockSchool = { id: 'school-a' };
  mockSelectionReady = true;
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

test('the life club route reuses the authorized directory without loading or presenting course workflows', async () => {
  (callClubPortal as jest.Mock).mockResolvedValueOnce({
    success: true,
    office: false,
    clubs: [{ id: 'photo', name: '攝影社', category: '攝影', meetingTime: '', recruiting: true }],
  });
  (getDocs as jest.Mock).mockClear();
  const navigation = {
    navigate: jest.fn(),
    getState: () => ({ routeNames: ['Clubs', 'ClubDetail'] }),
  };
  const view = render(<GroupsScreen navigation={navigation} route={{ name: 'Clubs' }} />);
  const search = await view.findByLabelText('搜尋學校社團');
  expect(view.queryByText('建立課程')).toBeNull();
  expect(view.queryByLabelText('群組加入碼')).toBeNull();
  expect(view.queryByText('我加入的課程')).toBeNull();
  expect(view.queryByText('公開課程（可瀏覽）')).toBeNull();
  expect((getDocs as jest.Mock).mock.calls.map(([ref]) => ref.path)).toEqual([
    'users/student-a/groups',
  ]);
  expect(callClubPortal).toHaveBeenCalledWith('student-a', 'school-a', { action: 'directory' });
  fireEvent.changeText(search, '攝影');
  fireEvent.press(view.getByRole('button', { name: '查看社團：攝影社' }));
  expect(navigation.navigate).toHaveBeenCalledWith('ClubDetail', { groupId: 'photo' });
});

test('the life club directory withdraws old-school data while a new browsing school is unresolved', async () => {
  (callClubPortal as jest.Mock)
    .mockResolvedValueOnce({
      success: true,
      office: false,
      clubs: [{ id: 'old', name: '原校社團', category: '攝影' }],
    })
    .mockResolvedValueOnce({
      success: true,
      office: false,
      clubs: [{ id: 'new', name: '新校社團', category: '攝影' }],
    });
  const view = render(<GroupsScreen route={{ name: 'Clubs' }} />);
  expect(await view.findByText('查看社團：原校社團')).toBeTruthy();
  (getDocs as jest.Mock).mockClear();
  (callClubPortal as jest.Mock).mockClear();
  mockSchool = { id: 'school-b' };
  mockSelectionReady = false;
  view.rerender(<GroupsScreen route={{ name: 'Clubs' }} />);
  expect(view.queryByText('查看社團：原校社團')).toBeNull();
  expect(view.queryByLabelText('搜尋學校社團')).toBeNull();
  expect(view.getByText('請先確認瀏覽校園，再查看該校社團。')).toBeTruthy();
  await act(async () => {});
  expect(getDocs).not.toHaveBeenCalled();
  expect(callClubPortal).not.toHaveBeenCalled();
  mockSelectionReady = true;
  view.rerender(<GroupsScreen route={{ name: 'Clubs' }} />);
  expect(await view.findByText('查看社團：新校社團')).toBeTruthy();
  expect(callClubPortal).toHaveBeenCalledWith('student-a', 'school-b', { action: 'directory' });
});

test('returning from a club refreshes memberships without resetting the directory search', async () => {
  (callClubPortal as jest.Mock).mockResolvedValueOnce({
    success: true,
    office: false,
    clubs: [{ id: 'photo', name: '攝影社', category: '攝影' }],
  });
  const listeners = new Map<string, () => void>();
  const navigation = {
    navigate: jest.fn(),
    getState: () => ({ routeNames: ['Clubs', 'ClubDetail'] }),
    addListener: (event: string, handler: () => void) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
  };
  const view = render(<GroupsScreen navigation={navigation} route={{ name: 'Clubs' }} />);
  fireEvent.changeText(await view.findByLabelText('搜尋學校社團'), '攝影');
  act(() => listeners.get('blur')?.());
  (getDocs as jest.Mock).mockResolvedValueOnce({
    docs: [
      {
        data: () => ({
          groupId: 'photo',
          name: '攝影社',
          type: 'club',
          schoolId: 'school-a',
          role: 'member',
          status: 'active',
        }),
      },
    ],
  });
  await act(async () => listeners.get('focus')?.());
  expect(view.getByLabelText('搜尋學校社團').props.value).toBe('攝影');
  fireEvent.press(view.getByRole('button', { name: '我的社團' }));
  expect(view.getByRole('button', { name: '查看社團：攝影社' })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看社團：攝影社' }));
  act(() => listeners.get('blur')?.());
  (getDocs as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await act(async () => listeners.get('focus')?.());
  expect(view.getByText('暫時無法確認最新入社狀態，目前顯示上次讀取的名單。')).toBeTruthy();
  expect(view.getByRole('button', { name: '查看社團：攝影社' })).toBeTruthy();
  (getDocs as jest.Mock).mockResolvedValueOnce({ docs: [] });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '重新整理我的社團' })));
  expect(view.queryByText('暫時無法確認最新入社狀態，目前顯示上次讀取的名單。')).toBeNull();
  expect(view.getByText('還沒加入社團，可以到「找社團」看看。')).toBeTruthy();
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
      <GroupDetailScreen
        navigation={navigation}
        route={{ params: { groupId: 'course-actual' } }}
      />,
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

test('Supabase exposes group attachments but keeps cover uploads hidden from ordinary members', async () => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
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

test('Supabase off hides group file upload entries', async () => {
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

test.each([true, false])(
  'Supabase saves the returned cover path only after successful finalization (%s)',
  async (success) => {
    process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
    mockMemberRole = 'admin';
    const files = require('../services/privateFiles');
    const upload = jest
      .spyOn(files, 'uploadPrivateFile')
      .mockResolvedValue({
        path: 'groups/course-actual/cover.12345678-1234-1234-1234-123456789abc.png',
      });
    if (!success) upload.mockRejectedValue(new Error('File finalization failed'));
    const updateDoc = require('firebase/firestore').updateDoc;
    updateDoc.mockClear();
    const picker = require('../services/storage').storage.pickImage;
    picker.mockResolvedValue({
      uri: 'file:///cover',
      type: 'image/png',
      name: 'cover.png',
      size: 5,
    });
    const previousFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      blob: async () => new Blob(['image'], { type: 'image/png' }),
    })) as unknown as typeof fetch;
    const view = render(
      <GroupDetailScreen
        route={{ params: { groupId: 'course-actual' } }}
        navigation={{ navigate: jest.fn() }}
      />,
    );
    try {
      const button = await view.findByText('更換群組封面');
      await act(async () => fireEvent.press(button));
      await waitFor(() =>
        expect(upload).toHaveBeenCalledWith(
          expect.objectContaining({ path: 'groups/course-actual/cover.png' }),
        ),
      );
      if (success)
        expect(updateDoc).toHaveBeenCalledWith(expect.anything(), {
          coverUrl: 'groups/course-actual/cover.12345678-1234-1234-1234-123456789abc.png',
        });
      else expect(updateDoc).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      delete process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND;
      global.fetch = previousFetch;
      upload.mockRestore();
      mockMemberRole = 'member';
    }
  },
);

test('post attachments enforce the limit and retain progress until success or discard', async () => {
  process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
  const files = require('../services/privateFiles');
  const upload = jest
    .spyOn(files, 'uploadPrivateFile')
    .mockResolvedValueOnce({ path: 'ignored' })
    .mockRejectedValueOnce(Object.assign(new Error('limited'), { statusCode: 429 }))
    .mockResolvedValue({ path: 'ignored' });
  const picker = require('expo-document-picker').getDocumentAsync;
  const assets = Array.from({ length: 7 }, (_, i) => ({
    uri: `file:///${i}`,
    name: `${i}.txt`,
    mimeType: 'text/plain',
  }));
  picker
    .mockResolvedValueOnce({ canceled: false, assets })
    .mockResolvedValue({ canceled: false, assets: assets.slice(0, 3) });
  const previousFetch = global.fetch;
  global.fetch = jest.fn(async () => ({
    blob: async () => new Blob(['text'], { type: 'text/plain' }),
  })) as unknown as typeof fetch;
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
    expect(setDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ attachments: expect.arrayContaining([firstPath]) }),
    );
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

test.each(['upload', 'finalize'])(
  'post attachments recover from %s failure without repeating confirmed uploads',
  async (failure) => {
    process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND = 'supabase';
    const picker = require('expo-document-picker').getDocumentAsync;
    picker.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///a', name: 'a.txt', mimeType: 'text/plain' },
        { uri: 'file:///b', name: 'b.txt', mimeType: 'text/plain' },
      ],
    });
    const previousFetch = global.fetch;
    const stored = new Set<string>();
    const puts: string[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('file:'))
        return { blob: async () => new Blob(['text'], { type: 'text/plain' }) };
      if (init?.method === 'POST') {
        const { action, path } = JSON.parse(String(init.body));
        if (action === 'finalize' && failure === 'finalize' && puts.length === 2)
          return { ok: false, status: 413, json: async () => ({ error: 'File is too large' }) };
        if (action === 'finalize')
          return { ok: true, status: 200, json: async () => ({ path, finalized: true }) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path,
            url: path,
            method: 'PUT',
            headers: { 'If-None-Match': '*' },
            expiresAt: 'later',
            maxBytes: 1000,
            requiresFinalize: true,
          }),
        };
      }
      puts.push(url);
      expect(init?.headers).toEqual({ 'If-None-Match': '*' });
      if (stored.has(url)) return { ok: false, status: 412 };
      stored.add(url);
      if (failure === 'upload' && puts.length === 2) throw new TypeError('Response lost');
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
      expect(setDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ attachments: [puts[0], puts[2]] }),
      );
    } finally {
      view.unmount();
      delete process.env.EXPO_PUBLIC_FILE_STORAGE_BACKEND;
      global.fetch = previousFetch;
    }
  },
);

test('group feed uses the hosted list and never lists posts through client Firestore', async () => {
  const firestore = require('firebase/firestore');
  firestore.getDocs.mockClear();
  const view = render(<GroupDetailScreen route={{ params: { groupId: 'course-actual' } }} />);
  await view.findByText('樹狀結構的問題');
  expect(require('../services/nuniWebFn').postNuniWebFn).toHaveBeenCalledWith(
    'listGroupDiscussionPage', { groupId: 'course-actual', pageSize: 50 }, 'student-a',
  );
  expect(firestore.getDocs.mock.calls.some(([ref]: [{ path: string }]) => ref.path.endsWith('/posts'))).toBe(false);
});

