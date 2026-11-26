import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PostImagePreview } from './PostImagePreview';

const BrowserURL = URL;
const createObjectURL = vi.fn<(file: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
const firstFile = new File(['first photo'], 'first.png', { type: 'image/png' });
const firstUrl = `blob:${window.location.origin}/first-photo`;

beforeEach(() => {
  createObjectURL.mockReset().mockReturnValue(firstUrl);
  revokeObjectURL.mockReset();
  vi.stubGlobal('URL', Object.assign(class extends BrowserURL {}, {
    createObjectURL,
    revokeObjectURL,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('previews only the local object URL created for the selected file', () => {
  render(<PostImagePreview file={firstFile} />);
  expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(firstFile);
  expect(screen.getByRole('img', { name: '貼文圖片預覽' }).getAttribute('src')).toBe(firstUrl);
});

it.each([
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'https://untrusted.example/photo.png',
  'blob:https://untrusted.example/photo',
  '<img src=x onerror=alert(1)>',
])('rejects an unexpected object URL without assigning it to the image: %s', (url) => {
  createObjectURL.mockReturnValue(url);
  const view = render(<PostImagePreview file={firstFile} />);
  expect(screen.getByRole('img', { name: '貼文圖片預覽' }).getAttribute('src')).toBeNull();
  expect(document.querySelector('script')).toBeNull();
  view.unmount();
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url);
});

it('removes and revokes the old preview on replacement and on leaving the composer', () => {
  const secondFile = new File(['second photo'], 'second.jpg', { type: 'image/jpeg' });
  const secondUrl = `blob:${window.location.origin}/second-photo`;
  createObjectURL.mockReturnValueOnce(firstUrl).mockReturnValueOnce(secondUrl);
  const view = render(<PostImagePreview file={firstFile} />);
  const image = screen.getByRole('img', { name: '貼文圖片預覽' });
  view.rerender(<PostImagePreview file={secondFile} />);
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(firstUrl);
  expect(image.getAttribute('src')).toBe(secondUrl);
  view.unmount();
  expect(image.getAttribute('src')).toBeNull();
  expect(revokeObjectURL.mock.calls).toEqual([[firstUrl], [secondUrl]]);
});
