import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { usePrivateMedia } from '../../services/usePrivateMedia';
import { resolvePrivateMedia } from '../../services/privateFiles';
import { cachePrivateBlob } from '../../services/privateFileCache';
jest.mock('../../services/privateFiles', () => ({
  isPrivateFileObjectPath: jest.requireActual('@campus/shared/src/privateFileMedia')
    .isPrivateFileObjectPath,
  resolvePrivateMedia: jest.fn(),
}));
jest.mock('../../services/privateFileCache', () => ({ cachePrivateBlob: jest.fn() }));
function Media({ value }: { value: string }) {
  const url = usePrivateMedia(value);
  return <Text>{url || '佔位'}</Text>;
}
beforeEach(() => jest.clearAllMocks());
test('old HTTPS images remain usable', () => {
  const view = render(<Media value="https://example.com/image" />);
  expect(view.getByText('https://example.com/image')).toBeTruthy();
  expect(resolvePrivateMedia).not.toHaveBeenCalled();
});
test('private images and videos are cached before playback and removed on close', async () => {
  const dispose = jest.fn(async () => {});
  jest.mocked(resolvePrivateMedia).mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
  jest.mocked(cachePrivateBlob).mockResolvedValue({ uri: 'file:///cache/media.mp4', dispose });
  const view = render(<Media value="schools/pu/stories/s/video" />);
  await waitFor(() => expect(view.getByText('file:///cache/media.mp4')).toBeTruthy());
  view.unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
});
test('unavailable private files show a placeholder', async () => {
  jest.mocked(resolvePrivateMedia).mockResolvedValue(null);
  const view = render(<Media value="schools/pu/stories/s/image" />);
  await waitFor(() => expect(resolvePrivateMedia).toHaveBeenCalled());
  expect(view.getByText('佔位')).toBeTruthy();
});
