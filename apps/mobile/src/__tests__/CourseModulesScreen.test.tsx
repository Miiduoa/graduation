import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { CourseModulesScreen } from '../screens/CourseModulesScreen';
import {
  tcFetchModules,
  tcFetchCourseActivities,
  tcFetchCourseExams,
  tcFetchHomeworkActivities,
  tcFetchHomeworkDetail,
  tcFetchHomeworkSubmissions,
  type TCHomeworkDetail,
} from '../services/tronClassClient';
import {
  guardTronClassWebAccessOrAlert,
  webBrowserOpenWithPuTronClassGate,
} from '../services/tronClassWebUiGate';

const mockNavigation = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'student' } }) }));
jest.mock('../data/demoCoursesAdapter', () => ({ isDemoCourseId: () => false }));
jest.mock('../services/tronClassClient', () => ({
  tcFetchModules: jest.fn(),
  tcFetchCourseActivities: jest.fn(),
  tcFetchCourseExams: jest.fn(),
  tcFetchHomeworkActivities: jest.fn(),
  tcFetchHomeworkDetail: jest.fn(),
  tcFetchHomeworkSubmissions: jest.fn(),
}));
jest.mock('../services/tronClassWebUiGate', () => ({
  guardTronClassWebAccessOrAlert: jest.fn(() => true),
  webBrowserOpenWithPuTronClassGate: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(tcFetchModules).mockResolvedValue([
    { id: 7, course_id: 42, name: '第一章', sort: 1, is_hidden: false, syllabuses: [] },
  ]);
  jest.mocked(tcFetchCourseActivities).mockResolvedValue([]);
  jest.mocked(tcFetchCourseExams).mockResolvedValue([]);
  jest.mocked(tcFetchHomeworkActivities).mockResolvedValue([
    { id: 9, title: '閱讀作業', module_id: 7, homework_submissions: [] },
  ]);
  jest.mocked(tcFetchHomeworkSubmissions).mockResolvedValue([]);
});

async function openHomework(description: string | null) {
  jest.mocked(tcFetchHomeworkDetail).mockResolvedValue({
    id: 9,
    course_id: 42,
    title: '閱讀作業',
    description,
    total_score: 100,
    attachments: [],
  } as TCHomeworkDetail);
  const view = render(
    <CourseModulesScreen
      navigation={mockNavigation}
      route={{ params: { groupId: 42, groupName: '程式設計' } }}
    />,
  );
  fireEvent.press(await view.findByText('第一章'));
  fireEvent.press(view.getByText('閱讀作業'));
  expect(tcFetchHomeworkDetail).toHaveBeenCalledWith(42, 9);
  expect(view.getByText('作業資訊')).toBeTruthy();
  expect(view.getByText('滿分')).toBeTruthy();
  expect(view.getByText('100')).toBeTruthy();
  return view;
}

test.each([
  ['paragraph and line boundaries', '<p>第一題</p><p>第二題<br>附註</p>', '第一題 第二題 附註'],
  ['inline formatting', '請<b>閱讀</b>教材並<i>作答</i>。', '請 閱讀 教材並 作答 。'],
  ['quoted attributes', '<p title="1 > 0">保留說明</p><img alt="不可顯示的屬性" src="x">', '保留說明'],
  ['entities and comparisons', '<p>A &amp; B&nbsp;：x &lt; 3，y &gt; 1；&#x8ACB;&#30475;</p>', 'A & B ：x < 3，y > 1；請看'],
  ['plain text', '  請閱讀第三章，回答第 1–3 題。  ', '請閱讀第三章，回答第 1–3 題。'],
])('keeps %s readable in native text', async (_case, input, expected) => {
  const view = await openHomework(input);
  const description = view.getByText(expected, { exact: true });
  expect(description.props.numberOfLines).toBe(5);
  expect(description.props.children).toBe(expected);
  expect(view.queryByTestId('mock-webview')).toBeNull();
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  expect(webBrowserOpenWithPuTronClassGate).not.toHaveBeenCalled();
});

test.each([
  ['script and style bodies', '<SCRIPT type="text/javascript">alert(1)</Script ><style>body{display:none}</style><p>正常題目</p>', '正常題目'],
  ['comment and event handler', '<!-- 隱藏註解 --><img src="x" onerror="alert(1)"><p>正常題目</p>', '正常題目'],
  ['unfinished script tag', '<p>正常題目</p><script', '正常題目'],
  ['unfinished script body', '<p>正常題目</p><script>alert(1)', '正常題目'],
  ['tag removal between markup fragments', '&lt;scr<b></b>ipt&gt;alert(1)&lt;/scr<b></b>ipt&gt;', '<scr ipt>alert(1)</scr ipt>'],
  ['comment removal between markup fragments', '&lt;scr<!-- gap -->ipt&gt;', '<scr ipt>'],
])('does not expose or reconstruct markup from %s', async (_case, input, expected) => {
  const view = await openHomework(input);
  const description = view.getByText(expected, { exact: true });
  expect(description.props.children).toBe(expected);
  expect(description.props.children).not.toMatch(/<script\b/i);
  expect(view.queryByTestId('mock-webview')).toBeNull();
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  expect(webBrowserOpenWithPuTronClassGate).not.toHaveBeenCalled();
});

test('keeps encoded HTML examples as inert Text and opens the original assignment only on request', async () => {
  const expected = '<script>alert(1)</script>';
  const view = await openHomework('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(view.getByText(expected).props.children).toBe(expected);
  expect(view.queryByTestId('mock-webview')).toBeNull();
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '在 APP 內查看' }));
  expect(guardTronClassWebAccessOrAlert).toHaveBeenCalledTimes(1);
  expect(mockNavigation.navigate).toHaveBeenCalledWith('CourseMaterialViewer', {
    url: 'https://tronclass.pu.edu.tw/course/42/content#/homework/9',
    title: '閱讀作業',
    kind: 'homework',
    courseName: undefined,
  });
  expect(webBrowserOpenWithPuTronClassGate).not.toHaveBeenCalled();
});

test('bounds long descriptions while preserving the assignment card', async () => {
  const expected = '文'.repeat(8_000);
  const view = await openHomework(`<p>${'文'.repeat(30_000)}</p>`);
  expect(view.getByText(expected).props.children).toBe(expected);
  expect(view.getByRole('button', { name: '在 APP 內查看' })).toBeTruthy();
});

test.each([null, ''])('keeps missing description %p out of the text preview', async (description) => {
  const view = await openHomework(description);
  expect(view.UNSAFE_getAllByType(Text).filter((node) => node.props.numberOfLines === 5)).toHaveLength(0);
  expect(view.getByRole('button', { name: '在 APP 內查看' })).toBeTruthy();
});
