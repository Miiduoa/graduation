import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Dimensions, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { AIDetailHeader, AIDetailScreen, AIButton, AIScreen } from '../../ui/aiFirst';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));

const originalWindow = Dimensions.get('window');
function resize(width: number, fontScale: number) {
  const window = { width, fontScale, height: 844, scale: 3 };
  act(() => Dimensions.set({ window, screen: window }));
}
beforeEach(() => resize(390, 1));
afterEach(() => {
  act(() => Dimensions.set({ window: originalWindow, screen: originalWindow }));
  jest.restoreAllMocks();
});

test.each(['ios', 'android'] as const)(
  '%s screen shells retain handled taps without adding Android keyboard insets',
  (os) => {
    jest.replaceProperty(Platform, 'OS', os);
    const onPress = jest.fn();
    const ref = React.createRef<ScrollView>();
    const onScroll = jest.fn();
    const view = render(
      <>
        <AIScreen bottomPadding={120}>
          <TextInput accessibilityLabel="搜尋" />
        </AIScreen>
        <AIDetailScreen title="回饋" scrollRef={ref} onScroll={onScroll}>
          <TextInput accessibilityLabel="內容" />
          <AIButton label="送出" onPress={onPress} />
        </AIDetailScreen>
      </>,
    );
    for (const scroll of view.UNSAFE_getAllByType(ScrollView)) {
      expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
      expect(scroll.props.keyboardDismissMode).toBe(os === 'ios' ? 'interactive' : 'on-drag');
      expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(os === 'ios');
    }
    expect(ref.current).not.toBeNull();
    fireEvent.scroll(view.UNSAFE_getAllByType(ScrollView)[1], {
      nativeEvent: { contentOffset: { y: 24 } },
    });
    expect(onScroll).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByText('送出'));
    expect(onPress).toHaveBeenCalledTimes(1);
  },
);

test('caller keyboard policies and bottom spacing survive the shared defaults', () => {
  const view = render(
    <>
      <AIScreen
        keyboardShouldPersistTaps="never"
        keyboardDismissMode="none"
        automaticallyAdjustKeyboardInsets={false}
        bottomPadding={140}
      >
        <Text>自訂首頁</Text>
      </AIScreen>
      <AIDetailScreen
        title="自訂表單"
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={false}
        bottomPadding={160}
      >
        <Text>自訂內容</Text>
      </AIDetailScreen>
    </>,
  );
  const [landing, detail] = view.UNSAFE_getAllByType(ScrollView);
  expect(landing.props.keyboardShouldPersistTaps).toBe('never');
  expect(landing.props.keyboardDismissMode).toBe('none');
  expect(StyleSheet.flatten(landing.props.contentContainerStyle).paddingBottom).toBe(24);
  expect(StyleSheet.flatten(landing.parent?.props.style).paddingBottom).toBe(140);
  expect(detail.props.keyboardShouldPersistTaps).toBe('always');
  expect(detail.props.keyboardDismissMode).toBe('on-drag');
  expect(detail.props.contentContainerStyle.paddingBottom).toBe(160);
  expect(landing.props.automaticallyAdjustKeyboardInsets).toBe(false);
  expect(detail.props.automaticallyAdjustKeyboardInsets).toBe(false);
});

test.each([
  { width: 320, fontScale: 1, title: '個人資料', subtitle: '修改你的聯絡方式' },
  { width: 390, fontScale: 2, title: '個人資料', subtitle: '修改你的聯絡方式' },
  {
    width: 390,
    fontScale: 1,
    title: '資料庫系統與資訊安全專題實作課程'.repeat(5),
    subtitle: '校方課程',
  },
  { width: 390, fontScale: 1, title: '課程測驗', subtitle: '課程與群組說明'.repeat(20) },
])(
  'complete headings stay scrollable at $width px and $fontScale text scale',
  ({ width, fontScale, title, subtitle }) => {
    resize(width, fontScale);
    const onBack = jest.fn();
    const onSave = jest.fn();
    const view = render(
      <AIDetailScreen
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        rightAction={<AIButton label="儲存" onPress={onSave} />}
      >
        <Text>主要內容</Text>
      </AIDetailScreen>,
    );
    const scroll = view.UNSAFE_getByType(ScrollView);
    expect(scroll.findAll((node) => node.props.children === title).length).toBeGreaterThan(0);
    expect(scroll.findAll((node) => node.props.children === subtitle).length).toBeGreaterThan(0);
    expect(view.getByText(title).props.numberOfLines).toBeUndefined();
    expect(view.getByText(subtitle).props.numberOfLines).toBeUndefined();
    expect(scroll.findAll((node) => node.props.accessibilityLabel === '返回')).toHaveLength(0);
    expect(scroll.findAll((node) => node.props.children === '儲存')).toHaveLength(0);
    fireEvent.press(view.getByRole('button', { name: '返回' }));
    fireEvent.press(view.getByText('儲存'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  },
);

test('changing window size relocates heading text without losing the controlled form', () => {
  const content = () => (
    <AIDetailScreen title="個人資料" subtitle="修改聯絡方式">
      <TextInput accessibilityLabel="電話" value="0912345678" />
    </AIDetailScreen>
  );
  const view = render(content());
  const originalInput = view.UNSAFE_getByType(TextInput).instance;
  expect(
    view.UNSAFE_getByType(ScrollView).findAll((node) => node.props.children === '個人資料'),
  ).toHaveLength(0);
  resize(320, 2);
  view.rerender(content());
  expect(view.UNSAFE_getByType(TextInput).instance).toBe(originalInput);
  expect(view.getByLabelText('電話').props.value).toBe('0912345678');
  expect(
    view.UNSAFE_getByType(ScrollView).findAll((node) => node.props.children === '個人資料').length,
  ).toBeGreaterThan(0);
});

test('standalone detail headers bound long labels and keep a separate row for large-text actions', () => {
  resize(320, 2);
  const view = render(
    <AIDetailHeader
      title="助理"
      subtitle="校園需求與各項工作"
      rightAction={<AIButton label="新增對話" onPress={jest.fn()} />}
    />,
  );
  expect(view.getByRole('header', { name: '助理' }).props.numberOfLines).toBe(2);
  expect(view.getByText('校園需求與各項工作').props.numberOfLines).toBe(2);
  expect(view.getByRole('button', { name: '新增對話' })).toBeTruthy();
});
