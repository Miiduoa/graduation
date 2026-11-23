import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { getDocFromServer, setDoc } from 'firebase/firestore';
import { CreatorCardPanel } from '../screens/social/CreatorCardPanel';
import { readCreatorCard, saveCreatorCard } from '../services/creatorCard';

jest.mock('../firebase', () => ({ getDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDocFromServer: jest.fn(),
  setDoc: jest.fn(),
  serverTimestamp: () => 'SERVER_TIME',
}));
jest.mock('../services/creatorCard', () => ({
  ...jest.requireActual('../services/creatorCard'),
  readCreatorCard: jest.fn(),
  saveCreatorCard: jest.fn(),
}));

beforeEach(() => {
  // resetAllMocks on these two services prevents an unconsumed one-shot
  // implementation in a failed test from leaking into the next student's flow.
  jest.clearAllMocks();
  jest.mocked(getDocFromServer).mockReset();
  jest.mocked(setDoc).mockReset();
  jest.mocked(readCreatorCard).mockReset();
  jest.mocked(saveCreatorCard).mockReset();
  jest.mocked(readCreatorCard).mockResolvedValue(null);
  jest.mocked(saveCreatorCard).mockResolvedValue({
    headline: '校園攝影', bio: '分享校園生活', linkUrl: '',
  });
});

test('owner edits a public intro and success appears only after confirmation', async () => {
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('一句話介紹'), '校園攝影');
  fireEvent.changeText(view.getByLabelText('個人簡介'), '分享校園生活');
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledWith('pu', 'alice', {
    headline: '校園攝影', bio: '分享校園生活', linkUrl: '',
  });
  expect(await view.findByText('社群簡介已儲存。')).toBeTruthy();
  expect(view.queryByLabelText('個人簡介')).toBeNull();
});

test('a failed write retains editable content and gives a retryable error', async () => {
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('unavailable'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), '沒送出的草稿');
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(view.getByLabelText('個人簡介').props.value).toBe('沒送出的草稿');
  expect(view.getByText(/草稿已保留/)).toBeTruthy();
  expect(view.queryByText('社群簡介已儲存。')).toBeNull();
});

test('peer sees chosen published content but cannot edit', async () => {
  jest.mocked(readCreatorCard).mockResolvedValue({
    headline: '攝影', bio: '簡介', linkUrl: 'https://example.org',
  });
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="bob" own={false} />);
  expect(await view.findByText('攝影')).toBeTruthy();
  expect(view.getByText('簡介')).toBeTruthy();
  expect(view.queryByLabelText('編輯社群簡介')).toBeNull();
  expect(saveCreatorCard).not.toHaveBeenCalled();
});

test('read error is retryable and never shown as unpublished', async () => {
  jest.mocked(readCreatorCard).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(null);
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('重新讀取社群簡介'));
  expect(await view.findByLabelText('建立社群簡介')).toBeTruthy();
  expect(readCreatorCard).toHaveBeenCalledTimes(2);
});


test('rapid taps never duplicate an ambiguous save before a fresh server check', async () => {
  let rejectFirst: (reason: Error) => void = () => undefined;
  jest.mocked(saveCreatorCard).mockImplementationOnce(() => (
    new Promise<Awaited<ReturnType<typeof saveCreatorCard>>>((_, reject) => {
      rejectFirst = (reason) => reject(reason);
    })
  ));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), '校園社團活動與攝影作品');
  // Retain CardButton's actual onPress closure before the disabled state
  // commits. React Native renders Pressable as a host View in this Jest
  // renderer; querying by Pressable type throws "No instances found".
  // The CardButton composite retains the original submit callback so the
  // test still exercises an outdated handler, not just a disabled host View.
  const staleOnPress = view.UNSAFE_root.findAll((node) =>
    node.props.label === '儲存簡介' && typeof node.props.onPress === 'function'
  )[0]?.props.onPress as (() => void) | undefined;
  expect(staleOnPress).toEqual(expect.any(Function));
  act(() => {
    const saveButton = view.getByLabelText('儲存簡介');
    fireEvent.press(saveButton);
    fireEvent.press(saveButton);
  });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('正在確認儲存…').props.accessibilityState)
    .toMatchObject({ disabled: true, busy: true });
  await act(async () => { rejectFirst(new Error('offline')); });
  expect(view.getByLabelText('個人簡介').props.value).toBe('校園社團活動與攝影作品');
  expect(view.getByText(/草稿已保留/)).toBeTruthy();
  expect(view.getByLabelText('儲存簡介').props.accessibilityState)
    .toMatchObject({ disabled: true, busy: false });

  // Even if a stale callback is invoked directly, an unconfirmed prior write
  // must not be resent. Pressable disabled alone is not the service boundary.
  await act(async () => {
    staleOnPress!();
  });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('核對儲存結果')).toBeTruthy();

  // Mock server-only read reports no existing card: only then may the student
  // choose a second write. This is a simulated service response, not emulator proof.
  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(readCreatorCard).toHaveBeenCalledTimes(2);
  expect(readCreatorCard).toHaveBeenLastCalledWith('pu', 'alice', { requireCommitted: true });
  expect(view.getByText(/伺服器資料與上次送出的內容不同/)).toBeTruthy();
  expect(view.getByLabelText('儲存簡介').props.accessibilityState)
    .toMatchObject({ disabled: false, busy: false });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);

  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(2);
  expect(saveCreatorCard).toHaveBeenLastCalledWith('pu', 'alice', {
    headline: '', bio: '校園社團活動與攝影作品', linkUrl: '',
  });
  expect(await view.findByText('社群簡介已儲存。')).toBeTruthy();
});


test('switching school and account mid-save starts a fresh profile and ignores late success', async () => {
  let resolvePrior: (card: Awaited<ReturnType<typeof saveCreatorCard>>) => void = () => undefined;
  jest.mocked(saveCreatorCard).mockImplementationOnce(() => (
    new Promise<Awaited<ReturnType<typeof saveCreatorCard>>>((resolve) => { resolvePrior = resolve; })
  ));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), 'Alice 的攝影社');
  act(() => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);

  view.rerender(<CreatorCardPanel schoolId="other-school" ownerUid="bob" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), 'Bob 的新校園簡介');

  await act(async () => {
    resolvePrior({ headline: '舊帳號', bio: 'Alice 的攝影社', linkUrl: '' });
  });
  expect(view.getByLabelText('個人簡介').props.value).toBe('Bob 的新校園簡介');
  expect(view.queryByText('社群簡介已儲存。')).toBeNull();

  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(2);
  expect(saveCreatorCard).toHaveBeenLastCalledWith('other-school', 'bob', {
    headline: '', bio: 'Bob 的新校園簡介', linkUrl: '',
  });
  expect(await view.findByText('社群簡介已儲存。')).toBeTruthy();
});

test('switching from own card to a peer during a rejected save never shows the old editor', async () => {
  let rejectPrior: (reason: Error) => void = () => undefined;
  jest.mocked(saveCreatorCard).mockImplementationOnce(() => (
    new Promise<Awaited<ReturnType<typeof saveCreatorCard>>>((_, reject) => {
      rejectPrior = reject;
    })
  ));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), 'Alice 的內容');
  act(() => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  view.rerender(<CreatorCardPanel schoolId="pu" ownerUid="charlie" own={false} />);
  expect(view.queryByLabelText('個人簡介')).toBeNull();
  await act(async () => { rejectPrior(new Error('offline')); });
  expect(view.queryByLabelText('個人簡介')).toBeNull();
  expect(view.queryByText(/草稿已保留/)).toBeNull();
  expect(view.queryByLabelText('建立社群簡介')).toBeNull();
});


test('portfolio URL cannot open: no duplicate external handoff and a visible retry', async () => {
  let rejectFirst: (reason: Error) => void = () => undefined;
  const openURL = jest.spyOn(Linking, 'openURL')
    .mockImplementationOnce(() => new Promise<void>((_, reject) => {
      rejectFirst = reject;
    }))
    .mockResolvedValue(undefined);
  jest.mocked(readCreatorCard).mockResolvedValue({
    headline: '攝影社', bio: '我的作品', linkUrl: 'https://example.org/',
  });
  try {
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    const link = await view.findByLabelText('查看作品連結');
    act(() => {
      fireEvent.press(link);
      fireEvent.press(link);
    });
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('https://example.org/');
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });
    await act(async () => { rejectFirst(new Error('no browser available')); });
    const alert = view.getByText('無法開啟作品連結，請稍後再試。');
    expect(alert.props.accessibilityRole).toBe('alert');
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
    await act(async () => { fireEvent.press(view.getByLabelText('查看作品連結')); });
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(view.queryByText('無法開啟作品連結，請稍後再試。')).toBeNull();
  } finally {
    openURL.mockRestore();
  }
});

test('a late failure from the old portfolio URL does not mark a newly saved link as broken', async () => {
  let rejectOld: (reason: Error) => void = () => undefined;
  const openURL = jest.spyOn(Linking, 'openURL')
    .mockImplementationOnce(() => new Promise<void>((_, reject) => {
      rejectOld = reject;
    }))
    .mockResolvedValue(undefined);
  jest.mocked(readCreatorCard).mockResolvedValue({
    headline: '校園攝影', bio: '作品集', linkUrl: 'https://old.example.org/',
  });
  jest.mocked(saveCreatorCard).mockResolvedValue({
    headline: '校園攝影', bio: '作品集', linkUrl: 'https://new.example.org/',
  });
  try {
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    fireEvent.press(await view.findByLabelText('查看作品連結'));
    expect(openURL).toHaveBeenCalledWith('https://old.example.org/');

    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    fireEvent.changeText(view.getByLabelText('作品連結'), 'https://new.example.org/');
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    expect(view.getByText('社群簡介已儲存。')).toBeTruthy();

    await act(async () => { rejectOld(new Error('old browser handoff failed')); });
    expect(view.queryByText('無法開啟作品連結，請稍後再試。')).toBeNull();
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });

    await act(async () => { fireEvent.press(view.getByLabelText('查看作品連結')); });
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(openURL).toHaveBeenNthCalledWith(2, 'https://new.example.org/');
  } finally {
    openURL.mockRestore();
  }
});

test('an ambiguous save is confirmed by a fresh read without sending a duplicate write', async () => {
  const card = { headline: '校園攝影', bio: '已送出的作品介紹', linkUrl: '' };
  jest.mocked(readCreatorCard).mockResolvedValueOnce(null).mockResolvedValueOnce(card);
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('unavailable after write'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('一句話介紹'), card.headline);
  fireEvent.changeText(view.getByLabelText('個人簡介'), card.bio);

  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('儲存簡介').props.accessibilityState).toMatchObject({ disabled: true });
  expect(view.getByLabelText('核對儲存結果')).toBeTruthy();
  expect(readCreatorCard).toHaveBeenCalledTimes(1);

  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(readCreatorCard).toHaveBeenNthCalledWith(2, 'pu', 'alice', { requireCommitted: true });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText('個人簡介')).toBeNull();
  expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
});

test('confirmation preserves a text event delivered during the server read', async () => {
  const card = { headline: '', bio: '已送出的介紹', linkUrl: '' };
  let resolveRead!: (value: typeof card) => void;
  const confirmation = new Promise<typeof card>((resolve) => { resolveRead = resolve; });
  jest.mocked(readCreatorCard).mockResolvedValueOnce(null).mockReturnValueOnce(confirmation);
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('offline after write'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), ` ${card.bio} `);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });

  const onChangeText = view.getByLabelText('個人簡介').props.onChangeText;
  fireEvent.press(view.getByLabelText('核對儲存結果'));
  expect(view.getByLabelText('正在核對伺服器…')).toBeTruthy();
  await act(async () => {
    onChangeText('讀取途中送達的新介紹');
    resolveRead(card);
  });

  expect(view.getByLabelText('個人簡介').props.value).toBe('讀取途中送達的新介紹');
  expect(view.getByText(/上一筆已確認儲存/)).toBeTruthy();
  expect(view.queryByLabelText('核對儲存結果')).toBeNull();
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('取消編輯'));
  expect(view.getByText(card.bio)).toBeTruthy();
});

test('editing a pending draft keeps the save blocked and an invalid URL does not break confirmation', async () => {
  const card = { headline: '', bio: '已送出的介紹', linkUrl: '' };
  jest.mocked(readCreatorCard).mockResolvedValueOnce(null).mockResolvedValueOnce(card);
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('offline after write'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), card.bio);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });

  fireEvent.changeText(view.getByLabelText('作品連結'), 'http://example.org');
  expect(view.getByLabelText('儲存簡介').props.accessibilityState).toMatchObject({ disabled: true });
  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(view.getByText(/上一筆已確認儲存/)).toBeTruthy();
  expect(view.getByLabelText('作品連結').props.value).toBe('http://example.org');
  expect(view.queryByLabelText('核對儲存結果')).toBeNull();

  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(view.getByText(/有效的 HTTPS 網址/)).toBeTruthy();
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
});

test('canceling and reopening retains the pending draft and requires confirmation', async () => {
  jest.mocked(readCreatorCard).mockResolvedValueOnce({ headline: '', bio: '已發布的介紹', linkUrl: '' });
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('offline after write'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), '待核對的介紹');
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });

  fireEvent.press(view.getByLabelText('取消編輯'));
  expect(view.getByText('已發布的介紹')).toBeTruthy();
  fireEvent.press(view.getByLabelText('編輯社群簡介'));
  expect(view.getByLabelText('個人簡介').props.value).toBe('待核對的介紹');
  expect(view.getByLabelText('核對儲存結果')).toBeTruthy();
  expect(view.getByLabelText('儲存簡介').props.accessibilityState).toMatchObject({ disabled: true });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
});

test('a server mismatch keeps the edit and requires an explicit new save', async () => {
  jest.mocked(readCreatorCard).mockResolvedValueOnce(null).mockResolvedValueOnce({
    headline: '舊資料', bio: '', linkUrl: '',
  });
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('unavailable'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), '新的待儲存草稿');

  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  fireEvent.changeText(view.getByLabelText('一句話介紹'), '舊資料');
  fireEvent.changeText(view.getByLabelText('個人簡介'), '');
  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('一句話介紹').props.value).toBe('舊資料');
  expect(view.getByLabelText('個人簡介').props.value).toBe('');
  expect(view.getByText(/伺服器資料與上次送出的內容不同/)).toBeTruthy();
  expect(view.queryByLabelText('核對儲存結果')).toBeNull();
  expect(view.getByLabelText('儲存簡介').props.accessibilityState).toMatchObject({ disabled: false });

  fireEvent.press(view.getByLabelText('取消編輯'));
  expect(view.getByText('舊資料')).toBeTruthy();
  fireEvent.press(view.getByLabelText('編輯社群簡介'));
  expect(view.getByLabelText('一句話介紹').props.value).toBe('舊資料');
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(2);
});

test('an offline confirmation can be retried without resending the save', async () => {
  const card = { headline: '', bio: '校園志工服務', linkUrl: '' };
  jest.mocked(readCreatorCard).mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(card);
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('unavailable'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), card.bio);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });

  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(view.getByText(/仍無法核對伺服器資料/)).toBeTruthy();
  expect(view.getByLabelText('個人簡介').props.value).toBe(card.bio);
  expect(view.getByLabelText('核對儲存結果')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(readCreatorCard).toHaveBeenCalledTimes(3);
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
});

test.each(['matching card', 'missing card'])(
  'manual confirmation cannot settle a pending overlay containing a %s', async (kind) => {
    const card = { headline: '', bio: '待核對的作品介紹', linkUrl: '' };
    const snapshot = (pending: boolean, exists: boolean) => ({
      exists: () => exists,
      data: () => ({ schoolId: 'pu', ownerUid: 'alice', ...card }),
      metadata: { fromCache: false, hasPendingWrites: pending },
    });
    const actual = jest.requireActual('../services/creatorCard') as typeof import('../services/creatorCard');
    jest.mocked(readCreatorCard).mockImplementation(actual.readCreatorCard);
    jest.mocked(saveCreatorCard).mockImplementation(actual.saveCreatorCard);
    jest.mocked(setDoc).mockRejectedValueOnce(new Error('unavailable'));
    jest.mocked(getDocFromServer)
      .mockResolvedValueOnce(snapshot(false, false) as never)
      .mockResolvedValueOnce(snapshot(true, kind === 'matching card') as never)
      .mockResolvedValueOnce(snapshot(false, true) as never);
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    fireEvent.press(await view.findByLabelText('建立社群簡介'));
    fireEvent.changeText(view.getByLabelText('個人簡介'), card.bio);
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });

    expect(view.queryByText('社群簡介已儲存。')).toBeNull();
    expect(view.getByLabelText('核對儲存結果')).toBeTruthy();
    expect(view.getByLabelText('個人簡介').props.value).toBe(card.bio);
    expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
    expect(setDoc).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
    expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
    expect(view.queryByLabelText('核對儲存結果')).toBeNull();
    expect(setDoc).toHaveBeenCalledTimes(1);
  },
);

test('a pending display can initialize the editor but cannot confirm its save', async () => {
  const card = { headline: '', bio: '可顯示的待提交簡介', linkUrl: 'https://example.org/' };
  const draft = { ...card, bio: '等待確認的新簡介' };
  const snapshot = (value: typeof card, pending: boolean) => ({
    exists: () => true,
    data: () => ({ schoolId: 'pu', ownerUid: 'alice', ...value }),
    metadata: { fromCache: false, hasPendingWrites: pending },
  });
  const actual = jest.requireActual('../services/creatorCard') as typeof import('../services/creatorCard');
  jest.mocked(readCreatorCard).mockImplementation(actual.readCreatorCard);
  jest.mocked(saveCreatorCard).mockImplementation(actual.saveCreatorCard);
  jest.mocked(setDoc).mockResolvedValue(undefined);
  jest.mocked(getDocFromServer)
    .mockResolvedValueOnce(snapshot(card, true) as never)
    .mockResolvedValueOnce(snapshot(draft, true) as never)
    .mockResolvedValueOnce(snapshot(draft, false) as never);
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  expect(await view.findByText(card.bio)).toBeTruthy();
  expect(readCreatorCard).toHaveBeenCalledWith('pu', 'alice');
  expect(view.queryByText('社群簡介已儲存。')).toBeNull();
  fireEvent.press(view.getByLabelText('編輯社群簡介'));
  expect(view.getByLabelText('個人簡介').props.value).toBe(card.bio);
  fireEvent.changeText(view.getByLabelText('個人簡介'), draft.bio);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(view.queryByText('社群簡介已儲存。')).toBeNull();
  expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
  expect(view.getByLabelText('核對儲存結果')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
  expect(setDoc).toHaveBeenCalledTimes(1);
});

describe.each(['write', 'manual confirmation'])(
  'access loss during %s', (stage) => {
    test.each([
      { code: 'permission-denied' },
      { code: 'firestore/unauthenticated' },
      new Error('Creator card scope mismatch'),
    ])('hides protected content and retains the write ticket after %p', async (error) => {
      const card = { headline: '', bio: '撤權前的簡介', linkUrl: 'https://example.org/' };
      const draft = { ...card, bio: '仍需核對的草稿' };
      const reads = jest.mocked(readCreatorCard).mockResolvedValueOnce(card);
      if (stage === 'manual confirmation') reads.mockRejectedValueOnce(error);
      reads.mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
      jest.mocked(saveCreatorCard).mockRejectedValueOnce(
        stage === 'write' ? error : new Error('unavailable'),
      );
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
      try {
        const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
        await view.findByLabelText('查看作品連結');
        const staleOpen = view.UNSAFE_root.findAll((node) =>
          node.props.accessibilityLabel === '查看作品連結' && typeof node.props.onPress === 'function'
        )[0]?.props.onPress as (() => void) | undefined;
        expect(staleOpen).toEqual(expect.any(Function));
        fireEvent.press(view.getByLabelText('編輯社群簡介'));
        fireEvent.changeText(view.getByLabelText('個人簡介'), draft.bio);
        await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
        if (stage === 'manual confirmation') {
          await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
        }
        expect(view.getByText('社群簡介暫時無法讀取。')).toBeTruthy();
        expect(view.queryByText(card.bio)).toBeNull();
        expect(view.queryByLabelText('查看作品連結')).toBeNull();
        await act(async () => { staleOpen!(); });
        expect(openURL).not.toHaveBeenCalled();

        await act(async () => { fireEvent.press(view.getByLabelText('重新讀取社群簡介')); });
        expect(view.getByText('社群簡介暫時無法讀取。')).toBeTruthy();
        expect(view.queryByText(card.bio)).toBeNull();
        await act(async () => { fireEvent.press(view.getByLabelText('重新讀取社群簡介')); });
        expect(reads).toHaveBeenLastCalledWith('pu', 'alice');
        expect(view.getByLabelText('個人簡介').props.value).toBe(draft.bio);
        expect(view.queryByText('社群簡介已儲存。')).toBeNull();
        expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
        await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
        expect(reads).toHaveBeenLastCalledWith('pu', 'alice', { requireCommitted: true });
        expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
        expect(saveCreatorCard).toHaveBeenCalledTimes(1);
      } finally {
        openURL.mockRestore();
      }
    });
  },
);
