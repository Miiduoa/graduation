import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AssistantMarkdown } from './AssistantMarkdown';

it('shows heading, list, bold text and a tappable clubs action instead of raw symbols', () => {
  render(
    <AssistantMarkdown text={'## 社團\n請到 **/clubs** 看最新消息。\n\n- **樹與圖作業**（資訊課程）截止 2026-11-05T23:59:00+08:00'} />,
  );
  expect(screen.getByRole('heading', { name: '社團' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '開啟社團' }).getAttribute('href')).toBe('/clubs');
  expect(screen.queryByText('**', { exact: false })).toBeNull();
  expect(screen.queryByText('/clubs')).toBeNull();
  expect(screen.getByText('樹與圖作業')).toBeTruthy();
  expect(screen.getByText(/資訊課程/)).toBeTruthy();
});

it('does not execute html from the model reply', () => {
  render(<AssistantMarkdown text={'<script>alert(1)</script>\n**安全**'} />);
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText('安全')).toBeTruthy();
});

it('does not turn https urls into tappable links', () => {
  render(<AssistantMarkdown text={'請看 [官網](https://example.invalid) 與 https://evil.test'} />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText(/官網/)).toBeTruthy();
  expect(screen.getByText(/https:\/\/evil.test/)).toBeTruthy();
});
