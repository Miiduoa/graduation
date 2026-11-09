import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StoryComposeScreen } from '../screens/social/StoryComposeScreen';
import { publishStory, reserveStoryId } from '../services/stories';
import { uploadStoryImage } from '../services/mediaUpload';
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
  uploadStoryImage: jest.fn(),
}));
jest.mock('../services/storage', () => ({ storage: { pickImage: jest.fn() } }));
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

test('expired claimed media is cleared and uploaded again before retrying publication', async () => {
  const files = require('../services/privateFiles');
  const claim = jest.spyOn(files, 'claimPrivateFile')
    .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
    .mockResolvedValue(undefined);
  jest.mocked(uploadStoryImage)
    .mockResolvedValueOnce('schools/pu/stories/s1/old.jpg')
    .mockResolvedValueOnce('schools/pu/stories/s1/new.jpg');
  jest.mocked(publishStory).mockResolvedValue('s1');
  const view = render(<StoryComposeScreen />);
  try {
    await act(async () => fireEvent.press(view.getByText('選擇圖片')));
    await act(async () => fireEvent.press(view.getByText('發布限時動態')));
    expect(publishStory).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(view.getByText('發布限時動態')));
    expect(uploadStoryImage).toHaveBeenCalledTimes(2);
    expect(publishStory).toHaveBeenCalledWith('s1', expect.objectContaining({ mediaUrl: 'schools/pu/stories/s1/new.jpg' }));
  } finally { view.unmount(); claim.mockRestore(); }
});
