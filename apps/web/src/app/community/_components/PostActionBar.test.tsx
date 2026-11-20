import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PostActionsRow, PostBookmarkShareActions } from './PostActionBar';
import styles from '../community.module.css';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../community.module.css'), 'utf8');

it('keeps bookmark and share labels on one horizontal line and shortens them when the row is narrow', () => {
  expect(css).toMatch(/\.postAction[\s\S]*?white-space:\s*nowrap/);
  expect(css).toMatch(/\.postActionsEnd[\s\S]*?flex-wrap:\s*wrap/);
  expect(css).toMatch(/@media \(max-width: 390px\)[\s\S]*\.postActionShort \{\s*display:\s*inline/);
  render(
    <PostActionsRow>
      <PostBookmarkShareActions
        saved
        onBookmark={() => undefined}
        onShare={() => undefined}
        shareAriaLabel="分享貼文：測試"
      />
    </PostActionsRow>,
  );
  const bookmark = screen.getByRole('button', { name: '取消收藏貼文' });
  const share = screen.getByRole('button', { name: '分享貼文：測試' });
  expect(bookmark.className).toContain(styles.postAction);
  expect(share.className).toContain(styles.postAction);
  expect(bookmark.textContent).toContain('已收藏');
  expect(bookmark.textContent).toContain('已藏');
  expect(share.textContent).toContain('分享');
  expect(bookmark.textContent).not.toMatch(/已\s+收\s+藏/);
});

it('lets the caller toggle bookmark from the unfavorited state', () => {
  const onBookmark = vi.fn();
  render(
    <PostBookmarkShareActions
      saved={false}
      onBookmark={onBookmark}
      onShare={() => undefined}
      shareAriaLabel="分享"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '收藏貼文' }));
  expect(onBookmark).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '收藏貼文' }).textContent).toContain('收藏');
});

it('disables the bookmark button and does not fire when the feature is unavailable', () => {
  const onBookmark = vi.fn();
  render(
    <PostBookmarkShareActions
      saved={false}
      bookmarkUnavailable
      onBookmark={onBookmark}
      onShare={() => undefined}
      shareAriaLabel="分享"
    />,
  );
  const bookmark = screen.getByRole('button', { name: '收藏功能暫時無法使用' });
  expect((bookmark as HTMLButtonElement).disabled).toBe(true);
  expect(bookmark.getAttribute('title')).toBe('收藏功能暫時無法使用');
  fireEvent.click(bookmark);
  expect(onBookmark).not.toHaveBeenCalled();
});
