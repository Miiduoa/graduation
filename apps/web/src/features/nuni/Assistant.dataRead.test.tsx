import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Assistant } from './Assistant';

vi.mock('./Session', () => ({
  useNuniSession: () => ({ loading: false, error: '', pendingLogout: false,
    session: { context: 'a'.repeat(43), platformAccountId: 'alice' } }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({ status: 'ready', schoolId: 'pu' }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
const json = (value: object) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' },
});
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); });

it('shows source text literally and keeps deterministic private reads out of later model history', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('capability')) return json({ enabled: true, ready: true, version: 2 });
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1
      ? json({ answer: '雲端課程：[作業原標題](/settings) **資料分析**｜截止 2026-11-15 23:59',
        dataRead: true, steps: [{ name: 'get_due_work', status: 'ok', summary: '已讀取' }], cards: [] })
      : json({ answer: '請告訴我想找哪一類餐廳。', steps: [], cards: [] });
  }));
  render(<Assistant />);
  const question = await screen.findByLabelText('問題');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(question, { target: { value: '今天還有什麼作業沒交' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText('雲端課程：[作業原標題](/settings) **資料分析**｜截止 2026-11-15 23:59');
  const conversation = screen.getByRole('log', { name: '對話紀錄' });
  expect(within(conversation).queryByRole('link', { name: '作業原標題' })).toBeNull();
  fireEvent.change(question, { target: { value: '附近餐廳有哪些' } });
  fireEvent.click(screen.getByText('送出'));
  await screen.findByText('請告訴我想找哪一類餐廳。');
  expect(bodies).toHaveLength(2);
  expect(bodies[1].history).toEqual([]);
  expect(JSON.stringify(bodies[1])).not.toContain('作業原標題');
  expect(JSON.stringify(bodies[1])).not.toContain('今天還有什麼作業沒交');
});
