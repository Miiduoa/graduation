import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { getDocFromServer, setDoc } from 'firebase/firestore';
import { creatorCardDocumentPassesRules, CREATOR_CARD_LIMITS } from '@campus/shared/src/creatorCard';
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
  }, expect.any(Function));
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

const existingCard = {
  headline: '原有標題', bio: '原有簡介', linkUrl: 'https://example.org',
};

describe.each(['open', 'closed', 'reopened'] as const)('confirmation with editor %s', (editor) => {
  const changes = { headline: '  送出的標題  ', bio: '\n\t送出的簡介\n', linkUrl: 'https://example.net' };
  const normalized = { headline: '送出的標題', bio: '送出的簡介', linkUrl: 'https://example.net/' };
  const original = { ...existingCard, linkUrl: 'https://example.org/' };
  const fields = [
    ['headline', '一句話介紹', '追加標題'],
    ['bio', '個人簡介', ''],
    ['linkUrl', '作品連結', '尚未完成的網址'],
  ] as const;
  const additions = [
    ['none', {}],
    ...fields.map(([field, , value]) => [field, { [field]: value }] as const),
    ['headline and bio', { headline: fields[0][2], bio: fields[1][2] }],
    ['headline and linkUrl', { headline: fields[0][2], linkUrl: fields[2][2] }],
    ['bio and linkUrl', { bio: fields[1][2], linkUrl: fields[2][2] }],
    ['all', Object.fromEntries(fields.map(([field, , value]) => [field, value]))],
  ] as const;

  const submissions = [
    ['all', changes, normalized],
    ['unchanged', original, original],
    ...fields.map(([field]) => [
      field, { ...original, [field]: changes[field] }, { ...original, [field]: normalized[field] },
    ] as const),
  ] as const;

  describe.each(submissions)('submitted fields: %s', (submission, submitted, confirmed) => {
    const mismatches = [
      ...(submission === 'all' ? [] : ['different field'] as const),
      ...(submission === 'unchanged' ? [] : ['same field'] as const),
    ];
    describe.each(additions)('post-submit edits: %s', (_scenario, patch: Partial<typeof changes>) => {
      test.each(['late acknowledgement', 'manual match', ...mismatches, 'missing', 'failure', 'timeout'] as const)(
        '%s', async (outcome) => {
          jest.useFakeTimers();
          try {
            let acknowledge!: () => void;
            let completeCheck!: (value: typeof confirmed | null) => void;
            let failCheck!: (reason: Error) => void;
            const check = new Promise<typeof confirmed | null>((resolve, reject) => {
              completeCheck = resolve;
              failCheck = reject;
            });
            const saves = jest.mocked(saveCreatorCard);
            const reads = jest.mocked(readCreatorCard);
            const getServerCard = jest.fn(() => check);
            saves.mockImplementationOnce(async (_school, _owner, _draft, confirmWrite) => {
              await new Promise<void>((resolve) => { acknowledge = resolve; });
              return confirmWrite!(getServerCard) as Promise<typeof confirmed>;
            });
            reads.mockResolvedValueOnce(original).mockReturnValueOnce(check);
            const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
            await act(async () => {});
            const open = (label = '編輯社群簡介') => fireEvent.press(view.getByLabelText(label));
            const expectDraft = (expected: typeof submitted) => {
              for (const [field, label] of fields) {
                expect(view.getByLabelText(label).props.value).toBe(expected[field]);
              }
            };

            open();
            for (const [field, label] of fields) {
              fireEvent.changeText(view.getByLabelText(label), submitted[field]);
            }
            fireEvent.press(view.getByLabelText('儲存簡介'));
            act(() => { jest.advanceTimersByTime(15_000); });
            for (const [field, label] of fields) {
              const value = patch[field];
              if (value !== undefined) fireEvent.changeText(view.getByLabelText(label), value);
            }
            if (editor !== 'open') fireEvent.press(view.getByLabelText('取消編輯'));
            if (editor === 'reopened') {
              open();
              expectDraft({ ...submitted, ...patch });
            }

            if (outcome === 'late acknowledgement') await act(async () => { acknowledge(); });
            else fireEvent.press(view.getByLabelText('核對儲存結果'));

            if (outcome === 'failure') {
              await act(async () => { failCheck(new Error('offline')); });
              if (editor === 'closed') open();
              // A failed read leaves the pending submission and its full draft intact, as at merge-base.
              expectDraft({ ...submitted, ...patch });
              expect(view.getByLabelText('核對儲存結果')).toBeTruthy();
              expect(view.queryByLabelText('還原未確認的草稿')).toBeNull();
              expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
            } else {
              if (outcome === 'timeout') {
                act(() => { jest.advanceTimersByTime(15_000); });
                expect(view.getByText(/核對等待逾時/)).toBeTruthy();
                expect(view.queryByLabelText('還原未確認的草稿')).toBeNull();
                if (editor !== 'closed') {
                  expectDraft({ ...submitted, ...patch });
                  expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
                }
              }
              const edited = fields.filter(([field]) => submitted[field] !== original[field]);
              const changedField = (outcome === 'same field'
                ? edited[0] : fields.find(([field]) => submitted[field] === original[field]))?.[0] ?? 'headline';
              const mismatch = outcome === 'same field' || outcome === 'different field';
              const latest = outcome === 'missing' ? null : mismatch
                ? { ...confirmed, [changedField]: changedField === 'linkUrl'
                  ? 'https://example.com/' : '另一裝置的內容' }
                : confirmed;
              await act(async () => { completeCheck(latest); });

              const baseline = latest ?? { headline: '', bio: '', linkUrl: '' };
              const recovered = { ...baseline };
              const localDraft = { ...submitted, ...patch };
              const recoverableFields = fields.filter(([field]) => !latest || patch[field] !== undefined ||
                (mismatch && submitted[field] !== original[field]));
              for (const [field] of recoverableFields) recovered[field] = localDraft[field];

              // Merge-base beginEdit reloads the most recent successful read
              // after pendingWrite is cleared, including a missing document.
              if (view.queryByLabelText('取消編輯')) fireEvent.press(view.getByLabelText('取消編輯'));
              open(latest ? '編輯社群簡介' : '建立社群簡介');
              expectDraft(baseline);
              expect(view.queryByLabelText('核對儲存結果')).toBeNull();
              expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(false);

              // This PR adds explicit recovery for post-submit inputs and
              // failed submissions. A deleted card can recover its full draft.
              const restore = view.queryByLabelText('還原未確認的草稿');
              expect(Boolean(restore)).toBe(recoverableFields.length > 0);
              if (restore) {
                fireEvent.press(restore);
                expectDraft(recovered);
              }
            }
            expect(saves).toHaveBeenCalledTimes(1);
            expect(getServerCard).toHaveBeenCalledTimes(outcome === 'late acknowledgement' ? 1 : 0);
          } finally {
            jest.useRealTimers();
          }
        },
      );
    });
  });
});

test('a stalled profile read keeps loading without allowing a retry or save', () => {
  jest.useFakeTimers();
  try {
    jest.mocked(readCreatorCard).mockReturnValueOnce(new Promise(() => {}));
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(view.getByText('正在讀取社群簡介…')).toBeTruthy();
    expect(view.queryByLabelText('重新讀取社群簡介')).toBeNull();
    expect(view.queryByLabelText('建立社群簡介')).toBeNull();
    expect(view.queryByLabelText('儲存簡介')).toBeNull();
    expect(readCreatorCard).toHaveBeenCalledTimes(1);
    expect(saveCreatorCard).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test.each([
  ['initial card', 0, existingCard],
  ['initial null', 0, null],
  ['retried card', 1, existingCard],
  ['retried null after another failure', 2, null],
] as const)('%s gates saving until the read succeeds', async (_scenario, failures, card) => {
  for (let i = 0; i < failures; i += 1) {
    jest.mocked(readCreatorCard).mockRejectedValueOnce(new Error('read failed'));
  }
  let resolveRead!: (value: typeof card) => void;
  jest.mocked(readCreatorCard).mockReturnValueOnce(new Promise((resolve) => {
    resolveRead = resolve;
  }));
  const saved = { ...(card ?? { bio: '', linkUrl: '' }), headline: '新標題' };
  jest.mocked(saveCreatorCard).mockResolvedValueOnce(saved);

  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  for (let i = 0; i < failures; i += 1) {
    const retry = await view.findByLabelText('重新讀取社群簡介');
    expect(view.getByText('社群簡介暫時無法讀取。')).toBeTruthy();
    expect(view.queryByLabelText('建立社群簡介')).toBeNull();
    expect(view.queryByLabelText('編輯社群簡介')).toBeNull();
    expect(view.queryByLabelText('儲存簡介')).toBeNull();
    fireEvent.press(retry);
    expect(view.getByText('正在讀取社群簡介…')).toBeTruthy();
  }

  expect(view.getByText('正在讀取社群簡介…')).toBeTruthy();
  expect(view.queryByLabelText('重新讀取社群簡介')).toBeNull();
  expect(view.queryByLabelText('建立社群簡介')).toBeNull();
  expect(view.queryByLabelText('編輯社群簡介')).toBeNull();
  expect(view.queryByLabelText('儲存簡介')).toBeNull();
  expect(saveCreatorCard).not.toHaveBeenCalled();

  await act(async () => { resolveRead(card); });
  fireEvent.press(view.getByLabelText(card ? '編輯社群簡介' : '建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('一句話介紹'), saved.headline);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(saveCreatorCard).toHaveBeenCalledWith('pu', 'alice', saved, expect.any(Function));
  expect(view.getByText(saved.headline)).toBeTruthy();
  expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
  expect(readCreatorCard).toHaveBeenCalledTimes(failures + 1);
});

test.each([
  ['before save', false, false],
  ['after save', true, false],
  ['after save with a rejection', true, true],
] as const)('a superseded profile read that settles %s cannot affect the retried card', async (
  _scenario, settleAfterSave, rejectOld,
) => {
  let settleOldRead!: () => void;
  let resolveRetry!: (value: typeof existingCard) => void;
  jest.mocked(readCreatorCard)
    .mockReturnValueOnce(new Promise((resolve, reject) => {
      settleOldRead = () => {
        if (rejectOld) reject(new Error('old read failed'));
        else resolve(null);
      };
    }))
    .mockRejectedValueOnce(new Error('read failed'))
    .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));
  const saved = { ...existingCard, headline: '新標題' };
  jest.mocked(saveCreatorCard).mockResolvedValueOnce(saved);
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="bob" own />);
  view.rerender(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('重新讀取社群簡介'));

  if (!settleAfterSave) await act(async () => { settleOldRead(); });
  expect(view.getByText('正在讀取社群簡介…')).toBeTruthy();
  expect(view.queryByLabelText('建立社群簡介')).toBeNull();
  expect(view.queryByLabelText('儲存簡介')).toBeNull();

  await act(async () => { resolveRetry(existingCard); });
  fireEvent.press(view.getByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('一句話介紹'), saved.headline);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  if (settleAfterSave) await act(async () => { settleOldRead(); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(saveCreatorCard).toHaveBeenCalledWith('pu', 'alice', saved, expect.any(Function));
  expect(view.getByText(saved.headline)).toBeTruthy();
  expect(view.getByText(saved.bio)).toBeTruthy();
  expect(view.queryByLabelText('重新讀取社群簡介')).toBeNull();
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

  fireEvent.press(view.getByLabelText('還原未確認的草稿'));
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenCalledTimes(2);
  expect(saveCreatorCard).toHaveBeenLastCalledWith('pu', 'alice', {
    headline: '', bio: '校園社團活動與攝影作品', linkUrl: '',
  }, expect.any(Function));
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
  }, expect.any(Function));
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

test('confirmation requires every submitted field and retains the editor on mismatch', async () => {
  const published = { headline: '舊標題', bio: '舊簡介', linkUrl: '' };
  const latest = { headline: '我的標題', bio: '更新的簡介', linkUrl: 'https://example.org/new' };
  jest.mocked(readCreatorCard).mockResolvedValueOnce(published).mockResolvedValueOnce(latest);
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('confirmation lost'));

  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('一句話介紹'), latest.headline);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });

  expect(view.getByText(/伺服器資料與上次送出的內容不同/)).toBeTruthy();
  expect(view.getByLabelText('個人簡介').props.value).toBe(latest.bio);
  expect(view.getByLabelText('作品連結').props.value).toBe(latest.linkUrl);
  expect(view.queryByLabelText('核對儲存結果')).toBeNull();
  expect(view.getByLabelText('還原未確認的草稿')).toBeTruthy();
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
});

test.each([
  ['headline', '一句話介紹', '讀取途中送達的新標題'],
  ['bio', '個人簡介', '讀取途中送達的新介紹'],
  ['linkUrl', '作品連結', 'https://example.org/new'],
] as const)('confirmation retains a queued %s event in the draft', async (field, label, value) => {
  const card = { headline: '', bio: '已送出的介紹', linkUrl: '' };
  let resolveRead!: (value: typeof card) => void;
  const confirmation = new Promise<typeof card>((resolve) => { resolveRead = resolve; });
  jest.mocked(readCreatorCard).mockResolvedValueOnce(null).mockReturnValueOnce(confirmation);
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('offline after write'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('建立社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), ` ${card.bio} `);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });

  const onChangeText = view.getByLabelText(label).props.onChangeText;
  fireEvent.press(view.getByLabelText('核對儲存結果'));
  expect(view.getByLabelText('正在核對伺服器…')).toBeTruthy();
  expect(view.getByLabelText(label).props.editable).toBe(false);
  await act(async () => {
    onChangeText(value);
    resolveRead(card);
  });

  expect(view.getByLabelText(label).props.value).toBe(value);
  expect(view.getByText(/上一筆已確認儲存/)).toBeTruthy();
  expect(view.queryByLabelText('核對儲存結果')).toBeNull();
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);

  jest.mocked(saveCreatorCard).mockResolvedValueOnce({ ...card, [field]: value });
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenNthCalledWith(2, 'pu', 'alice',
    { ...card, [field]: value }, expect.any(Function), [field]);
});

test('clearing a hidden link during confirmation preserves the explicit edit', async () => {
  const published = { headline: '舊標題', bio: '已發布的簡介', linkUrl: '' };
  const latest = { ...published, headline: '送出的標題', linkUrl: 'https://example.org/new' };
  const service = jest.requireActual<typeof import('../services/creatorCard')>('../services/creatorCard');
  jest.mocked(getDocFromServer).mockResolvedValueOnce({
    exists: () => true,
    data: () => ({ ...published, schoolId: 'pu', ownerUid: 'alice', linkUrl: 'http://example.org/old' }),
  } as Awaited<ReturnType<typeof getDocFromServer>>);
  let resolveRead!: (value: typeof latest) => void;
  jest.mocked(readCreatorCard).mockImplementationOnce(service.readCreatorCard)
    .mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('offline after write'));

  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('一句話介紹'), latest.headline);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  const onChangeText = view.getByLabelText('作品連結').props.onChangeText;
  fireEvent.press(view.getByLabelText('核對儲存結果'));
  await act(async () => {
    onChangeText('');
    resolveRead(latest);
  });

  expect(view.getByLabelText('作品連結').props.value).toBe('');
  const next = { ...latest, linkUrl: '' };
  jest.mocked(saveCreatorCard).mockResolvedValueOnce(next);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenNthCalledWith(2, 'pu', 'alice', next, expect.any(Function), ['linkUrl']);
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

test('reopening preserves the full draft while confirmation is pending', async () => {
  jest.mocked(readCreatorCard).mockResolvedValueOnce({ headline: '', bio: '已發布的介紹', linkUrl: '' });
  jest.mocked(saveCreatorCard).mockRejectedValueOnce(new Error('offline after write'));
  const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.press(await view.findByLabelText('編輯社群簡介'));
  fireEvent.changeText(view.getByLabelText('個人簡介'), '待核對的介紹');
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });

  fireEvent.changeText(view.getByLabelText('個人簡介'), '');
  fireEvent.changeText(view.getByLabelText('作品連結'), 'https://example.net/');
  fireEvent.press(view.getByLabelText('取消編輯'));
  expect(view.getByText('已發布的介紹')).toBeTruthy();
  fireEvent.press(view.getByLabelText('編輯社群簡介'));
  expect(view.getByLabelText('個人簡介').props.value).toBe('');
  expect(view.getByLabelText('作品連結').props.value).toBe('https://example.net/');
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
  }, expect.any(Function));
});

test.each([
  { headline: '其他裝置的標題', bio: '其他裝置的介紹', linkUrl: '' },
  null,
])('a published-view mismatch reopens the latest card and restores explicitly when the server returns %j', async (latest) => {
  const published = { headline: '舊標題', bio: '已發布的介紹', linkUrl: '' };
  const draft = { headline: published.headline, bio: '待核對的介紹', linkUrl: 'https://example.org/' };
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
  expect(view.getByLabelText('一句話介紹').props.value).toBe(latest?.headline ?? '');
  expect(view.getByLabelText('個人簡介').props.value).toBe(latest?.bio ?? '');
  expect(view.getByLabelText('作品連結').props.value).toBe(latest?.linkUrl ?? '');
  expect(saveCreatorCard).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('還原未確認的草稿')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('一句話介紹'), '重新編輯的標題');
  const saved = {
    headline: '重新編輯的標題', bio: latest?.bio ?? '', linkUrl: latest?.linkUrl ?? '',
  };
  jest.mocked(saveCreatorCard).mockResolvedValueOnce(saved);
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenNthCalledWith(2, 'pu', 'alice', {
    headline: '重新編輯的標題', bio: latest?.bio ?? '', linkUrl: latest?.linkUrl ?? '',
  }, expect.any(Function), ...(latest ? [['headline']] : []));
  fireEvent.press(view.getByLabelText('編輯社群簡介'));
  fireEvent.press(view.getByLabelText('還原未確認的草稿'));
  expect(view.getByLabelText('一句話介紹').props.value).toBe(saved.headline);
  expect(view.getByLabelText('個人簡介').props.value).toBe(draft.bio);
  expect(view.getByLabelText('作品連結').props.value).toBe(draft.linkUrl);
  jest.mocked(saveCreatorCard).mockResolvedValueOnce({ ...saved, bio: draft.bio, linkUrl: draft.linkUrl });
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenNthCalledWith(3, 'pu', 'alice', {
    ...saved, bio: draft.bio, linkUrl: draft.linkUrl,
  }, expect.any(Function), ['bio', 'linkUrl']);
  fireEvent.press(view.getByLabelText('編輯社群簡介'));
  expect(view.queryByLabelText('還原未確認的草稿')).toBeNull();
});

test.each([
  [false, false],
  [true, false],
  [true, true],
])('editor mismatch (edited after submit: %s, cancelled: %s)', async (editAfterSubmit, cancel) => {
  const latest = { headline: '其他裝置的標題', bio: '其他裝置的介紹', linkUrl: 'https://example.net/' };
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

  expect(view.getByLabelText('一句話介紹').props.value).toBe(latest.headline);
  expect(view.getByLabelText('作品連結').props.value).toBe(latest.linkUrl);
  if (cancel) {
    fireEvent.press(view.getByLabelText('取消編輯'));
    expect(view.getByText(latest.bio)).toBeTruthy();
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    expect(view.getByLabelText('個人簡介').props.value).toBe(latest.bio);
    // A mismatch makes both the submitted and subsequent edits recoverable.
    fireEvent.press(view.getByLabelText('還原未確認的草稿'));
    expect(view.getByLabelText('個人簡介').props.value).toBe(draft.bio);
    fireEvent.press(view.getByLabelText('取消編輯'));
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    fireEvent.changeText(view.getByLabelText('一句話介紹'), '重新編輯的標題');
  } else if (!editAfterSubmit) {
    fireEvent.press(view.getByLabelText('還原未確認的草稿'));
  }
  await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
  expect(saveCreatorCard).toHaveBeenNthCalledWith(2, 'pu', 'alice',
    cancel ? { ...latest, headline: '重新編輯的標題' } : { ...latest, bio: draft.bio },
    expect.any(Function), [cancel ? 'headline' : 'bio']);
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

describe.each(['manual', 'automatic'] as const)('%s confirmation', (kind) => {
  test.each(['late success', 'failure then retry'] as const)(
    '%s keeps checks serial and saves blocked until a successful read', async (outcome) => {
      jest.useFakeTimers();
      try {
        const original = { headline: '舊標題', bio: '舊簡介', linkUrl: 'https://example.org/' };
        const submitted = { ...original, headline: '送出的標題' };
        const newer = { ...submitted, bio: '其他裝置的簡介', linkUrl: 'https://example.net/' };
        let resolveRead!: (value: typeof original) => void;
        let rejectRead!: (error: Error) => void;
        const stalled = new Promise<typeof original>((resolve, reject) => {
          resolveRead = resolve;
          rejectRead = reject;
        });
        const check = jest.fn(() => stalled);
        const reads = jest.mocked(readCreatorCard).mockResolvedValueOnce(original);
        const saves = jest.mocked(saveCreatorCard);
        if (kind === 'manual') {
          reads.mockImplementationOnce(check);
          saves.mockRejectedValueOnce(new Error('offline after write'));
        } else {
          saves.mockImplementationOnce(async (_school, _owner, _draft, confirm) => {
            const value = await confirm?.(check);
            if (!value) throw new Error('missing confirmation');
            return value;
          });
        }
        reads.mockResolvedValueOnce(newer);

        const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
        await act(async () => { await Promise.resolve(); });
        fireEvent.press(view.getByLabelText('編輯社群簡介'));
        fireEvent.changeText(view.getByLabelText('一句話介紹'), submitted.headline);
        await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
        const staleCheck = view.queryByLabelText('核對儲存結果')?.props.onPress;
        if (kind === 'manual') fireEvent.press(view.getByLabelText('核對儲存結果'));
        expect(view.getByText('核對中')).toBeTruthy();
        expect(view.getByLabelText('一句話介紹').props.editable).toBe(false);

        act(() => { jest.advanceTimersByTime(15_000); });
        expect(view.getByText(kind === 'manual' ? /核對等待逾時/ : /無法確認簡介是否已儲存/)).toBeTruthy();
        const busyCheck = view.getByLabelText('正在核對伺服器…');
        expect(busyCheck.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
        fireEvent.press(busyCheck);
        fireEvent.press(busyCheck);
        staleCheck?.();
        fireEvent.press(view.getByLabelText('取消編輯'));
        fireEvent.press(view.getByLabelText('儲存簡介'));
        expect(view.getByLabelText('一句話介紹').props.value).toBe(submitted.headline);
        expect(check).toHaveBeenCalledTimes(1);
        expect(reads).toHaveBeenCalledTimes(kind === 'manual' ? 2 : 1);
        expect(saves).toHaveBeenCalledTimes(1);

        if (outcome === 'late success') {
          await act(async () => { resolveRead(submitted); });
          expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
          expect(view.queryByLabelText('一句話介紹')).toBeNull();
          return;
        }

        await act(async () => { rejectRead(new Error('offline during check')); });
        expect(view.getByText(/仍無法核對伺服器資料/)).toBeTruthy();
        fireEvent.changeText(view.getByLabelText('一句話介紹'), '下一次修改的標題');
        fireEvent.press(view.getByLabelText('儲存簡介'));
        expect(saves).toHaveBeenCalledTimes(1);
        await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
        expect(view.getByLabelText('個人簡介').props.value).toBe(newer.bio);
        expect(view.getByLabelText('作品連結').props.value).toBe(newer.linkUrl);
        const next = { ...newer, headline: '下一次修改的標題' };
        saves.mockResolvedValueOnce(next);
        await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
        expect(saves).toHaveBeenNthCalledWith(2, 'pu', 'alice', next, expect.any(Function), ['headline']);
      } finally {
        jest.useRealTimers();
      }
    },
  );
});

test.each(['acknowledgement during check', 'acknowledgement after failure'] as const)(
  '%s cannot start a background confirmation or unblock saving', async (timing) => {
    jest.useFakeTimers();
    try {
      const card = { headline: '', bio: '送出的簡介', linkUrl: '' };
      const service = jest.requireActual<typeof import('../services/creatorCard')>('../services/creatorCard');
      jest.mocked(saveCreatorCard).mockImplementationOnce(service.saveCreatorCard);
      let acknowledgeWrite!: () => void;
      jest.mocked(setDoc).mockReturnValueOnce(new Promise((resolve) => { acknowledgeWrite = resolve; }));
      let rejectManual!: (error: Error) => void;
      jest.mocked(readCreatorCard).mockResolvedValueOnce(null)
        .mockReturnValueOnce(new Promise((_, reject) => { rejectManual = reject; }))
        .mockResolvedValueOnce(card);

      const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
      await act(async () => { await Promise.resolve(); });
      fireEvent.press(view.getByLabelText('建立社群簡介'));
      fireEvent.changeText(view.getByLabelText('個人簡介'), card.bio);
      fireEvent.press(view.getByLabelText('儲存簡介'));
      act(() => { jest.advanceTimersByTime(15_000); });
      fireEvent.press(view.getByLabelText('核對儲存結果'));

      if (timing === 'acknowledgement during check') {
        await act(async () => { acknowledgeWrite(); });
        expect(view.getByText('核對中')).toBeTruthy();
      }
      await act(async () => { rejectManual(new Error('offline')); });
      if (timing === 'acknowledgement after failure') await act(async () => { acknowledgeWrite(); });
      expect(getDocFromServer).not.toHaveBeenCalled();
      expect(view.getByText(/仍無法核對伺服器資料/)).toBeTruthy();
      expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
      await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
      expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
      expect(setDoc).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  },
);

test.each([
  { hasPendingWrites: false },
  { hasPendingWrites: true },
])('a late save respects pending writes ($hasPendingWrites) after timeout', async ({
  hasPendingWrites,
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

    jest.mocked(readCreatorCard).mockResolvedValueOnce(null);

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(view.getByLabelText('建立社群簡介'));
    fireEvent.changeText(view.getByLabelText('個人簡介'), card.bio);
    fireEvent.press(view.getByLabelText('儲存簡介'));
    act(() => { jest.advanceTimersByTime(15_000); });
    expect(view.getByText(/無法確認簡介是否已儲存/)).toBeTruthy();
    expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(1_000);
      resolveWrite();
    });
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(getDocFromServer).toHaveBeenCalledTimes(1);
    expect(readCreatorCard).toHaveBeenCalledTimes(1);
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

describe.each([
  ['headline', '一句話介紹', '  ', '舊標題', '新標題', 'bio', '個人簡介'],
  ['bio', '個人簡介', '  ', '舊簡介', '新簡介', 'headline', '一句話介紹'],
  ['linkUrl', '作品連結', 'https://localhost', 'https://example.org/old', 'https://example.org/new',
    'headline', '一句話介紹'],
] as const)('clearing %s', (field, label, hidden, visible, typed, otherField, otherLabel) => {
  test.each(['untouched', 'type then clear', 'clear hidden', 'clear visible'] as const)(
    '%s writes only the intended fields', async (operation) => {
      const card = { headline: '原有標題', bio: '原有簡介', linkUrl: 'https://example.org/' };
      const raw = { schoolId: 'pu', ownerUid: 'alice', ...card,
        [field]: operation === 'clear visible' ? visible : hidden };
      jest.mocked(getDocFromServer).mockResolvedValueOnce({
        exists: () => true, data: () => raw, metadata: { hasPendingWrites: false },
      } as never);
      jest.mocked(readCreatorCard).mockImplementationOnce(
        jest.requireActual<typeof import('../services/creatorCard')>('../services/creatorCard').readCreatorCard,
      );

      const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
      fireEvent.press(await view.findByLabelText('編輯社群簡介'));
      const input = view.getByLabelText(label);
      expect(input.props.value).toBe(operation === 'clear visible' ? visible : '');

      // An explicit clear still works when the old value displays as empty.
      if (operation === 'untouched') {
        fireEvent.changeText(view.getByLabelText(otherLabel), '另一欄的新內容');
      } else if (operation === 'clear hidden') {
        fireEvent.press(view.getByLabelText(`清除舊${label}`));
      } else {
        if (operation === 'type then clear') fireEvent.changeText(input, typed);
        fireEvent.changeText(input, '');
      }

      await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
      const expected = { ...card, [field]: '' };
      if (operation === 'untouched') expected[otherField] = '另一欄的新內容';
      expect(saveCreatorCard).toHaveBeenCalledWith('pu', 'alice', expected, expect.any(Function));
    },
  );
});

test('a timed-out clear can be restored after a public check still reads a hidden value', async () => {
  jest.useFakeTimers();
  try {
    const card = { headline: '原有標題', bio: '原有簡介', linkUrl: '' };
    const latest = { ...card, bio: '其他裝置的簡介' };
    const actualRead = jest.requireActual<typeof import('../services/creatorCard')>(
      '../services/creatorCard',
    ).readCreatorCard;
    for (const value of [card, latest]) {
      jest.mocked(getDocFromServer).mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ schoolId: 'pu', ownerUid: 'alice', ...value, linkUrl: 'https://localhost' }),
        metadata: { hasPendingWrites: false },
      } as never);
    }
    jest.mocked(readCreatorCard).mockImplementationOnce(actualRead).mockImplementationOnce(actualRead);
    let resolveSave!: (value: typeof card) => void;
    jest.mocked(saveCreatorCard).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }))
      .mockResolvedValueOnce(latest);

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    fireEvent.press(view.getByLabelText('清除舊作品連結'));
    fireEvent.press(view.getByLabelText('儲存簡介'));
    act(() => { jest.advanceTimersByTime(15_000); });
    fireEvent.changeText(view.getByLabelText('個人簡介'), '取消前追加的簡介');
    fireEvent.press(view.getByLabelText('取消編輯'));
    await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
    expect(view.getByText(latest.bio)).toBeTruthy();
    expect(view.getByText(/伺服器資料與上次送出的內容不同/)).toBeTruthy();

    // The late response cannot replace either the submitted clear or the
    // bio typed before closing the editor.
    await act(async () => { resolveSave(card); });
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    fireEvent.press(view.getByLabelText('還原未確認的草稿'));
    expect(view.getByLabelText('個人簡介').props.value).toBe('取消前追加的簡介');
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    expect(saveCreatorCard).toHaveBeenNthCalledWith(2, 'pu', 'alice',
      { ...latest, bio: '取消前追加的簡介' }, expect.any(Function), ['bio', 'linkUrl']);
  } finally {
    jest.useRealTimers();
  }
});

describe('save and server confirmation parity with merge-base', () => {
  const local = {
    schoolId: 'pu', ownerUid: 'alice', headline: '標題', bio: '原簡介',
    linkUrl: 'https://example.org/',
  };
  const snapshot = (data: typeof local | null) => ({
    exists: () => data !== null, data: () => data, metadata: { hasPendingWrites: false },
  } as never);

  describe.each([
    'unchanged', 'whitespace only', 'link clear only', 'initial read failure',
    'initial read stalled', 'remote withdrawal', 'remote update', 'retry after confirmation failure',
  ] as const)('%s', (scenario) => {
    test.each(['matches', 'differs'] as const)('writes and confirms when the server %s', async (relation) => {
      const read = jest.mocked(getDocFromServer);
      const write = jest.mocked(setDoc);
      read.mockReset();
      write.mockReset();
      const service = jest.requireActual<typeof import('../services/creatorCard')>('../services/creatorCard');
      jest.mocked(readCreatorCard).mockImplementation(service.readCreatorCard);
      jest.mocked(saveCreatorCard).mockImplementation(service.saveCreatorCard);
      let server: typeof local | null = local;
      read.mockImplementation(async () => snapshot(server));
      write.mockImplementation(async (_ref, data) => {
        server = { ...server, ...data } as typeof local;
      });
      const stalled = scenario === 'initial read stalled';
      let resolveInitialRead!: (value: ReturnType<typeof snapshot>) => void;
      if (stalled) {
        jest.useFakeTimers();
        read.mockReturnValueOnce(new Promise((resolve) => { resolveInitialRead = resolve; }));
      }
      if (scenario === 'initial read failure') read.mockRejectedValueOnce(new Error('read failed'));

      try {
        const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
        if (stalled) {
          act(() => { jest.advanceTimersByTime(30_000); });
          jest.useRealTimers();
          expect(view.queryByLabelText('儲存簡介')).toBeNull();
          expect(write).toHaveBeenCalledTimes(0);
          await act(async () => { resolveInitialRead(snapshot(local)); });
        }
        if (scenario === 'initial read failure') {
          expect(view.queryByLabelText('儲存簡介')).toBeNull();
          fireEvent.press(await view.findByLabelText('重新讀取社群簡介'));
        }
        fireEvent.press(await view.findByLabelText('編輯社群簡介'));
        const pressSave = async () => {
          await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
        };
        const changeBio = (value: string) => fireEvent.changeText(view.getByLabelText('個人簡介'), value);
        if (scenario === 'retry after confirmation failure') {
          changeBio('第一次送出的簡介');
          read.mockRejectedValueOnce(new Error('automatic confirmation failed'));
          await pressSave();
          expect(write).toHaveBeenCalledTimes(1);
          read.mockRejectedValueOnce(new Error('manual confirmation failed'));
          const check = async () => {
            await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
          };
          await check();
          expect(view.getByLabelText('儲存簡介').props.accessibilityState.disabled).toBe(true);
          server = local;
          await check();
          changeBio(local.bio);
        }
        if (scenario === 'whitespace only') changeBio(`  ${local.bio}  `);
        if (scenario === 'link clear only') fireEvent.changeText(view.getByLabelText('作品連結'), '');
        if (relation === 'differs') {
          server = scenario === 'remote withdrawal' ? null : { ...local, headline: '另一裝置的標題' };
        }

        read.mockClear();
        write.mockClear();
        await pressSave();
        if (scenario === 'retry after confirmation failure') {
          // Following an ambiguous write, an unchanged save only reads the card.
          expect(write).not.toHaveBeenCalled();
        } else {
          expect(write).toHaveBeenCalledTimes(1);
          expect(write).toHaveBeenCalledWith(undefined, {
            ...local, linkUrl: scenario === 'link clear only' ? '' : local.linkUrl, updatedAt: 'SERVER_TIME',
          }, { merge: true });
          expect(read.mock.invocationCallOrder[0]).toBeGreaterThan(write.mock.invocationCallOrder[0]);
        }
        expect(read).toHaveBeenCalledTimes(1);
        expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
        expect(view.queryByLabelText('儲存簡介')).toBeNull();
      } finally {
        read.mockReset();
        write.mockReset();
        if (stalled) jest.useRealTimers();
      }
    });
  });
});

describe('saving merges creator card changes under the document rules', () => {
  const original = {
    schoolId: 'pu', ownerUid: 'alice', headline: '標題', bio: '簡介',
    linkUrl: 'https://example.org/', pinnedPostId: 'post-1', updatedAt: 'OLD_TIME',
  };

  async function editCard(raw: Record<string, unknown>, serverDocument = raw) {
    const actualService = jest.requireActual<typeof import('../services/creatorCard')>('../services/creatorCard');
    jest.mocked(readCreatorCard).mockImplementation(actualService.readCreatorCard);
    jest.mocked(saveCreatorCard).mockImplementation(actualService.saveCreatorCard);
    let server = serverDocument;
    const snapshot = (data: Record<string, unknown>) => ({
      exists: () => true, data: () => data, metadata: { hasPendingWrites: false },
    } as never);
    jest.mocked(getDocFromServer).mockResolvedValueOnce(snapshot(raw))
      .mockImplementation(async () => snapshot(server));
    jest.mocked(setDoc).mockImplementation(async (_ref, changes) => {
      const merged = { ...server, ...changes };
      if (!creatorCardDocumentPassesRules(merged, 'pu', 'alice', 'SERVER_TIME')) {
        throw new Error('permission-denied');
      }
      server = merged;
    });
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    fireEvent.press(await view.findByLabelText('編輯社群簡介'));
    return { view, currentDocument: () => server };
  }

  describe.each(['headline', 'bio', 'linkUrl'] as const)('legacy %s', (field) => {
    const isLink = field === 'linkUrl';
    const longValue = isLink
      ? original.linkUrl + 'a'.repeat(CREATOR_CARD_LIMITS.linkUrl)
      : '字'.repeat(CREATOR_CARD_LIMITS[field] + 1);
    test.each([
      ['number', 12, ''],
      ['null', null, ''],
      ['object', { text: '內容' }, ''],
      ['array', ['內容'], ''],
      ['too long', longValue, isLink ? '' : longValue.slice(0, CREATOR_CARD_LIMITS[field])],
      ['surrounding spaces', `  ${original[field]}  `, original[field]],
      ['invalid URL', 'http://example.org/', isLink ? '' : 'http://example.org/'],
      ['missing', undefined, ''],
    ])('%s is saved with its normalized value', async (_scenario, value, expected) => {
      const raw: Record<string, unknown> = { ...original, [field]: value };
      if (value === undefined) delete raw[field];
      const edit = field === 'headline' ? { bio: '新簡介' } : { headline: '新標題' };
      const normalized = { [field]: expected };
      const { view, currentDocument } = await editCard(raw);
      fireEvent.changeText(view.getByLabelText(field === 'headline' ? '個人簡介' : '一句話介紹'),
        field === 'headline' ? '新簡介' : '新標題');
      await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
      expect(setDoc).toHaveBeenCalledTimes(1);
      expect(setDoc).toHaveBeenCalledWith(undefined, {
        schoolId: 'pu', ownerUid: 'alice', headline: original.headline, bio: original.bio,
        linkUrl: original.linkUrl, ...normalized, ...edit, updatedAt: 'SERVER_TIME',
      }, { merge: true });
      expect(currentDocument()).toEqual({ ...raw, ...normalized, ...edit, updatedAt: 'SERVER_TIME' });
      expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
    });
  });

  test('repairs multiple legacy fields together, then saves two edits including a clear', async () => {
    const raw = { ...original, headline: null, bio: 12, linkUrl: ' https://example.org/ ' };
    const { view, currentDocument } = await editCard(raw);
    fireEvent.changeText(view.getByLabelText('一句話介紹'), '新標題');
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    expect(currentDocument()).toEqual({ ...original, headline: '新標題', bio: '', updatedAt: 'SERVER_TIME' });

    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    fireEvent.changeText(view.getByLabelText('個人簡介'), '新簡介');
    fireEvent.changeText(view.getByLabelText('作品連結'), '');
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    expect(setDoc).toHaveBeenNthCalledWith(2, undefined, {
      schoolId: 'pu', ownerUid: 'alice', headline: '新標題', bio: '新簡介', linkUrl: '', updatedAt: 'SERVER_TIME',
    }, { merge: true });
    expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
  });

  test.each(['existing', 'deleted'])('a headline-only edit saves all required fields (%s document)', async (scenario) => {
    const { view, currentDocument } = await editCard(original, scenario === 'deleted' ? {} : original);
    fireEvent.changeText(view.getByLabelText('一句話介紹'), '新標題');
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    const { pinnedPostId, ...required } = original;
    expect(currentDocument()).toEqual({
      ...required, ...(scenario === 'existing' ? { pinnedPostId } : {}),
      headline: '新標題', updatedAt: 'SERVER_TIME',
    });
    expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
  });

  test('an extra key still blocks the merge even when all content fields are supplied', async () => {
    const raw = { ...original, extra: 'legacy' };
    expect(creatorCardDocumentPassesRules({ ...raw, updatedAt: 'SERVER_TIME' }, 'pu', 'alice', 'SERVER_TIME'))
      .toBe(false);
    const { view, currentDocument } = await editCard(raw);
    fireEvent.changeText(view.getByLabelText('一句話介紹'), '新標題');
    await act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(currentDocument()).toEqual(raw);
    expect(view.queryByText('社群簡介已儲存。')).toBeNull();
  });
});

test.each([false, true])(
  'reopening after an ambiguous save preserves concurrent content and pin (restore: %s)',
  async (restore) => {
    const service = jest.requireActual<typeof import('../services/creatorCard')>('../services/creatorCard');
    jest.mocked(readCreatorCard).mockImplementation(service.readCreatorCard);
    jest.mocked(saveCreatorCard).mockImplementation(service.saveCreatorCard);
    const initial = {
      schoolId: 'pu', ownerUid: 'alice', headline: '標題', bio: '舊簡介',
      linkUrl: 'https://example.org/', pinnedPostId: 'post-1', updatedAt: 'OLD_TIME',
    };
    let server = { ...initial };
    jest.mocked(getDocFromServer).mockImplementation(async () => ({
      exists: () => true, data: () => server, metadata: { hasPendingWrites: false },
    } as never));
    jest.mocked(setDoc).mockImplementationOnce(async () => { throw new Error('ambiguous write'); })
      .mockImplementation(async (_ref, patch) => {
        const next = { ...server, ...patch };
        expect(creatorCardDocumentPassesRules(next, 'pu', 'alice', 'SERVER_TIME')).toBe(true);
        server = next;
      });

    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    const edit = await view.findByLabelText('編輯社群簡介');
    fireEvent.press(edit);
    fireEvent.changeText(view.getByLabelText('個人簡介'), '待確認的簡介');
    const save = () => act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    await save();
    fireEvent.press(view.getByLabelText('取消編輯'));
    server = { ...server, linkUrl: 'https://example.net/' };
    await act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    expect(view.getByLabelText('個人簡介').props.value).toBe(initial.bio);
    expect(view.getByLabelText('作品連結').props.value).toBe(server.linkUrl);

    if (restore) fireEvent.press(view.getByLabelText('還原未確認的草稿'));
    else fireEvent.changeText(view.getByLabelText('個人簡介'), '這次編輯的簡介');
    expect(view.getByLabelText('作品連結').props.value).toBe(server.linkUrl);
    // A second remote change after reopening must survive the actual save payload.
    server = { ...server, linkUrl: 'https://example.com/', pinnedPostId: 'post-2' };
    const bio = restore ? '待確認的簡介' : '這次編輯的簡介';
    await save();
    expect(setDoc).toHaveBeenNthCalledWith(2, undefined, {
      schoolId: 'pu', ownerUid: 'alice', bio, updatedAt: 'SERVER_TIME',
    }, { merge: true });
    expect(server).toEqual({
      ...initial, bio, linkUrl: 'https://example.com/', pinnedPostId: 'post-2', updatedAt: 'SERVER_TIME',
    });
    expect(view.getByText('社群簡介已儲存。')).toBeTruthy();
  },
);

test.each(['none', 'bio', 'all', 'reverted'] as const)(
  'restores only fields without subsequent edits (%s), including across consecutive submissions',
  async (scenario) => {
    const published = { headline: '標題', bio: '已發布', linkUrl: 'https://example.org/' };
    const submitted = { ...published, bio: '第一次送出', linkUrl: '' };
    const latest = { ...published, bio: '伺服器簡介', linkUrl: 'https://example.net/' };
    jest.mocked(readCreatorCard).mockResolvedValueOnce(published).mockResolvedValueOnce(latest)
      .mockResolvedValueOnce(latest);
    jest.mocked(saveCreatorCard).mockRejectedValue(new Error('offline'));
    const view = render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
    fireEvent.press(await view.findByLabelText('編輯社群簡介'));
    const bio = () => view.getByLabelText('個人簡介');
    const link = () => view.getByLabelText('作品連結');
    const save = async () => act(async () => { fireEvent.press(view.getByLabelText('儲存簡介')); });
    const check = async () => act(async () => { fireEvent.press(view.getByLabelText('核對儲存結果')); });
    fireEvent.changeText(bio(), submitted.bio);
    fireEvent.changeText(link(), submitted.linkUrl);
    await save();
    await check();
    expect(bio().props.value).toBe(submitted.bio);
    expect(link().props.value).toBe(submitted.linkUrl);

    fireEvent.press(view.getByLabelText('取消編輯'));
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    expect(link().props.value).toBe(latest.linkUrl);
    const newerBio = scenario === 'reverted' ? latest.bio : '重新編輯';
    if (scenario !== 'none') fireEvent.changeText(bio(), '重新編輯');
    if (scenario === 'reverted') fireEvent.changeText(bio(), newerBio);
    if (scenario === 'all') fireEvent.changeText(link(), 'https://example.com/');
    if (scenario === 'all') {
      const headline = view.getByLabelText('一句話介紹');
      fireEvent.changeText(headline, '重新編輯的標題');
      fireEvent.changeText(headline, published.headline);
    }
    const restore = view.queryByLabelText('還原未確認的草稿');
    if (scenario === 'all') {
      expect(restore).toBeNull();
    } else {
      expect(restore).toBeTruthy();
      fireEvent.press(restore!);
    }
    expect(bio().props.value).toBe(scenario === 'none' ? submitted.bio : newerBio);
    expect(link().props.value).toBe(scenario === 'all' ? 'https://example.com/' : '');

    fireEvent.changeText(bio(), '第二次送出');
    await save();
    expect(saveCreatorCard).toHaveBeenNthCalledWith(2, 'pu', 'alice', {
      ...published, bio: '第二次送出', linkUrl: scenario === 'all' ? 'https://example.com/' : '',
    }, expect.any(Function), ['bio', 'linkUrl']);
    await check();
    fireEvent.press(view.getByLabelText('取消編輯'));
    fireEvent.press(view.getByLabelText('編輯社群簡介'));
    fireEvent.press(view.getByLabelText('還原未確認的草稿'));
    expect(bio().props.value).toBe('第二次送出');
  },
);
