import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssistantThread } from './AssistantThread';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const base = {
  schoolId: 'pu',
  ready: true,
  fallback: false,
  consent: false,
  onConsent: vi.fn(),
  question: '',
  onQuestion: vi.fn(),
  turns: [],
  states: {},
  pending: false,
  error: '',
  onAsk: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

it('shows empty state, suggestion chips and a labelled composer', () => {
  render(<AssistantThread {...base} />);
  expect(screen.getByRole('heading', { name: '今天想問什麼？' })).toBeTruthy();
  fireEvent.click(screen.getByText('這禮拜有什麼要交的'));
  expect(base.onQuestion).toHaveBeenCalledWith('這禮拜有什麼要交的');
  expect(screen.getByLabelText('問題')).toBeTruthy();
  expect((screen.getByText('送出') as HTMLButtonElement).disabled).toBe(true);
});

it('shows a typing status instead of a blank wait', () => {
  render(<AssistantThread {...base} pending consent onConsent={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toMatch(/正在整理回覆/);
});

it('surfaces a friendly error region', () => {
  render(<AssistantThread {...base} error="查詢未完成，請稍後再試。" />);
  expect(screen.getByRole('alert').textContent).toBe('查詢未完成，請稍後再試。');
});

it('measures the composer dock height onto the thread shell', () => {
  class MockObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(node: Element) {
      Object.defineProperty(node, 'getBoundingClientRect', {
        value: () => ({
          height: 128,
          width: 390,
          top: 0,
          left: 0,
          bottom: 128,
          right: 390,
          x: 0,
          y: 0,
          toJSON() {},
        }),
      });
      this.callback(
        [{ target: node, contentRect: { height: 128, width: 390 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', MockObserver);
  const { container } = render(<AssistantThread {...base} />);
  const shell = container.querySelector('[aria-label="情境助理 v2"]') as HTMLElement;
  expect(shell.style.getPropertyValue('--assistant-dock-height')).toBe('128px');
  vi.unstubAllGlobals();
});

it('collapses suggestion chips to one scrolling row after a turn', () => {
  render(
    <AssistantThread
      {...base}
      consent
      onConsent={vi.fn()}
      turns={[{ question: '下一堂課', reply: { answer: '在圖書館', steps: [], cards: [] } }]}
    />,
  );
  const row = screen.getByLabelText('建議問題');
  expect(row.className).toMatch(/chipsCompact/);
  expect(screen.getByRole('button', { name: '送出' }).hasAttribute('disabled')).toBe(true);
});

it('enables explicit public reads without model consent but blocks keyboard submission of ordinary questions', () => {
  const onAsk = vi.fn();
  const view = render(<AssistantThread {...base} ready={false} question="幫我查清大資料庫課程" onAsk={onAsk} />);
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  expect(onAsk).toHaveBeenCalledOnce();
  view.rerender(<AssistantThread {...base} ready={false} question="我的下一堂課" onAsk={onAsk} />);
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(onAsk).toHaveBeenCalledOnce();
});
