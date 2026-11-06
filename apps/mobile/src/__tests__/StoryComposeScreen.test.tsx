import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StoryComposeScreen } from '../screens/social/StoryComposeScreen';
import { publishStory, reserveStoryId } from '../services/stories';
import { uploadStoryImage, uploadStoryVideo } from '../services/mediaUpload';
import { storage } from '../services/storage';

jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'alice' } }) }));
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
jest.mock('../services/storage', () => ({ storage: { pickImage: jest.fn() } }));
jest.mock('expo-image-picker', () => ({ VideoExportPreset: { H264_1280x720: 6 } }));
jest.mock('expo-av', () => ({
  Video: jest.requireActual('react-native').View,
  ResizeMode: { CONTAIN: 'contain' },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

beforeEach(() => {
  jest.clearAllMocks();
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
    fireEvent.press(view.getByText('發布限時動態'));
  });
  expect(reserveStoryId).toHaveBeenCalledTimes(1);
  expect(uploadStoryImage).toHaveBeenCalledTimes(1);
  expect(uploadStoryImage).toHaveBeenCalledWith('pu', 's1', 'alice', 'file:///test', 'image/png');
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
  expect(uploadStoryVideo).toHaveBeenCalledWith('pu', 's1', 'alice', clip.uri, 4010);
  expect(publishStory).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({
      kind: 'video',
      mediaUrl: 'https://example.com/clip',
      text: '晚上的社團表演',
    }),
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
  expect(publishStory).toHaveBeenCalledWith('s1', expect.objectContaining({ allowReplies: false }));
});
