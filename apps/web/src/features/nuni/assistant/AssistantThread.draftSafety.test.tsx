import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssistantThread } from './AssistantThread';

type Props = ComponentProps<typeof AssistantThread>;
vi.mock('@/components/VoiceDictationButton', () => ({
  VoiceDictationButton: ({ disabled, onTranscript }: { disabled: boolean; onTranscript: (text: string) => void }) => (
    <button type="button" disabled={disabled} onClick={() => onTranscript('語音補上的內容')}>測試語音輸入</button>
  ),
}));
vi.mock('@/components/SpokenReply', () => ({
  SpokenReply: ({ children }: { children: ReactNode }) => <div aria-label="保留的朗讀區">{children}</div>,
}));

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
const noop = () => {};
const base: Props = {
  schoolId: 'pu', ready: true, fallback: false, consent: true,
  onConsent: noop, question: '', onQuestion: noop, turns: [], states: {},
  pending: false, asking: false, onStopAsk: noop, error: '',
  recoverableQuestion: '', onRecoverQuestion: noop, onAsk: noop, onConfirm: noop, onCancel: noop,
};
function Harness({ initial = '', ...props }: Partial<Props> & { initial?: string }) {
  const [question, setQuestion] = useState(initial);
  return <AssistantThread {...base} {...props} question={question} onQuestion={setQuestion}
    onAsk={() => { props.onAsk?.(); setQuestion(''); }} />;
}
const field = () => screen.getByLabelText('問題') as HTMLTextAreaElement;
const choose = (name = '這禮拜有什麼要交的') => fireEvent.click(screen.getByRole('button', { name }));
const swap = () => fireEvent.click(screen.getByRole('button', { name: '切換保留草稿' }));
const first = { question: '舊問題', reply: { answer: '舊回答', steps: [], cards: [] } };
const second = { question: '新問題', reply: { answer: '新回答', steps: [], cards: [] } };

it('swaps original and later manual edits, retaining exact whitespace and focus', () => {
  render(<Harness initial={' 原稿\n第二行 '} />);
  choose();
  fireEvent.change(field(), { target: { value: ' 後來寫的內容 ' } });
  swap();
  expect(field().value).toBe(' 原稿\n第二行 ');
  expect(document.activeElement).toBe(field());
  swap();
  expect(field().value).toBe(' 後來寫的內容 ');
});

it('keeps the first hand-written draft while cycling unchanged suggestions', () => {
  render(<Harness initial="我的原稿" />);
  choose();
  choose('下一堂課在哪，幾點');
  swap();
  expect(field().value).toBe('我的原稿');
  expect(screen.queryByRole('group', { name: '已保留的輸入內容' })).toBeNull();
});

it('blocks a third replacement rather than deleting either edited version', () => {
  const onAsk = vi.fn();
  render(<Harness initial="第一份內容" onAsk={onAsk} />);
  choose();
  fireEvent.change(field(), { target: { value: '第二份內容' } });
  choose('中午吃什麼');
  expect(field().value).toBe('第二份內容');
  expect(screen.getByRole('status').textContent).toContain('兩份草稿都已保留');
  swap();
  expect(field().value).toBe('第一份內容');
  swap();
  expect(field().value).toBe('第二份內容');
  expect(onAsk).not.toHaveBeenCalled();
});

it('retains an unrelated original after sending a suggestion and a later request failure', () => {
  const onAsk = vi.fn();
  const view = render(<Harness initial="尚未送出的原稿" onAsk={onAsk} />);
  choose();
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(field().value).toBe('');
  view.rerender(<Harness onAsk={onAsk} error="回覆未完成" recoverableQuestion="這禮拜有什麼要交的" />);
  swap();
  expect(field().value).toBe('尚未送出的原稿');
  expect(screen.getByRole('group', { name: '未完成的問題' }).textContent).toContain('這禮拜有什麼要交的');
});

it.each([
  { pending: true }, { consent: false }, { ready: false }, { question: '  ' }, { onStop: noop },
])('rejected Enter/form submit does not steal reading position: %j', (overrides) => {
  const onAsk = vi.fn();
  const props = { ...base, question: '幫我排今晚寫作業', turns: [first], ...overrides, onAsk };
  const view = render(<AssistantThread {...props} />);
  const end = view.container.querySelector('[class*="logEnd"]') as HTMLElement;
  Object.defineProperty(end, 'getBoundingClientRect', { configurable: true, value: () => ({ top: window.innerHeight + 500 }) });
  fireEvent.scroll(window);
  const scroll = vi.mocked(Element.prototype.scrollIntoView);
  scroll.mockClear();
  fireEvent.keyDown(field(), { key: 'Enter' });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(onAsk).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '回到最新回覆' })).toBeTruthy();
  view.rerender(<AssistantThread {...props} turns={[first, second]} />);
  expect(scroll).not.toHaveBeenCalled();
});

it('preserves inline voice, spoken replies and the separate stop control after synchronization', () => {
  const onAsk = vi.fn();
  const onStop = vi.fn();
  render(<Harness inline initial="文字草稿" turns={[first]} onAsk={onAsk} onStop={onStop} />);
  fireEvent.click(screen.getByRole('button', { name: '測試語音輸入' }));
  expect(field().value).toBe('文字草稿 語音補上的內容');
  expect(screen.getByLabelText('保留的朗讀區').textContent).toContain('舊回答');
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(onAsk).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '停止回答' }));
  expect(onStop).toHaveBeenCalledTimes(1);
});

it('does not replay animations on older turns', () => {
  const { container } = render(<AssistantThread {...base} turns={[first, second]} />);
  const articles = container.querySelectorAll('article');
  expect(articles[0].style.animation).toBe('none');
  expect(articles[1].style.animation).toBe('');
});

it('drops saved drafts when the authenticated conversation is remounted', () => {
  const view = render(<Harness key="alice:pu" initial="私人原稿" />);
  choose();
  expect(screen.getByRole('group', { name: '已保留的輸入內容' })).toBeTruthy();
  view.rerender(<Harness key="bob:nthu" schoolId="nthu" />);
  expect(field().value).toBe('');
  expect(screen.queryByRole('group', { name: '已保留的輸入內容' })).toBeNull();
});

it('allows local navigation without cloud consent or an available model', () => {
  const onAsk = vi.fn();
  render(<Harness initial="開啟圖書館" ready={false} consent={false} onAsk={onAsk} />);
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(onAsk).toHaveBeenCalledTimes(1);
});
