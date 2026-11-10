// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  isPrivateFileObjectPath,
  privateAttachmentPaths,
  resolvePrivateFileMedia,
} from '@campus/shared/src/privateFileMedia';

it.each([
  'schools/pu/stories/s/image',
  'groups/g/cover.png',
  'groups/g/posts/p/a.pdf',
  'assignments/a/submissions/u/a.pdf',
])('recognizes %s', (path) => {
  expect(isPrivateFileObjectPath(path)).toBe(true);
});
it.each([
  'https://example.com/a.png',
  'schools/pu/stories/../image',
  'schools/pu/stories/s',
  '/groups/g/cover.png',
  '',
])('rejects %s', (path) => {
  expect(isPrivateFileObjectPath(path)).toBe(false);
});
it('keeps legacy URLs and returns a placeholder without network when disabled', async () => {
  const download = vi.fn();
  expect(await resolvePrivateFileMedia('https://example.com/a', false, download)).toBe(
    'https://example.com/a',
  );
  expect(await resolvePrivateFileMedia('schools/pu/stories/s/image', false, download)).toBeNull();
  expect(download).not.toHaveBeenCalled();
});
it('renews once after a failed download, then gives up gently', async () => {
  const download = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error('expired'), { statusCode: 403, source: 'object' }))
    .mockResolvedValueOnce('downloaded');
  expect(await resolvePrivateFileMedia('schools/pu/stories/s/image', true, download)).toBe(
    'downloaded',
  );
  expect(download).toHaveBeenCalledTimes(2);
  download.mockReset().mockRejectedValue(new TypeError('offline'));
  expect(await resolvePrivateFileMedia('schools/pu/stories/s/image', true, download)).toBeNull();
  expect(download).toHaveBeenCalledTimes(2);
});
it('downloads successful media only once and accepts both attachment shapes', async () => {
  const download = vi.fn().mockResolvedValue(new Blob(['image']));
  expect(
    await resolvePrivateFileMedia('schools/pu/stories/s/image', true, download),
  ).toBeInstanceOf(Blob);
  expect(download).toHaveBeenCalledTimes(1);
  expect(
    privateAttachmentPaths([
      'groups/g/posts/p/a.pdf',
      { url: 'https://example.com/a' },
      { url: 'javascript:alert(1)' },
    ]),
  ).toEqual(['groups/g/posts/p/a.pdf', 'https://example.com/a']);
});

it.each([401, 403, 404, 429])('does not renew API rejection %s', async (statusCode) => {
  const download = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { statusCode, source: 'api' }));
  expect(await resolvePrivateFileMedia('schools/pu/stories/s/image', true, download)).toBeNull();
  expect(download).toHaveBeenCalledTimes(1);
});
it('renews a server failure once', async () => {
  const download = vi.fn().mockRejectedValue(Object.assign(new Error('temporary'), { statusCode: 503, source: 'api' }));
  expect(await resolvePrivateFileMedia('schools/pu/stories/s/image', true, download)).toBeNull();
  expect(download).toHaveBeenCalledTimes(2);
});
