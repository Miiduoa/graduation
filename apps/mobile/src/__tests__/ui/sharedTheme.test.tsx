import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AIButton, AICard, AIHero, aiTokens } from '../../ui/aiFirst';
import { CourseV2Card, CourseV2Header } from '../../screens/lmsV2/_courseV2Shell';
import {
  applyTheme,
  clearSchoolTheme,
  createDarkTheme,
  createLightTheme,
  createSchoolTheme,
  registerSchoolTheme,
} from '../../ui/theme';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useRoute: jest.fn(), useNavigation: jest.fn() }));

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(left: string, right: string) {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

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

test.each([createLightTheme(), createDarkTheme()])(
  'normal text and primary controls remain readable in $mode mode',
  ({ colors }) => {
    expect(contrast(colors.text, colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
  },
);

test('mounted shared primitives follow the current theme instead of retaining a light palette', () => {
  const view = render(
    <>
      <AIHero title="課程" />
      <AIButton label="開始點名" onPress={() => {}} />
    </>,
  );
  expect(view.getByText('課程')).toHaveStyle({ color: createLightTheme().colors.text });
  expect(view.getByRole('button')).toHaveStyle({
    minHeight: 44,
    backgroundColor: createLightTheme().colors.accent,
  });
  act(() => applyTheme('dark'));
  expect(aiTokens.bg).toBe(createDarkTheme().colors.bg);
  expect(view.getByText('課程')).toHaveStyle({ color: createDarkTheme().colors.text });
  expect(view.getByText('開始點名')).toHaveStyle({ color: createDarkTheme().colors.onAccent });
  expect(view.getByRole('button')).toHaveStyle({
    backgroundColor: createDarkTheme().colors.accent,
  });
});

test('a confidence hint is never promoted to a verified claim', () => {
  const view = render(
    <AICard title="課程摘要" confidence="high" source="課程公告">
      <Text>課程內容</Text>
    </AICard>,
  );
  expect(view.getByText('課程公告')).toBeTruthy();
  expect(view.queryByText('已驗證 ✓')).toBeNull();
});

test('course headers, controls and cards retain the common palette after a theme change', () => {
  const view = render(
    <>
      <CourseV2Header title="課程公告" rightAction={{ label: '新增公告', onPress: jest.fn() }} />
      <CourseV2Card title="下週課程" onPress={jest.fn()} />
    </>,
  );
  expect(view.getByRole('button', { name: '新增公告' })).toHaveStyle({
    minHeight: 44,
    backgroundColor: createLightTheme().colors.accent,
  });
  act(() => applyTheme('dark'));
  expect(view.getByText('課程公告')).toHaveStyle({ color: createDarkTheme().colors.text });
  expect(view.getByText('新增公告')).toHaveStyle({ color: createDarkTheme().colors.onAccent });
  expect(view.getByRole('button', { name: '下週課程' })).toHaveStyle({
    backgroundColor: createDarkTheme().colors.surface,
    borderColor: createDarkTheme().colors.border,
  });
});

test('school branding retains its identity without changing product control colors', () => {
  registerSchoolTheme({ schoolId: 'test-school', accent: '#654321', secondary: '#998877' });
  const branded = createSchoolTheme('light', 'test-school');
  expect(branded.brand?.primary).toBe('#654321');
  expect(branded.colors.accent).toBe(createLightTheme().colors.accent);
  expect(branded.colors.danger).toBe(createLightTheme().colors.danger);
});
