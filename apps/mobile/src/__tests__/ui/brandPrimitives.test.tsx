import React from 'react';
import { act, render } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { Button, FilterChip, Badge } from '../../ui/components';
import { ConfidenceBadge, HeroActionCard } from '../../ui/campusOs';
import { AnnouncementItem } from '../../ui/ListItems';
import { CourseChipEmpty } from '../../ui/courseChipShell';
import { CockpitAccentCard, CockpitHero } from '../../ui/cockpitShell';
import { applyTheme, clearSchoolTheme, createDarkTheme, createLightTheme } from '../../ui/theme';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../ui/PuWebView', () => ({ PuWebView: () => null }));
jest.mock('../../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));

function rgb(value: string): number[] {
  return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
}

function contrast(foreground: string, background: string, surface: string): number {
  const alpha = background.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
  const backgroundRgb = alpha
    ? rgb(surface).map(
        (base, index) =>
          Number(alpha[index + 1]) * Number(alpha[4]) + base * (1 - Number(alpha[4])),
      )
    : rgb(background);
  const luminance = (channels: number[]) =>
    channels
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(rgb(foreground));
  const b = luminance(backgroundRgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

beforeEach(() => {
  clearSchoolTheme();
  applyTheme('light');
});
afterEach(() => act(() => applyTheme('light')));

test.each([createLightTheme(), createDarkTheme()])(
  'status labels are readable on cards and tinted surfaces in $mode mode',
  ({ colors }) => {
    for (const tone of ['success', 'danger', 'warning', 'info'] as const) {
      expect(contrast(colors[tone], colors.surface, colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors[tone], colors[`${tone}Soft`], colors.surface)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    expect(contrast(colors.onDanger, colors.danger, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onSuccess, colors.success, colors.surface)).toBeGreaterThanOrEqual(4.5);
  },
);

test('mounted buttons, selected filters and count badges switch their foreground with the theme', () => {
  const view = render(
    <>
      <Button text="刪除草稿" kind="danger" onPress={jest.fn()} />
      <FilterChip label="本週" selected onPress={jest.fn()} />
      <Badge count={3} />
      <CourseChipEmpty
        title="尚無筆記"
        body="新增第一份筆記"
        primaryLabel="新增筆記"
        onPrimary={jest.fn()}
      />
    </>,
  );
  act(() => applyTheme('dark'));
  const { colors } = createDarkTheme();
  expect(view.getByText('刪除草稿')).toHaveStyle({ color: colors.onDanger });
  expect(view.getByText('本週')).toHaveStyle({ color: colors.onAccent });
  expect(view.getByText('3')).toHaveStyle({ color: colors.onDanger });
  expect(view.getByText('新增筆記')).toHaveStyle({ color: colors.onAccent });
  expect(view.getByRole('button', { name: '本週' })).toHaveAccessibilityState({ selected: true });
});

test('live badges keep a distinct readable background in both themes', () => {
  const view = render(<ConfidenceBadge state="live" label="更新中" />);
  for (const mode of ['light', 'dark'] as const) {
    act(() => applyTheme(mode));
    const label = view.getByText('更新中');
    const background = StyleSheet.flatten(view.UNSAFE_getByType(View).props.style).backgroundColor;
    const foreground = StyleSheet.flatten(label.props.style).color;
    const colors = mode === 'dark' ? createDarkTheme().colors : createLightTheme().colors;
    expect(contrast(foreground, background, colors.surface)).toBeGreaterThanOrEqual(4.5);
  }
});

test('memoized announcement rows and task cards update without receiving new props', () => {
  const view = render(
    <>
      <AnnouncementItem
        id="notice"
        title="停課公告"
        body="請確認課程安排"
        publishedAt="2026-10-08T08:00:00Z"
        onPress={jest.fn()}
      />
      <HeroActionCard
        icon="book-outline"
        eyebrow="本週課程"
        title="檢查課程進度"
        onPress={jest.fn()}
        actionLabel="開啟課程"
      />
    </>,
  );
  act(() => applyTheme('dark'));
  const { colors } = createDarkTheme();
  expect(view.getByText('停課公告')).toHaveStyle({ color: colors.text });
  expect(view.getByRole('button', { name: '查看公告：停課公告' })).toHaveStyle({
    backgroundColor: colors.surface,
  });
  expect(view.getByText('本週課程')).toHaveStyle({ color: colors.accent });
  expect(view.getByRole('button', { name: /檢查課程進度.*開啟課程/ })).toBeTruthy();
});

test('role workspaces retain readable accent cards after a live theme change', () => {
  const view = render(
    <>
      <CockpitHero eyebrow="課程" title="今天的安排" />
      <CockpitAccentCard title="繼續閱讀" meta="第一章" ctaLabel="開啟教材" onPress={jest.fn()} />
    </>,
  );
  expect(view.getByText('Campus One')).toBeTruthy();
  expect(view.getByText('接下來')).toBeTruthy();
  expect(view.queryByText('AI-first 工作台')).toBeNull();
  act(() => applyTheme('dark'));
  const { colors } = createDarkTheme();
  expect(view.getByText('今天的安排')).toHaveStyle({ color: colors.text });
  expect(view.getByText('繼續閱讀')).toHaveStyle({ color: colors.onAccent });
  expect(view.getByRole('button', { name: /繼續閱讀.*第一章.*開啟教材/ })).toHaveStyle({
    backgroundColor: colors.accent,
  });
  expect(view.getByText('開啟教材')).toHaveStyle({ color: colors.accent });
});
