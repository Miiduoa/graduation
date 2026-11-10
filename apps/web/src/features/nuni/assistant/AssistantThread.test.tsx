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
  asking: false,
  onStopAsk: vi.fn(),
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
  render(<AssistantThread {...base} pending asking consent onConsent={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toMatch(/正在整理回覆/);
});

it('preserves the legacy status when no explicit pending label is supplied', () => {
  const { rerender } = render(<AssistantThread {...base} pending asking />);
  expect(screen.getByRole('status').textContent).toContain('正在整理回覆');
  rerender(<AssistantThread {...base} pending asking={false} />);
  expect(screen.getByRole('status').textContent).toContain('正在核對操作結果');
});

it('reports confirmation, reconciliation and cancellation as distinct pending actions', () => {
  const { rerender } = render(<AssistantThread {...base} pending pendingLabel="正在確認操作結果" />);
  expect(screen.getByRole('status').textContent).toContain('正在確認操作結果');
  expect(screen.queryByRole('button', { name: '停止這次回答' })).toBeNull();
  rerender(<AssistantThread {...base} pending pendingLabel="正在核對執行結果" />);
  expect(screen.getByRole('status').textContent).toContain('正在核對執行結果');
  rerender(<AssistantThread {...base} pending pendingLabel="正在確認撤銷結果" />);
  expect(screen.getByRole('status').textContent).toContain('正在確認撤銷結果');
});

it('keeps a typed draft recoverable when switching suggestions', () => {
  const onQuestion = vi.fn();
  const firstSuggestion = '這禮拜有什麼要交的';
  const secondSuggestion = '下一堂課在哪，幾點';
  const { rerender } = render(
    <AssistantThread {...base} question="先查明天的作業和教室" onQuestion={onQuestion} />,
  );
  fireEvent.click(screen.getByRole('button', { name: firstSuggestion }));
  expect(onQuestion).toHaveBeenLastCalledWith(firstSuggestion);
  expect(screen.getByRole('group', { name: '已保留的輸入內容' }).textContent).toContain('原本輸入已保留');
  rerender(<AssistantThread {...base} question={firstSuggestion} onQuestion={onQuestion} />);
  fireEvent.click(screen.getByRole('button', { name: secondSuggestion }));
  expect(onQuestion).toHaveBeenLastCalledWith(secondSuggestion);
  fireEvent.click(screen.getByRole('button', { name: '還原原本輸入' }));
  expect(onQuestion).toHaveBeenLastCalledWith('先查明天的作業和教室');
  expect(screen.queryByRole('group', { name: '已保留的輸入內容' })).toBeNull();
});

it('preserves a newly edited suggestion as the next recoverable draft', () => {
  const onQuestion = vi.fn();
  const { rerender } = render(<AssistantThread {...base} onQuestion={onQuestion} />);
  fireEvent.click(screen.getByRole('button', { name: '這禮拜有什麼要交的' }));
  expect(screen.queryByRole('button', { name: '還原原本輸入' })).toBeNull();
  rerender(<AssistantThread {...base} question="這禮拜有什麼要交的" onQuestion={onQuestion} />);
  fireEvent.change(screen.getByLabelText('問題'), { target: { value: '這禮拜有哪些程式作業要交？' } });
  rerender(<AssistantThread {...base} question="這禮拜有哪些程式作業要交？" onQuestion={onQuestion} />);
  fireEvent.click(screen.getByRole('button', { name: '中午吃什麼' }));
  fireEvent.click(screen.getByRole('button', { name: '還原原本輸入' }));
  expect(onQuestion).toHaveBeenLastCalledWith('這禮拜有哪些程式作業要交？');
});

it('uses one permission guard for keyboard submit and clears a saved draft only when sending', () => {
  const onAsk = vi.fn();
  const onQuestion = vi.fn();
  const { rerender } = render(
    <AssistantThread {...base} question="剛寫好的草稿" onAsk={onAsk} onQuestion={onQuestion} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '這禮拜有什麼要交的' }));
  rerender(<AssistantThread {...base} question="這禮拜有什麼要交的" onAsk={onAsk} onQuestion={onQuestion} />);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  expect(onAsk).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '還原原本輸入' })).toBeTruthy();
  rerender(<AssistantThread {...base} consent question="這禮拜有什麼要交的" onAsk={onAsk} onQuestion={onQuestion} />);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '還原原本輸入' })).toBeNull();
});

it('animates only the newest turn and keeps older messages steady', () => {
  const first = { question: '原本問題', reply: { answer: '原本回答', steps: [], cards: [] } };
  const second = { question: '新的問題', reply: { answer: '新的回答', steps: [], cards: [] } };
  const { container } = render(<AssistantThread {...base} turns={[first, second]} />);
  const turns = [...container.querySelectorAll('article')];
  expect(turns).toHaveLength(2);
  expect(turns[0].className).not.toMatch(/turnEnter/);
  expect(turns[1].className).toMatch(/turnEnter/);
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

it('lets users stop only a pending read, never a write confirmation or recovery', () => {
  const onStopAsk = vi.fn();
  const view = render(<AssistantThread {...base} consent pending asking onStopAsk={onStopAsk} />);
  fireEvent.click(screen.getByRole('button', { name: '停止這次回答' }));
  expect(onStopAsk).toHaveBeenCalledTimes(1);
  view.rerender(<AssistantThread {...base} consent pending asking={false} onStopAsk={onStopAsk} />);
  expect(screen.queryByRole('button', { name: '停止這次回答' })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('正在核對操作結果');
  expect(onStopAsk).toHaveBeenCalledTimes(1);
});
