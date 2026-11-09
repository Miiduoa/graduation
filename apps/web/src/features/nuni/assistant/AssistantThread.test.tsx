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
  recoverableQuestion: '',
  onRecoverQuestion: vi.fn(),
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

it('does not send while Enter is selecting an IME candidate, but sends with normal Enter', () => {
  const onAsk = vi.fn();
  render(<AssistantThread {...base} consent question="請查詢校園行程" onAsk={onAsk} />);
  const input = screen.getByLabelText('問題');
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(onAsk).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onAsk).toHaveBeenCalledTimes(1);
});

it('shows the failed question separately without clearing the draft', () => {
  const recover = vi.fn();
  render(
    <AssistantThread {...base} consent question="剛寫好的下一句" recoverableQuestion="請幫我排讀書計畫" onRecoverQuestion={recover} />,
  );
  expect((screen.getByLabelText('問題') as HTMLTextAreaElement).value).toBe('剛寫好的下一句');
  expect(screen.getByText('請幫我排讀書計畫')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '切換到這個問題' }));
  expect(recover).toHaveBeenCalledTimes(1);
});

it('lets people read earlier replies without forced scrolling, then jump to the latest reply', () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const first = { question: '前一個問題', reply: { answer: '前一個回答', steps: [], cards: [] } };
  const next = { question: '後一個問題', reply: { answer: '後一個回答', steps: [], cards: [] } };
  const view = render(<AssistantThread {...base} consent turns={[first]} />);
  scroll.mockClear();
  const end = view.container.querySelector('[class*="logEnd"]') as HTMLElement;
  Object.defineProperty(end, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: window.innerHeight + 500 }),
  });
  fireEvent.scroll(window);
  expect(screen.getByRole('button', { name: '回到最新回覆' })).toBeTruthy();
  view.rerender(<AssistantThread {...base} consent turns={[first, next]} />);
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '回到最新回覆' }));
  expect(scroll).toHaveBeenCalledTimes(1);
});

it('explains that a follow-up can be typed while the prior answer is pending', () => {
  render(<AssistantThread {...base} consent pending question="我先寫下一句" />);
  expect(screen.getByText('正在處理上一個問題，可以先輸入下一句。')).toBeTruthy();
  expect((screen.getByLabelText('問題') as HTMLTextAreaElement).value).toBe('我先寫下一句');
});
