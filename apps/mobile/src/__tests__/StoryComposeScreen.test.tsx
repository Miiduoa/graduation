import React from 'react';
import { Alert, Image, ScrollView, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StoryComposeScreen } from '../screens/social/StoryComposeScreen';
import { publishStory, reserveStoryId } from '../services/stories';
import { uploadStoryImage, uploadStoryVideo } from '../services/mediaUpload';
import { storage } from '../services/storage';

let mockUid = 'alice';
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid } }) }));
let mockSchool = 'pu';
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../firebase', () => ({ isFirebaseMockMode: () => false }));
jest.mock('../services/stories', () => ({
  reserveStoryId: jest.fn(() => 's1'),
  publishStory: jest.fn(),
}));
jest.mock('../services/mediaUpload', () => ({
  STORY_IMAGE_LIMIT: 10485760,
  STORY_VIDEO_MAX_MS: 30_000,
  uploadStoryVideo: jest.fn(),
  uploadStoryImage: jest.fn(),
}));
jest.mock('../services/storage', () => ({ storage: {
  pickImage: jest.fn(),
  formatFileSize: jest.fn((bytes) => `${bytes} B`),
} }));
jest.mock('expo-image-picker', () => ({ VideoExportPreset: { H264_1280x720: 6 } }));
jest.mock('expo-av', () => ({
  Video: jest.requireActual('react-native').View,
  ResizeMode: { CONTAIN: 'contain' },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(reserveStoryId).mockReset().mockReturnValue('s1');
  jest.mocked(publishStory).mockReset().mockResolvedValue('s1');
  jest.mocked(uploadStoryImage).mockReset().mockResolvedValue('https://example.com/photo');
  jest.mocked(uploadStoryVideo).mockReset().mockResolvedValue('https://example.com/clip');
  mockUid = 'alice';
  mockSchool = 'pu';
  jest
    .mocked(storage.pickImage)
    .mockResolvedValue({ uri: 'file:///test', type: 'image/png', name: 'campus.png', size: 24 });
});

test('retry uses the uploaded image and the same reserved story ID', async () => {
  const goBack = jest.fn();
  jest.mocked(uploadStoryImage).mockResolvedValue('https://example.com/photo');
  jest.mocked(publishStory).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('s1');
  const view = render(<StoryComposeScreen navigation={{ goBack }} />);
  await act(async () => {
    fireEvent.press(view.getByText('選擇圖片'));
  });
  await act(async () => {
    fireEvent.press(view.getByText('發布限時動態'));
  });
  expect(alert).toHaveBeenCalledWith('發布失敗', expect.anything());
  expect(goBack).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(view.getByText('確認／重試原版本'));
  });
  expect(reserveStoryId).toHaveBeenCalledTimes(1);
  expect(uploadStoryImage).toHaveBeenCalledTimes(1);
  expect(uploadStoryImage).toHaveBeenCalledWith('pu', 's1', 'alice', 'file:///test', 'image/png', expect.objectContaining({ signal: expect.anything() }));
  expect(publishStory).toHaveBeenCalledTimes(2);
  expect(publishStory).toHaveBeenLastCalledWith(
    's1',
    expect.objectContaining({
      allowReplies: true,
      kind: 'image',
      mediaUrl: 'https://example.com/photo',
      authorUid: 'alice',
      schoolId: 'pu',
    }),
    expect.objectContaining({ confirmFirst: true }),
  );
  expect(goBack).toHaveBeenCalledTimes(1);
});

test('switching school while the upload finishes cannot publish into the previous campus', async () => {
  let finish!: (url: string) => void;
  jest.mocked(uploadStoryImage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<StoryComposeScreen />);
  await act(async () => {
    fireEvent.press(view.getByText('選擇圖片'));
  });
  fireEvent.press(view.getByText('發布限時動態'));
  await waitFor(() => expect(uploadStoryImage).toHaveBeenCalledTimes(1));
  mockSchool = 'tw-other';
  view.rerender(<StoryComposeScreen />);
  expect(jest.mocked(uploadStoryImage).mock.calls[0][5]?.signal?.aborted).toBe(true);
  await act(async () => {
    finish('https://example.com/photo');
  });
  expect(publishStory).not.toHaveBeenCalled();
  expect(view.getByText('選擇圖片')).toBeTruthy();
});

test('requires a decoded frame and real duration before publishing a muted video with its caption', async () => {
  const clip = {
    uri: 'file:///clip.mp4',
    name: 'test.mp4',
    type: 'video/mp4',
    size: 1000,
    durationMs: 3800,
  };
  jest.mocked(storage.pickImage).mockResolvedValue(clip);
  jest.mocked(uploadStoryVideo).mockResolvedValue('https://example.com/clip');
  jest.mocked(publishStory).mockResolvedValue('s1');
  const view = render(<StoryComposeScreen />);
  await act(async () => {
    fireEvent.press(view.getByText('選擇影片'));
  });
  fireEvent.press(view.getByText('發布限時動態'));
  expect(uploadStoryVideo).not.toHaveBeenCalled();
  const player = view.getByLabelText('影片預覽');
  expect(player.props.isMuted).toBe(true);
  fireEvent(player, 'readyForDisplay', {
    naturalSize: { width: 1080, height: 1920 },
    status: { isLoaded: true, durationMillis: 4010 },
  });
  fireEvent.changeText(view.getByPlaceholderText('為這段影片加上一句話（選填）'), '晚上的社團表演');
  await act(async () => {
    fireEvent.press(view.getByText('發布限時動態'));
  });
  expect(uploadStoryVideo).toHaveBeenCalledWith('pu', 's1', 'alice', clip.uri, 4010, expect.objectContaining({ signal: expect.anything() }));
  expect(publishStory).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({
      kind: 'video',
      mediaUrl: 'https://example.com/clip',
      text: '晚上的社團表演',
    }),
    expect.objectContaining({ confirmFirst: false }),
  );
});

test.each([
  [1080, 1920, 30_001],
  [0, 0, 7_000],
  [1080, 1920, 0],
])(
  'an unpublishable native preview preserves the existing photo (%i × %i, %i ms)',
  async (width, height, durationMillis) => {
    const view = render(<StoryComposeScreen />);
    await act(async () => {
      fireEvent.press(view.getByText('選擇圖片'));
    });
    jest
      .mocked(storage.pickImage)
      .mockResolvedValue({
        uri: 'file:///new.mp4',
        name: 'new.mp4',
        size: 1000,
        type: 'video/mp4',
      });
    await act(async () => {
      fireEvent.press(view.getByText('選擇影片'));
    });
    fireEvent(view.getByLabelText('影片預覽'), 'readyForDisplay', {
      naturalSize: { width, height },
      status: { isLoaded: true, durationMillis },
    });
    expect(view.getByText('更換圖片')).toBeTruthy();
    expect(view.queryByLabelText('影片預覽')).toBeNull();
    expect(uploadStoryVideo).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('無法使用這段影片', expect.any(String));
  },
);

test('the author may turn off private replies for this story before publishing', async () => {
  jest.mocked(publishStory).mockResolvedValue('s1');
  const view = render(<StoryComposeScreen />);
  const toggle = view.getByRole('switch', { name: '允許同校成員私訊回覆' });
  expect(toggle.props.value).toBe(true);
  fireEvent(toggle, 'valueChange', false);
  fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '雨停了');
  await act(async () => fireEvent.press(view.getByText('發布限時動態')));
  expect(publishStory).toHaveBeenCalledWith('s1', expect.objectContaining({ allowReplies: false }), expect.objectContaining({ confirmFirst: false }));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function eventHandler(node: ReactTestInstance, name: string) {
  let current: ReactTestInstance | null = node;
  while (current) {
    if (typeof current.props[name] === 'function') return current.props[name];
    current = current.parent;
  }
  throw new Error(`Missing ${name} handler`);
}

test('confirms the immutable original before publishing the preserved edited photo as a new story', async () => {
  const goBack = jest.fn();
  jest.mocked(reserveStoryId).mockReturnValueOnce('s1').mockReturnValueOnce('s2');
  jest.mocked(publishStory).mockRejectedValueOnce(new Error('lost receipt')).mockResolvedValue('s1');
  const view = render(<StoryComposeScreen navigation={{ goBack }} />);
  await act(async () => { fireEvent.press(view.getByText('選擇圖片')); });
  fireEvent.changeText(view.getByPlaceholderText('為這張圖加上一句話（選填）'), '第一次的說明');
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  const original = jest.mocked(publishStory).mock.calls[0][1];

  fireEvent.changeText(view.getByPlaceholderText('為這張圖加上一句話（選填）'), '修改後的說明');
  fireEvent(view.getByRole('switch', { name: '允許同校成員私訊回覆' }), 'valueChange', false);
  jest.mocked(storage.pickImage).mockResolvedValue({ uri: 'file:///edited', type: 'image/jpeg', name: 'edited.jpg', size: 32 });
  await act(async () => { fireEvent.press(view.getByText('更換圖片')); });
  expect(view.getByText('重新確認會沿用第一次送出的內容。現在的修改會保留成下一則草稿。')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('確認／重試原版本')); });

  expect(jest.mocked(publishStory).mock.calls[1][1]).toBe(original);
  expect(jest.mocked(publishStory).mock.calls[1][0]).toBe('s1');
  expect(uploadStoryImage).toHaveBeenCalledTimes(1);
  expect(goBack).not.toHaveBeenCalled();
  expect(view.getByText('上一版已發布，修改後的草稿已保留。')).toBeTruthy();
  expect(view.getByDisplayValue('修改後的說明')).toBeTruthy();
  expect(view.UNSAFE_getByType(Image).props.source.uri).toBe('file:///edited');

  jest.mocked(uploadStoryImage).mockResolvedValue('https://example.com/edited');
  jest.mocked(publishStory).mockResolvedValue('s2');
  await act(async () => { fireEvent.press(view.getByText('發布修改後的草稿')); });
  expect(reserveStoryId).toHaveBeenCalledTimes(2);
  expect(uploadStoryImage).toHaveBeenLastCalledWith('pu', 's2', 'alice', 'file:///edited', 'image/jpeg', expect.anything());
  expect(publishStory).toHaveBeenLastCalledWith('s2', expect.objectContaining({
    text: '修改後的說明', allowReplies: false, mediaUrl: 'https://example.com/edited',
  }), expect.objectContaining({ confirmFirst: false }));
  expect(goBack).toHaveBeenCalledTimes(1);
});

test('an emptied edited draft can still confirm its original and remains empty afterward', async () => {
  const goBack = jest.fn();
  jest.mocked(publishStory).mockRejectedValueOnce(new Error('lost receipt')).mockResolvedValue('s1');
  const view = render(<StoryComposeScreen navigation={{ goBack }} />);
  fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '原版文字');
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '');
  await act(async () => { fireEvent.press(view.getByText('確認／重試原版本')); });
  expect(publishStory).toHaveBeenCalledTimes(2);
  expect(jest.mocked(publishStory).mock.calls[1][1].text).toBe('原版文字');
  expect(view.getByPlaceholderText('跟大家分享此刻⋯').props.value).toBe('');
  expect(view.getByText('發布修改後的草稿')).toBeTruthy();
  expect(goBack).not.toHaveBeenCalled();
});

test('shows byte progress, cancels in place, and isolates retired callbacks from an immediate retry', async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  jest.mocked(uploadStoryImage).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<StoryComposeScreen />);
  await act(async () => { fireEvent.press(view.getByText('選擇圖片')); });
  fireEvent.changeText(view.getByPlaceholderText('為這張圖加上一句話（選填）'), '保留我的草稿');
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  const firstOptions = jest.mocked(uploadStoryImage).mock.calls[0][5]!;
  act(() => firstOptions.onProgress!({ loaded: 1_048_576, total: 4_194_304, percentage: 25 }));
  expect(view.getByText('上傳 25% · 1048576 B / 4194304 B')).toBeTruthy();
  expect(storage.formatFileSize).toHaveBeenCalledWith(1_048_576);
  expect(storage.formatFileSize).toHaveBeenCalledWith(4_194_304);
  expect(view.getByRole('progressbar').props.accessibilityValue.now).toBe(25);
  const cancel = view.getByRole('button', { name: '取消上傳' });
  expect(StyleSheet.flatten(cancel.props.style).minHeight).toBeGreaterThanOrEqual(44);
  fireEvent.press(cancel);
  expect(firstOptions.signal?.aborted).toBe(true);
  expect(view.getByText('上傳已取消，草稿已保留。')).toBeTruthy();
  expect(view.getByDisplayValue('保留我的草稿')).toBeTruthy();
  expect(view.UNSAFE_getByType(Image).props.source.uri).toBe('file:///test');

  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  const secondOptions = jest.mocked(uploadStoryImage).mock.calls[1][5]!;
  act(() => secondOptions.onProgress!({ loaded: 100, total: 1000, percentage: 10 }));
  await act(async () => {
    firstOptions.onProgress!({ loaded: 999, total: 1000, percentage: 100 });
    firstOptions.onUploadComplete!();
    first.resolve('https://example.com/retired');
  });
  expect(view.getByRole('progressbar').props.accessibilityValue.now).toBe(10);
  expect(view.getByText('取消上傳')).toBeTruthy();
  expect(secondOptions.uploaded).toBe(false);
  expect(secondOptions.signal?.aborted).toBe(false);
  expect(publishStory).not.toHaveBeenCalled();
  expect(reserveStoryId).toHaveBeenCalledTimes(1);
  await act(async () => { second.resolve('https://example.com/current'); });
  expect(publishStory).toHaveBeenCalledWith('s1', expect.objectContaining({
    text: '保留我的草稿', mediaUrl: 'https://example.com/current',
  }), expect.anything());
});

test('keeps a completed upload while its URL is pending so a retry can reuse the stored object', async () => {
  const first = deferred<string>();
  jest.mocked(uploadStoryImage).mockReturnValueOnce(first.promise).mockResolvedValueOnce('https://example.com/photo');
  const view = render(<StoryComposeScreen />);
  await act(async () => { fireEvent.press(view.getByText('選擇圖片')); });
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  const options = jest.mocked(uploadStoryImage).mock.calls[0][5]!;
  act(() => {
    options.onProgress!({ loaded: 1000, total: 1000, percentage: 100 });
    options.onUploadComplete!();
  });
  fireEvent.press(view.getByText('取消上傳'));
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  expect(jest.mocked(uploadStoryImage).mock.calls[1][5]?.uploaded).toBe(true);
  expect(reserveStoryId).toHaveBeenCalledTimes(1);
  expect(publishStory).toHaveBeenCalledTimes(1);
  await act(async () => { first.resolve('https://example.com/late'); });
  expect(publishStory).toHaveBeenCalledTimes(1);
});

test.each(['success', 'failure'])('stopping a pending publication ignores its late %s and preserves the original for confirmation', async (outcome) => {
  const first = deferred<string>();
  const second = deferred<string>();
  const goBack = jest.fn();
  jest.mocked(publishStory).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<StoryComposeScreen navigation={{ goBack }} />);
  fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '已送出的原版');
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  const [id, original, firstOptions] = jest.mocked(publishStory).mock.calls[0];
  fireEvent.press(view.getByText('停止等待'));
  expect(firstOptions?.signal?.aborted).toBe(true);
  expect(view.getByText('已停止等待發布結果，草稿已保留。請確認／重試原版本。')).toBeTruthy();
  fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '等待期間的新草稿');
  await act(async () => { fireEvent.press(view.getByText('確認／重試原版本')); });
  await act(async () => {
    if (outcome === 'success') first.resolve('s1');
    else first.reject(new Error('late network failure'));
  });
  expect(view.getByText('停止等待')).toBeTruthy();
  expect(view.getByDisplayValue('等待期間的新草稿', { includeHiddenElements: true })).toBeTruthy();
  expect(goBack).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(publishStory).toHaveBeenLastCalledWith(id, original, expect.objectContaining({ confirmFirst: true }));
  expect(jest.mocked(publishStory).mock.calls[1][1]).toBe(original);
  await act(async () => { second.resolve('s1'); });
  expect(view.getByText('上一版已發布，修改後的草稿已保留。')).toBeTruthy();
  expect(view.getByDisplayValue('等待期間的新草稿')).toBeTruthy();
  expect(goBack).not.toHaveBeenCalled();
});

test.each(['account', 'school', 'unmount'])('aborts a pending publication on %s changes and ignores its late completion', async (change) => {
  const pending = deferred<string>();
  const goBack = jest.fn();
  jest.mocked(publishStory).mockReturnValueOnce(pending.promise);
  const view = render(<StoryComposeScreen navigation={{ goBack }} />);
  fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '原帳號的草稿');
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  const signal = jest.mocked(publishStory).mock.calls[0][2]?.signal;
  if (change === 'unmount') view.unmount();
  else {
    if (change === 'account') mockUid = 'bob';
    else mockSchool = 'other';
    view.rerender(<StoryComposeScreen navigation={{ goBack }} />);
    expect(view.getByPlaceholderText('跟大家分享此刻⋯').props.value).toBe('');
  }
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve('s1'); });
  expect(goBack).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});

test('confirming an expired original preserves the edited draft without extending its lifetime', async () => {
  jest.mocked(publishStory).mockRejectedValueOnce(new Error('lost receipt')).mockResolvedValue('s1');
  const view = render(<StoryComposeScreen />);
  fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '昨天的原版');
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  const original = jest.mocked(publishStory).mock.calls[0][1];
  const now = jest.spyOn(Date, 'now').mockReturnValue(original.expiresAtMs + 1);
  try {
    fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '今天的修改稿');
    await act(async () => { fireEvent.press(view.getByText('確認／重試原版本')); });
    expect(jest.mocked(publishStory).mock.calls[1][1]).toBe(original);
    expect(view.getByText('上一版已發布，現已到期。修改後的草稿已保留。')).toBeTruthy();
    expect(view.getByDisplayValue('今天的修改稿')).toBeTruthy();
  } finally {
    now.mockRestore();
  }
});

test('a successful publication stays locked while navigation is still leaving the mounted editor', async () => {
  const goBack = jest.fn();
  const view = render(<StoryComposeScreen navigation={{ goBack }} />);
  fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '只發布一次');
  const button = view.getByRole('button', { name: '發布限時動態' });
  const press = eventHandler(button, 'onPress');
  await act(async () => { fireEvent.press(button); });
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(view.getByText('限時動態已發布。')).toBeTruthy();
  await act(async () => { await press(); });
  const done = view.getByText('已發布', { includeHiddenElements: true });
  fireEvent.press(done);
  expect(publishStory).toHaveBeenCalledTimes(1);
  expect(reserveStoryId).toHaveBeenCalledTimes(1);
});

test('busy editor handlers and accessibility cannot alter media, text, or reply preferences', async () => {
  const pending = deferred<string>();
  jest.mocked(uploadStoryImage).mockReturnValueOnce(pending.promise);
  const view = render(<StoryComposeScreen />);
  const color = eventHandler(view.getByLabelText('背景色 #7c5dfa'), 'onPress');
  await act(async () => { fireEvent.press(view.getByText('選擇圖片')); });
  const clear = eventHandler(view.getByText('清除圖片'), 'onPress');
  const body = view.getByPlaceholderText('為這張圖加上一句話（選填）');
  fireEvent.changeText(body, '原本的圖片說明');
  const changeText = body.props.onChangeText;
  const changeReply = eventHandler(view.getByRole('switch', { name: '允許同校成員私訊回覆' }), 'onValueChange');
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  act(() => {
    clear();
    color();
    changeText('忙碌時的意外編輯');
    changeReply(false);
  });
  expect(view.UNSAFE_getByType(ScrollView).props.accessibilityElementsHidden).toBe(true);
  expect(view.UNSAFE_getByType(ScrollView).props.importantForAccessibility).toBe('no-hide-descendants');
  expect(view.getByRole('button', { name: '取消上傳' })).toBeTruthy();
  expect(view.queryByRole('switch', { name: '允許同校成員私訊回覆' })).toBeNull();
  expect(view.getByDisplayValue('原本的圖片說明', { includeHiddenElements: true })).toBeTruthy();
  expect(view.UNSAFE_getByType(Image).props.source.uri).toBe('file:///test');
  await act(async () => { pending.resolve('https://example.com/photo'); });
  expect(publishStory).toHaveBeenCalledWith('s1', expect.objectContaining({
    text: '原本的圖片說明', kind: 'image', bgColor: '#0f172a', allowReplies: true,
  }), expect.anything());
});

test('a location supplied while confirmation is pending remains in the next draft', async () => {
  const pending = deferred<string>();
  const goBack = jest.fn();
  jest.mocked(publishStory).mockReturnValueOnce(pending.promise);
  jest.mocked(reserveStoryId).mockReturnValueOnce('s1').mockReturnValueOnce('s2');
  const view = render(<StoryComposeScreen navigation={{ goBack }} route={{ params: { poiId: 'pu-library' } }} />);
  fireEvent.changeText(view.getByPlaceholderText('跟大家分享此刻⋯'), '社團集合');
  await act(async () => { fireEvent.press(view.getByText('發布限時動態')); });
  expect(jest.mocked(publishStory).mock.calls[0][1].poiId).toBe('pu-library');
  view.rerender(<StoryComposeScreen navigation={{ goBack }} route={{ params: { poiId: 'pu-gym' } }} />);
  await act(async () => { pending.resolve('s1'); });
  expect(view.getByText('上一版已發布，修改後的草稿已保留。')).toBeTruthy();
  expect(goBack).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(view.getByText('發布修改後的草稿')); });
  expect(publishStory).toHaveBeenLastCalledWith('s2', expect.objectContaining({
    poiId: 'pu-gym', text: '社團集合',
  }), expect.objectContaining({ confirmFirst: false }));
});
