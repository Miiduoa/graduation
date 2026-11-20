import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CreatorCardPanel } from '../screens/social/CreatorCardPanel';
import { readCreatorCard, saveCreatorCard } from '../services/creatorCard';

jest.mock('../services/creatorCard', () => ({
  readCreatorCard: jest.fn(),
  saveCreatorCard: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
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
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('permission-denied'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), '沒送出的草稿');
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(view.getByLabelText('個人簡介').props.value).toBe('沒送出的草稿');
  expect(view.getByText(/輸入內容已保留/)).toBeTruthy();
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


test('rapid save taps produce one write, and a rejected save can be retried', async () => {
  let rejectFirst: (reason: Error) => void = () => undefined;
  jest.mocked(saveCreatorCard).mockImplementationOnce(() => (
    new Promise<Awaited<ReturnType<typeof saveCreatorCard>>>((_, reject) => {
      rejectFirst = (reason) => reject(reason);
    })
  ));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), '校園社團活動與攝影作品');
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
  expect(view.getByText(/輸入內容已保留/)).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(2);
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
  expect(view.queryByText(/輸入內容已保留/)).toBeNull();
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
