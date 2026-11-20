import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { GradesScreen } from '../screens/GradesScreen';
const mockListGrades = jest.fn();
const mockGetGPA = jest.fn().mockResolvedValue(null);
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'student-a' } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../data', () => ({ hasDataSource: () => true, getDataSource: () => ({ listGrades: mockListGrades, getGPA: mockGetGPA }) }));
jest.mock('../services/analytics', () => ({ analytics: { logScreenView: jest.fn() } }));
jest.mock('../components/PersonalImportSummary', () => ({ PersonalImportSummary: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/components', () => {
  const { Text, View, Pressable } = require('react-native');
  const Container = ({ children, title, subtitle }: { children?: React.ReactNode; title?: string; subtitle?: string }) => <View><Text>{title}</Text><Text>{subtitle}</Text>{children}</View>;
  return {
    Screen: Container, Card: Container, AnimatedCard: Container,
    Pill: ({ text }: { text: string }) => <Text>{text}</Text>,
    SectionTitle: ({ text }: { text: string }) => <Text>{text}</Text>,
    SegmentedControl: ({ options, onChange }: { options: string[]; onChange(index: number): void }) => <View>{options.map((text: string, index: number) => <Pressable key={text} onPress={() => onChange(index)}><Text>{text}</Text></Pressable>)}</View>,
    ProgressRing: () => null, Spinner: () => null,
    Button: ({ text }: { text: string }) => <Text>{text}</Text>,
  };
});
test('missing grade points stay visible and are excluded from the reference GPA', async () => {
  mockListGrades.mockResolvedValue([
    { id: 'one', courseId: 'c1', courseName: '未提供績點', credits: 3, semester: '115_1', letterGrade: '通過', gradeSource: 'school-official' },
    { id: 'two', courseId: 'c2', courseName: '已提供績點', credits: 3, semester: '115_1', letterGrade: 'B', gradePoints: 3, gradeSource: 'school-official' },
  ]);
  const view = render(<GradesScreen />);
  await view.findByText('GPA: 3.00');
  fireEvent.press(view.getByText('歷史成績'));
  await view.findByText('未提供績點');
  expect(view.queryByText('GPA: 1.50')).toBeNull();
  expect(view.getAllByText(/來源：校方正式/).length).toBe(2);
});

test.each([{ gpa: NaN, totalCredits: 6 }, { gpa: 0, totalCredits: 0 }, { gpa: Infinity, totalCredits: 3 }])('invalid upstream GPA falls back to known points', async (value) => {
  mockGetGPA.mockResolvedValue(value);
  mockListGrades.mockResolvedValue([
    { id: 'a', courseId: 'a', courseName: '已評', credits: 3, semester: '115_1', letterGrade: 'B', gradePoints: 3 },
    { id: 'b', courseId: 'b', courseName: '未知', credits: 3, semester: '115_1' },
  ]);
  const view = render(<GradesScreen />);
  await view.findByText('GPA: 3.00');
  fireEvent.press(view.getByText('統計分析'));
  expect((await view.findAllByText('3.00')).length).toBeGreaterThan(0);
  expect(view.queryByText('1.50')).toBeNull();
  expect(view.queryByText('NaN')).toBeNull();
});

test.each([[[]], [[{ id: 'a', courseName: '缺績點', courseId: 'a', credits: 3, semester: '115_1', letterGrade: '通過' }]], [[{ id: 'a', courseName: '零學分', courseId: 'a', credits: 0, semester: '115_1', letterGrade: 'B', gradePoints: 3 }]]])('no calculable GPA stays unknown', async (grades) => {
  mockGetGPA.mockResolvedValue({ gpa: 0, totalCredits: 0, totalPoints: 0 });
  mockListGrades.mockResolvedValue(grades);
  const view = render(<GradesScreen />);
  fireEvent.press(await view.findByText('統計分析'));
  await view.findByText('累積 GPA');
  expect(view.getAllByText('未知').length).toBeGreaterThan(0);
  expect(view.queryByText('0.00')).toBeNull();
});
