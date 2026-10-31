import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { GradesScreen } from '../screens/GradesScreen';
const mockListGrades = jest.fn();
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'student-a' } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => 'light' }));
jest.mock('../data', () => ({ hasDataSource: () => true, getDataSource: () => ({ listGrades: mockListGrades, getGPA: async () => null }) }));
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
