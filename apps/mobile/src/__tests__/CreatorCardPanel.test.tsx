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
  readCreatorCard: jest.fn(),
  saveCreatorCard: jest.fn(),
}));

beforeEach(() => {
  // resetAllMocks on these two services prevents an unconsumed one-shot
  // implementation in a failed test from leaking into the next student's flow.
  jest.clearAllMocks();
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
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('permission-denied'));
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
test('an initial profile read can succeed after timeout before retry', async () => {
  jest.useFakeTimers();
  try {
    const card = { headline: '既有社群簡介', bio: '社團活動', linkUrl: '' };
    let resolveRead!: (value: typeof card) => void;
    jest.mocked(readCreatorCard).mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="bob" own={false} />);
    act(() => { jest.advanceTimersByTime(15_000); });
    expect(view.getByText('讀取社群簡介逾時，請重新讀取。')).toBeTruthy();

    await act(async () => { resolveRead(card); });
    expect(view.getByText(card.headline)).toBeTruthy();
    expect(view.queryByLabelText('重新讀取社群簡介')).toBeNull();
    expect(readCreatorCard).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});


test.each([false, true])('a successful profile retry ignores a late initial result (rejects: %s)', async (rejects) => {
  jest.useFakeTimers();
  try {
    let resolveOld!: (value: Awaited<ReturnType<typeof readCreatorCard>>) => void;
    let rejectOld!: (error: Error) => void;
    const stalled = new Promise<Awaited<ReturnType<typeof readCreatorCard>>>((resolve, reject) => {
      resolveOld = resolve;
      rejectOld = reject;
    });
    jest.mocked(readCreatorCard)
      .mockReturnValueOnce(stalled)
      .mockResolvedValueOnce({ headline: '新的社團介紹', bio: '社團活動', linkUrl: '' });

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="bob" own={false} />);
    expect(view.getByText('正在讀取社群簡介…')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    expect(view.getByText('讀取社群簡介逾時，請重新讀取。').props.accessibilityRole)
      .toBe('alert');
    fireEvent.press(view.getByLabelText('重新讀取社群簡介'));
    await act(async () => { await Promise.resolve(); });
    expect(readCreatorCard).toHaveBeenCalledTimes(2);
    expect(view.getByText('新的社團介紹')).toBeTruthy();

    // The first server request is still alive; it cannot restore stale
    // content over the successful retry or leak an old author's card.
    await act(async () => {
      if (rejects) rejectOld(new Error('initial read failed'));
      else resolveOld({ headline: '上次無效舊資料', bio: '', linkUrl: '' });
      await Promise.resolve();
    });
    expect(view.queryByText('上次無效舊資料')).toBeNull();
    expect(view.queryByLabelText('重新讀取社群簡介')).toBeNull();
    expect(view.getByText('新的社團介紹')).toBeTruthy();
    expect(saveCreatorCard).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test.each([false, true])('an initial success survives a failed retry (retry fails first: %s)', async (retryFailsFirst) => {
  jest.useFakeTimers();
  try {
    const card = { headline: '既有社群簡介', bio: '', linkUrl: '' };
    let resolveInitial!: (value: typeof card) => void;
    let rejectRetry!: (error: Error) => void;
    jest.mocked(readCreatorCard)
      .mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }))
      .mockReturnValueOnce(new Promise((_, reject) => { rejectRetry = reject; }));

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="bob" own={false} />);
    act(() => { jest.advanceTimersByTime(15_000); });
    fireEvent.press(view.getByLabelText('重新讀取社群簡介'));

    const failRetry = async () => act(async () => { rejectRetry(new Error('retry failed')); });
    if (retryFailsFirst) {
      await failRetry();
      expect(view.getByText('社群簡介暫時無法讀取。')).toBeTruthy();
    }
    await act(async () => { resolveInitial(card); });
    if (!retryFailsFirst) await failRetry();

    expect(view.getByText(card.headline)).toBeTruthy();
    expect(view.queryByLabelText('重新讀取社群簡介')).toBeNull();
    expect(readCreatorCard).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test.each([
  ['empty', 'card', false],
  ['empty', 'card', true],
  ['card', 'empty', false],
  ['card', 'empty', true],
  ['card', 'card', false],
  ['empty', 'empty', false],
  ['empty', 'empty', true],
  ['empty', 'error', false],
  ['empty', 'error', true],
  ['error', 'empty', true],
] as const)('initial %s and retry %s (retry settles first: %s)', async (initial, retry, retryFirst) => {
  jest.useFakeTimers();
  try {
    const cards = [
      { headline: '首次讀到的卡片', bio: '', linkUrl: '' },
      { headline: '重試讀到的卡片', bio: '', linkUrl: '' },
    ];
    const reads = [initial, retry].map((outcome, index) => {
      let settle!: () => void;
      jest.mocked(readCreatorCard).mockReturnValueOnce(new Promise((resolve, reject) => {
        settle = () => {
          if (outcome === 'error') reject(new Error('read failed'));
          else resolve(outcome === 'card' ? cards[index] : null);
        };
      }));
      return settle;
    });
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    act(() => { jest.advanceTimersByTime(15_000); });
    fireEvent.press(view.getByLabelText('重新讀取社群簡介'));
    expect(view.getByLabelText('重新讀取社群簡介')).toBeTruthy();

    await act(async () => { reads[retryFirst ? 1 : 0](); });
    if ((retryFirst ? retry : initial) !== 'card') {
      expect(view.getByLabelText('重新讀取社群簡介')).toBeTruthy();
      expect(view.queryByLabelText('建立社群簡介')).toBeNull();
    }
    await act(async () => { reads[retryFirst ? 0 : 1](); });

    if (retry === 'card' || initial === 'card') {
      expect(view.getByText(cards[retry === 'card' ? 1 : 0].headline)).toBeTruthy();
      expect(view.queryByLabelText('重新讀取社群簡介')).toBeNull();
    } else if (retry === 'empty') {
      expect(view.getByLabelText('建立社群簡介')).toBeTruthy();
      expect(view.queryByLabelText('重新讀取社群簡介')).toBeNull();
    } else {
      expect(view.getByLabelText('重新讀取社群簡介')).toBeTruthy();
      expect(view.queryByLabelText('建立社群簡介')).toBeNull();

      jest.mocked(readCreatorCard).mockResolvedValueOnce(cards[1]);
      await act(async () => { fireEvent.press(view.getByLabelText('重新讀取社群簡介')); });
      expect(view.getByText(cards[1].headline)).toBeTruthy();
    }
  } finally {
    jest.useRealTimers();
  }
});

test('a saved card supersedes all outstanding profile reads across multiple retries', async () => {
  jest.useFakeTimers();
  try {
    const published = { headline: '第一次讀到的卡片', bio: '', linkUrl: '' };
    const saved = { ...published, headline: '剛儲存的標題' };
    const reads = Array.from({ length: 3 }, () => {
      let resolveRead!: (value: typeof published | null) => void;
      jest.mocked(readCreatorCard).mockReturnValueOnce(new Promise((resolve) => {
        resolveRead = resolve;
      }));
      return resolveRead;
    });
    jest.mocked(saveCreatorCard).mockResolvedValueOnce(saved);
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    for (let retry = 0; retry < 2; retry++) {
      act(() => { jest.advanceTimersByTime(15_000); });
      fireEvent.press(view.getByLabelText('重新讀取社群簡介'));
    }
    expect(readCreatorCard).toHaveBeenCalledTimes(3);

    await act(async () => { reads[1](null); });
    expect(view.getByLabelText('重新讀取社群簡介')).toBeTruthy();
    await act(async () => { reads[0](published); });
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    fireEvent.changeText(view.getByLabelText('一句話介紹'), saved.headline);
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    await act(async () => { reads[2]({ ...published, headline: '重試讀到的舊資料' }); });
    expect(view.getByText(saved.headline)).toBeTruthy();
    expect(view.queryByText('重試讀到的舊資料')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
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

test('changing a portfolio URL releases the obsolete OS handoff without unlocking the new one', async () => {
  let rejectOld!: (error: Error) => void;
  let rejectNew!: (error: Error) => void;
  const oldHandoff = new Promise<void>((_, reject) => { rejectOld = reject; });
  const newHandoff = new Promise<void>((_, reject) => { rejectNew = reject; });
  const openURL = jest.spyOn(Linking, 'openURL')
    .mockImplementationOnce(() => oldHandoff)
    .mockImplementationOnce(() => newHandoff)
    .mockResolvedValue(undefined);
  jest.mocked(readCreatorCard).mockResolvedValue({
    headline: '社團', bio: '作品', linkUrl: 'https://old.example.org/',
  });
  jest.mocked(saveCreatorCard).mockResolvedValue({
    headline: '社團', bio: '作品', linkUrl: 'https://new.example.org/',
  });
  try {
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    fireEvent.press(await view.findByLabelText('查看作品連結'));
    expect(openURL).toHaveBeenCalledWith('https://old.example.org/');

    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    fireEvent.changeText(view.getByLabelText('作品連結'), 'https://new.example.org/');
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });

    // The old OS request is deliberately still pending, but the new URL
    // must be actionable rather than inheriting the obsolete busy state.
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
    act(() => { fireEvent.press(view.getByLabelText('查看作品連結')); });
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(openURL).toHaveBeenNthCalledWith(2, 'https://new.example.org/');
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });

    // Settling the old handoff cannot release the new handoff's lock or show
    // an error for the URL that has already replaced it.
    await act(async () => { rejectOld(new Error('old handoff failed')); });
    expect(view.queryByText('無法開啟作品連結，請稍後再試。')).toBeNull();
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });
    act(() => { fireEvent.press(view.getByLabelText('查看作品連結')); });
    expect(openURL).toHaveBeenCalledTimes(2);

    await act(async () => { rejectNew(new Error('new handoff failed')); });
    expect(view.getByText('無法開啟作品連結，請稍後再試。').props.accessibilityRole)
      .toBe('alert');
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
    await act(async () => { fireEvent.press(view.getByLabelText('查看作品連結')); });
    expect(openURL).toHaveBeenCalledTimes(3);
  } finally {
    openURL.mockRestore();
  }
});

test('a stalled portfolio link unlocks with guidance and ignores its late failure during manual retry', async () => {
  jest.useFakeTimers();
  let rejectStalled!: (error: Error) => void;
  let finishRetry!: () => void;
  const stalled = new Promise<void>((_, reject) => { rejectStalled = reject; });
  const retried = new Promise<void>((resolve) => { finishRetry = resolve; });
  const openURL = jest.spyOn(Linking, 'openURL')
    .mockImplementationOnce(() => stalled)
    .mockImplementationOnce(() => retried);
  jest.mocked(readCreatorCard).mockResolvedValue({
    headline: '社團', bio: '我的作品', linkUrl: 'https://portfolio.example.org/',
  });
  try {
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    await act(async () => { await Promise.resolve(); });
    act(() => { fireEvent.press(view.getByLabelText('查看作品連結')); });
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });

    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    expect(view.getByText(/開啟作品連結等待逾時/).props.accessibilityRole).toBe('alert');
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });

    // A new handoff is only attempted when the student explicitly presses.
    act(() => { fireEvent.press(view.getByLabelText('查看作品連結')); });
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(openURL).toHaveBeenNthCalledWith(2, 'https://portfolio.example.org/');
    expect(view.queryByText(/開啟作品連結等待逾時/)).toBeNull();
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });

    await act(async () => {
      rejectStalled(new Error('late failure of first OS handoff'));
      await Promise.resolve();
    });
    expect(view.queryByText('無法開啟作品連結，請稍後再試。')).toBeNull();
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });

    await act(async () => {
      finishRetry();
      await Promise.resolve();
    });
    expect(view.getByLabelText('查看作品連結').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
    expect(view.queryByText(/開啟作品連結等待逾時/)).toBeNull();
  } finally {
    openURL.mockRestore();
    jest.useRealTimers();
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
  fireEvent.press(view.getByLabelText('編輯社群簡介'));
  expect(view.getByLabelText('個人簡介').props.value).toBe('讀取途中送達的新介紹');
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

test('a cancelled uncertain edit can be confirmed from the published view without a second write', async () => {
  const published = { headline: '社團簡介', bio: '已發布的介紹', linkUrl: '' };
  const submitted = { ...published, bio: '新的校園社團活動' };
  jest.mocked(readCreatorCard).mockResolvedValueOnce(published)
    .mockRejectedValueOnce(new Error('offline during confirmation'))
    .mockResolvedValueOnce(submitted);
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('confirmation lost after write'));

  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), submitted.bio);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);

  fireEvent.press(view.getByLabelText('取消編輯'));
  expect(view.getByText(published.bio)).toBeTruthy();
  expect(view.getByText(/儲存結果尚未確認/).props.accessibilityRole).toBe('alert');
  const recheck = view.getByLabelText('核對儲存結果');
  expect(recheck.props.accessibilityState).toMatchObject({ disabled: false, busy: false });
  expect(view.queryByLabelText('個人簡介')).toBeNull();

  await act(async () => { fireEvent.press(recheck); });
  expect(view.getByText(/仍無法核對伺服器資料/).props.accessibilityRole).toBe('alert');
  expect(view.getByLabelText('核對儲存結果')).toBeTruthy();
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('編輯社群簡介'));
  expect(view.getByLabelText('個人簡介').props.value).toBe(submitted.bio);
  fireEvent.press(view.getByLabelText('取消編輯'));

  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(readCreatorCard).toHaveBeenLastCalledWith('pu', 'alice', { requireCommitted: true });
  expect(view.getByText(submitted.bio)).toBeTruthy();
  expect(view.queryByLabelText('核對儲存結果')).toBeNull();
  expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
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

test.each([
  [{ headline: '舊標題', bio: '已發布的介紹', linkUrl: 'https://example.org' }, '', ''],
  [{ headline: '舊標題', bio: '已發布的介紹', linkUrl: 'https://example.org' }, '未送出的簡介', '無效網址'],
  [null, '未送出的簡介', 'https://example.net'],
] as const)('cancel discards unsubmitted fields (published: %j, bio: %s, link: %s)', async (
  published, bio, link,
) => {
  jest.mocked(readCreatorCard).mockResolvedValueOnce(published);
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  const editLabel = published ? '編輯社群簡介' : '建立社群簡介';
  fireEvent.press(await view.findByLabelText(editLabel));
  fireEvent.changeText(view.getByLabelText('一句話介紹'), '取消的標題');
  fireEvent.changeText(view.getByLabelText('個人簡介'), bio);
  fireEvent.changeText(view.getByLabelText('作品連結'), link);
  if (link === '無效網址') {
    fireEvent.press(view.getByLabelText('儲存簡介'));
    expect(view.getByRole('alert')).toBeTruthy();
  }
  fireEvent.press(view.getByLabelText('取消編輯'));
  expect(saveCreatorCard).not.toHaveBeenCalled();

  fireEvent.press(view.getByLabelText(editLabel));
  expect(view.getByLabelText('一句話介紹').props.value).toBe(published?.headline ?? '');
  expect(view.getByLabelText('個人簡介').props.value).toBe(published?.bio ?? '');
  expect(view.getByLabelText('作品連結').props.value).toBe(published?.linkUrl ?? '');
  fireEvent.changeText(view.getByLabelText('一句話介紹'), '新標題');
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledWith('pu', 'alice', {
    headline: '新標題', bio: published?.bio ?? '', linkUrl: published?.linkUrl ?? '',
  });
});

test.each([
  { headline: '其他裝置的標題', bio: '其他裝置的介紹', linkUrl: '' },
  null,
])('a published-view mismatch preserves the draft when the server returns %j', async (latest) => {
  const published = { headline: '舊標題', bio: '已發布的介紹', linkUrl: '' };
  const draft = { headline: published.headline, bio: '待核對的介紹', linkUrl: 'https://example.org' };
  jest.mocked(readCreatorCard).mockResolvedValueOnce(published).mockResolvedValueOnce(latest);
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('offline after write'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), draft.bio);
  fireEvent.changeText(view.getByLabelText('作品連結'), draft.linkUrl);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  fireEvent.press(view.getByLabelText('取消編輯'));

  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(view.getByText(/伺服器資料與上次送出的內容不同/)).toBeTruthy();
  expect(view.queryByText(published.bio)).toBeNull();
  if (latest) expect(view.getByText(latest.bio)).toBeTruthy();
  fireEvent.press(view.getByLabelText(latest ? '編輯社群簡介' : '建立社群簡介'));
  expect(view.getByLabelText('一句話介紹').props.value).toBe(draft.headline);
  expect(view.getByLabelText('個人簡介').props.value).toBe(draft.bio);
  expect(view.getByLabelText('作品連結').props.value).toBe(draft.linkUrl);
  expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(false);
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
});

test.each([false, true])('an editor mismatch permits an explicit resend (edited after submit: %s)', async (editAfterSubmit) => {
  const latest = { headline: '其他裝置的標題', bio: '其他裝置的介紹', linkUrl: '' };
  const submitted = { headline: '', bio: '新的待儲存草稿', linkUrl: '' };
  const draft = { ...submitted, bio: editAfterSubmit ? '送出後繼續修改的草稿' : submitted.bio };
  jest.mocked(readCreatorCard).mockResolvedValueOnce(null).mockResolvedValueOnce(latest);
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('unavailable'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), submitted.bio);

  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  if (editAfterSubmit) fireEvent.changeText(view.getByLabelText('個人簡介'), draft.bio);
  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('個人簡介').props.value).toBe(draft.bio);
  expect(view.getByText(/伺服器資料與上次送出的內容不同/)).toBeTruthy();
  expect(view.queryByLabelText('核對儲存結果')).toBeNull();
  expect(view.getByLabelText('儲存簡介').props.accessibilityState).toMatchObject({ disabled: false });

  if (editAfterSubmit) {
    fireEvent.press(view.getByLabelText('取消編輯'));
    expect(view.getByText(latest.bio)).toBeTruthy();
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    expect(view.getByLabelText('個人簡介').props.value).toBe(draft.bio);
  }
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(2);
  expect(saveCreatorCard).toHaveBeenNthCalledWith(2, 'pu', 'alice', draft);
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

test.each(['late success', 'successful retry', 'failed retry'])(
  'a stalled server confirmation times out and then resolves through %s', async (outcome) => {
  jest.useFakeTimers();
  try {
    const card = { headline: '', bio: '這次儲存的校園介紹', linkUrl: '' };
    let resolveStalled!: (value: typeof card) => void;
    const stalled = new Promise<typeof card>((resolve) => { resolveStalled = resolve; });
    jest.mocked(readCreatorCard)
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(stalled)
      .mockImplementationOnce(async () => {
        if (outcome === 'failed retry') throw new Error('retry failed');
        return card;
      });
    jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('confirmation lost after write'));

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(view.getByLabelText('建立社群簡介'));
    fireEvent.changeText(view.getByLabelText('個人簡介'), card.bio);
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    expect(saveCreatorCard).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByLabelText('核對儲存結果'));
    expect(view.getByLabelText('正在核對伺服器…')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    expect(view.getByText(/核對等待逾時/)).toBeTruthy();
    expect(view.getByLabelText('核對儲存結果').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
    expect(view.getByLabelText('個人簡介').props.value).toBe(card.bio);
    expect(saveCreatorCard).toHaveBeenCalledTimes(1);

    if (outcome !== 'late success') {
      await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
      expect(readCreatorCard).toHaveBeenCalledTimes(3);
      if (outcome === 'failed retry') {
        expect(view.getByText(/仍無法核對伺服器資料/)).toBeTruthy();
      }
    }

    await act(async () => {
      resolveStalled(outcome === 'successful retry' ? { ...card, bio: '過時的舊讀取結果' } : card);
    });
    expect(readCreatorCard).toHaveBeenLastCalledWith('pu', 'alice', { requireCommitted: true });
    if (outcome === 'failed retry') {
      expect(view.queryByText('社群簡介已儲存。')).toBeNull();
      expect(view.getByText(/仍無法核對伺服器資料/)).toBeTruthy();
      expect(view.getByLabelText('個人簡介').props.value).toBe(card.bio);
      expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
      expect(view.getByLabelText('核對儲存結果')).toBeTruthy();
      return;
    }
    expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
    expect(view.queryByLabelText('核對儲存結果')).toBeNull();
    expect(view.getByText('這次儲存的校園介紹')).toBeTruthy();
    expect(view.queryByText('過時的舊讀取結果')).toBeNull();
    expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test.each([2, 3])('only the latest of %i published-view checks can update the card', async (checkCount) => {
  jest.useFakeTimers();
  try {
    const published = { headline: '', bio: '原本已發布的介紹', linkUrl: '' };
    const submitted = { ...published, bio: '這次送出的草稿' };
    const updated = { ...published, bio: '其他裝置已更新的介紹' };
    const reads = jest.mocked(readCreatorCard).mockResolvedValueOnce(published);
    jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('confirmation lost'));
    const checks = Array.from({ length: checkCount }, () => {
      let resolve!: (card: typeof published) => void;
      let reject!: (error: Error) => void;
      reads.mockReturnValueOnce(new Promise((resolveRead, rejectRead) => {
        resolve = resolveRead;
        reject = rejectRead;
      }));
      return { resolve, reject };
    });

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    fireEvent.changeText(view.getByLabelText('個人簡介'), submitted.bio);
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    fireEvent.press(view.getByLabelText('取消編輯'));

    for (let i = 0; i < checkCount; i++) {
      fireEvent.press(view.getByLabelText('核對儲存結果'));
      expect(view.getByLabelText('編輯社群簡介').props.accessibilityState.disabled).toBe(true);
      if (i < checkCount - 1) {
        act(() => { jest.advanceTimersByTime(15_000); });
        expect(view.getByText(/核對等待逾時/)).toBeTruthy();
        expect(view.getByLabelText('編輯社群簡介').props.accessibilityState.disabled).toBe(false);
      }
    }
    expect(readCreatorCard).toHaveBeenCalledTimes(checkCount + 1);

    await act(async () => { checks[0].resolve(submitted); });
    expect(view.getByLabelText('正在核對伺服器…').props.accessibilityState.busy).toBe(true);
    expect(view.getByText(published.bio)).toBeTruthy();
    expect(view.queryByText(submitted.bio)).toBeNull();
    expect(view.queryByText('社群簡介已儲存。')).toBeNull();

    if (checkCount === 3) {
      await act(async () => { checks[1].reject(new Error('stale check failed')); });
      expect(view.getByLabelText('正在核對伺服器…').props.accessibilityState.busy).toBe(true);
      expect(view.queryByText(/仍無法核對伺服器資料/)).toBeNull();
    }

    await act(async () => { checks[checkCount - 1].resolve(updated); });
    expect(view.getByText(updated.bio)).toBeTruthy();
    expect(view.queryByText(submitted.bio)).toBeNull();
    expect(view.queryByLabelText('核對儲存結果')).toBeNull();
    expect(view.getByText(/伺服器資料與上次送出的內容不同/)).toBeTruthy();
    expect(view.getByLabelText('編輯社群簡介').props.accessibilityState.disabled).toBe(false);
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    expect(view.getByLabelText('個人簡介').props.value).toBe(submitted.bio);
    expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test.each([
  { hasPendingWrites: false, manualCheck: false },
  { hasPendingWrites: true, manualCheck: false },
  { hasPendingWrites: false, manualCheck: true },
])('a late save respects pending writes ($hasPendingWrites) during a manual check ($manualCheck)', async ({
  hasPendingWrites, manualCheck,
}) => {
  jest.useFakeTimers();
  try {
    const card = { headline: '', bio: '我的校園作品', linkUrl: '' };
    let resolveWrite!: () => void;
    jest.mocked(setDoc).mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveWrite = resolve;
    }));
    jest.mocked(getDocFromServer).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ schoolId: 'pu', ownerUid: 'alice', ...card }),
      metadata: { hasPendingWrites },
    } as never);
    jest.mocked(saveCreatorCard).mockImplementationOnce(
      jest.requireActual<typeof import('../services/creatorCard')>('../services/creatorCard').saveCreatorCard,
    );

    let resolveCheck!: (value: null) => void;
    jest.mocked(readCreatorCard).mockResolvedValueOnce(null).mockReturnValueOnce(
      new Promise((resolve) => { resolveCheck = resolve; }),
    );

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(view.getByLabelText('建立社群簡介'));
    fireEvent.changeText(view.getByLabelText('個人簡介'), card.bio);
    fireEvent.press(view.getByLabelText('儲存簡介'));
    act(() => { jest.advanceTimersByTime(15_000); });
    expect(view.getByText(/無法確認簡介是否已儲存/)).toBeTruthy();
    expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);

    if (manualCheck) {
      fireEvent.press(view.getByLabelText('核對儲存結果'));
      expect(view.getByLabelText('正在核對伺服器…')).toBeTruthy();
    }
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      resolveWrite();
    });
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(getDocFromServer).toHaveBeenCalledTimes(1);
    expect(readCreatorCard).toHaveBeenCalledTimes(manualCheck ? 2 : 1);
    if (hasPendingWrites) {
      expect(view.queryByText('社群簡介已儲存。')).toBeNull();
      expect(view.getByLabelText('個人簡介').props.value).toBe(card.bio);
      expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
    } else {
      expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
      expect(view.getByText(card.bio)).toBeTruthy();
      expect(view.queryByLabelText('核對儲存結果')).toBeNull();
      expect(view.queryByLabelText('個人簡介')).toBeNull();
    }
    if (manualCheck) {
      await act(async () => { resolveCheck(null); });
      expect(view.getByText(card.bio)).toBeTruthy();
      expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
      fireEvent.press(view.getByLabelText('編輯社群簡介'));
      expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(false);
    }
  } finally {
    jest.useRealTimers();
  }
});

test('a stalled save preserves the draft until matching fields have no pending writes', async () => {
  jest.useFakeTimers();
  try {
    const card = { headline: '', bio: '我的校園作品', linkUrl: '' };
    let resolveStalled!: (value: Awaited<ReturnType<typeof saveCreatorCard>>) => void;
    const stalled = new Promise<Awaited<ReturnType<typeof saveCreatorCard>>>((resolve) => {
      resolveStalled = resolve;
    });
    const actualRead = jest.requireActual<typeof import('../services/creatorCard')>(
      '../services/creatorCard',
    ).readCreatorCard;
    const snapshot = {
      exists: () => true,
      data: () => ({ schoolId: 'pu', ownerUid: 'alice', ...card }),
    };
    jest.mocked(getDocFromServer)
      .mockResolvedValueOnce({ ...snapshot, metadata: { hasPendingWrites: true } } as never)
      .mockResolvedValueOnce({ ...snapshot, metadata: { hasPendingWrites: false } } as never);
    jest.mocked(readCreatorCard).mockResolvedValueOnce(null)
      .mockImplementationOnce(actualRead).mockImplementationOnce(actualRead);
    jest.mocked(saveCreatorCard).mockReturnValueOnce(stalled);

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(view.getByLabelText('建立社群簡介'));
    fireEvent.changeText(view.getByLabelText('個人簡介'), card.bio);
    act(() => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    expect(view.getByLabelText('正在確認儲存…').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: true });
    expect(saveCreatorCard).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    expect(view.getByText(/無法確認簡介是否已儲存/).props.accessibilityRole).toBe('alert');
    expect(view.getByLabelText('個人簡介').props.value).toBe(card.bio);
    expect(view.getByLabelText('儲存簡介').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: false });
    expect(view.getByLabelText('核對儲存結果').props.accessibilityState)
      .toMatchObject({ disabled: false, busy: false });
    expect(saveCreatorCard).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
    expect(view.queryByText('社群簡介已儲存。')).toBeNull();
    expect(view.getByText(/仍無法核對伺服器資料/)).toBeTruthy();
    expect(view.getByLabelText('個人簡介').props.value).toBe(card.bio);
    expect(view.getByLabelText('儲存簡介').props.accessibilityState)
      .toMatchObject({ disabled: true, busy: false });

    await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
    expect(getDocFromServer).toHaveBeenCalledTimes(2);
    expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
    await act(async () => {
      resolveStalled({ ...card, bio: '不應出現的過時結果' });
      await Promise.resolve();
    });
    expect(view.queryByText('不應出現的過時結果')).toBeNull();
    expect(view.getByText(card.bio)).toBeTruthy();
    expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
