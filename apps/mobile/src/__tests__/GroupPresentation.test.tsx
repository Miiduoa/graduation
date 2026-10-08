import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { GroupsScreen } from '../screens/GroupsScreen';
import { GroupDetailScreen } from '../screens/GroupDetailScreen';
import { GroupPostScreen } from '../screens/GroupPostScreen';
import { applyTheme, clearSchoolTheme, createDarkTheme, createLightTheme } from '../ui/theme';

const mockDb = {};
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
  id: 'comment-actual',
  body: '請先比較左右子樹的高度。',
  authorId: 'ai-assistant',
  authorName: '校園助理',
  isAI: true,
};

jest.mock('../state/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'school-a' } }) }));
jest.mock('../firebase', () => ({
  getDb: () => mockDb,
  getFunctionsInstance: () => mockDb,
  isFirebaseMockMode: () => false,
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/ai', () => ({ chatWithCampusAssistant: jest.fn() }));
jest.mock('../services/memberDirectory', () => ({
  fetchSchoolDirectoryProfiles: jest.fn(async () => []),
}));
jest.mock('firebase/firestore', () => {
  const snapshot = (rows: Array<{ id: string }>) => ({
    docs: rows.map((row) => ({ id: row.id, data: () => row })),
    empty: rows.length === 0,
    size: rows.length,
  });
  return {
    collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
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
        ? { id: 'student-a', role: 'member' }
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
  await view.findByText('校園助理（自動回覆）');
  expect(view.queryByText(/MVP|Sprint 2/)).toBeNull();
  expect(view.getByRole('button', { name: '全部', selected: true })).toHaveStyle({ minHeight: 44 });
  expect(view.getByText('全部')).toHaveStyle({ color: createLightTheme().colors.onAccent });

  act(() => applyTheme('dark'));
  expect(view.getByText('全部')).toHaveStyle({ color: createDarkTheme().colors.onAccent });
  expect(view.getByText('樹狀結構的問題')).toHaveStyle({ color: createDarkTheme().colors.text });
  expect(view.getByText('校園助理（自動回覆）')).toHaveStyle({
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
