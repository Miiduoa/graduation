import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AssistantRoleProfileId } from '@campus/shared/src/assistantRoleProfiles';
import { AssistantThread } from './AssistantThread';

type Props = ComponentProps<typeof AssistantThread>;
vi.mock('@/components/VoiceDictationButton', () => ({ VoiceDictationButton: () => null }));
vi.mock('@/components/SpokenReply', () => ({
  SpokenReply: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const noop = () => {};
const base: Props = {
  inline: true, schoolId: 'pu', ready: true, fallback: false, consent: false,
  onConsent: noop, question: '', onQuestion: noop, turns: [], states: {},
  pending: false, asking: false, onStopAsk: noop, error: '',
  recoverableQuestion: '', onRecoverQuestion: noop, onAsk: noop, onConfirm: noop, onCancel: noop,
};
function Harness(props: Partial<Props>) {
  const [question, setQuestion] = useState(props.question ?? '');
  const [consent, setConsent] = useState(props.consent ?? false);
  const [taskProfile, setTaskProfile] = useState<AssistantRoleProfileId>(props.taskProfile ?? 'student');
  return <AssistantThread {...base} {...props} question={question} onQuestion={setQuestion}
    consent={consent} onConsent={value => { props.onConsent?.(value); setConsent(value); }}
    taskProfile={taskProfile} onTaskProfile={value => { props.onTaskProfile?.(value); setTaskProfile(value); }} />;
}
const field = () => screen.getByLabelText('問題') as HTMLTextAreaElement;
const send = () => screen.getByRole('button', { name: '送出' }) as HTMLButtonElement;
const context = () => screen.getByRole('combobox', { name: '目前處理的工作' }) as HTMLSelectElement;
const checkbox = () => screen.getByRole('checkbox', { name: '同意在本次對話使用 Groq 雲端回答' }) as HTMLInputElement;
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

it('puts the editable task before settings and presents one working context control', () => {
  const onConsent = vi.fn(), onTaskProfile = vi.fn(), onAsk = vi.fn();
  render(<Harness onConsent={onConsent} onTaskProfile={onTaskProfile} onAsk={onAsk} fallback />);
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  expect(field().compareDocumentPosition(context()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(field().compareDocumentPosition(checkbox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(checkbox().checked).toBe(false);
  expect(send().disabled).toBe(true);
  const settings = screen.getByText('本次對話的資料使用設定').closest('details')!;
  expect(settings.open).toBe(false);
  fireEvent.click(screen.getByText('本次對話的資料使用設定'));
  expect(settings.open).toBe(true);
  expect(settings.textContent).toContain('匯入紀錄摘要（成績欄位會遮罩）');
  expect(settings.textContent).toContain('Cloudflare Workers AI');
  expect(checkbox().getAttribute('aria-describedby')).toBe(settings.querySelector('p[id]')!.id);
  expect(onConsent).not.toHaveBeenCalled();
  expect(onTaskProfile).not.toHaveBeenCalled();
  expect(onAsk).not.toHaveBeenCalled();
});

it('requires explicit cloud consent and keeps the question when consent is withdrawn', () => {
  const onAsk = vi.fn(), onConsent = vi.fn();
  render(<Harness question="請幫我寫一段社團介紹" onAsk={onAsk} onConsent={onConsent} />);
  fireEvent.keyDown(field(), { key: 'Enter' });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(send().disabled).toBe(true);
  expect(onAsk).not.toHaveBeenCalled();
  fireEvent.click(checkbox());
  expect(onConsent).toHaveBeenCalledExactlyOnceWith(true);
  expect(send().disabled).toBe(false);
  fireEvent.click(send());
  expect(onAsk).toHaveBeenCalledTimes(1);
  fireEvent.click(checkbox());
  expect(send().disabled).toBe(true);
  expect(field().value).toBe('請幫我寫一段社團介紹');
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(onAsk).toHaveBeenCalledTimes(1);
});

it('keeps connected reads usable without consent or cloud readiness', () => {
  const onAsk = vi.fn();
  render(<Harness ready={false} question="查詢我的行程" onAsk={onAsk} />);
  expect(send().disabled).toBe(false);
  expect(checkbox().checked).toBe(false);
  expect(screen.getByRole('status').textContent).toContain('仍可查已接通的資料與校園服務');
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(onAsk).toHaveBeenCalledOnce();
});

it('changes the requested work profile without losing the draft or earlier result', () => {
  const onTaskProfile = vi.fn(), onAsk = vi.fn();
  const turn = { question: '查我的行程', reply: { answer: '今天下午有一堂課。', dataRead: true, steps: [], cards: [] } };
  render(<Harness question={' 未送出的內容\n第二行 '} turns={[turn]} onTaskProfile={onTaskProfile} onAsk={onAsk} />);
  fireEvent.change(context(), { target: { value: 'merchant' } });
  expect(context().value).toBe('merchant');
  expect(onTaskProfile).toHaveBeenCalledExactlyOnceWith('merchant');
  expect(field().value).toBe(' 未送出的內容\n第二行 ');
  expect(screen.getByRole('log').textContent).toContain('今天下午有一堂課。');
  expect(checkbox().checked).toBe(false);
  expect(onAsk).not.toHaveBeenCalled();
});

it('keeps a loaded work preference as examples until the user explicitly changes context', () => {
  const onTaskProfile = vi.fn();
  render(<Harness preferredWorkContext="teacher" onTaskProfile={onTaskProfile} />);
  expect(context().value).toBe('teacher');
  expect(onTaskProfile).not.toHaveBeenCalled();
  fireEvent.change(context(), { target: { value: 'merchant' } });
  expect(onTaskProfile).toHaveBeenCalledExactlyOnceWith('merchant');
});

it('locks the unified context while a current operation still needs confirmation', () => {
  const onTaskProfile = vi.fn();
  const view = render(<Harness taskProfile="teacher" taskProfileLocked question="尚未送出的備課需求" onTaskProfile={onTaskProfile} />);
  expect(context().disabled).toBe(true);
  fireEvent.change(context(), { target: { value: 'merchant' } });
  expect(context().value).toBe('teacher');
  expect(onTaskProfile).not.toHaveBeenCalled();
  expect(field().value).toBe('尚未送出的備課需求');
  expect(screen.getByText('先完成或取消目前的安排，再切換工作情境。')).toBeTruthy();
  view.rerender(<Harness taskProfile="teacher" onTaskProfile={onTaskProfile} />);
  expect(context().disabled).toBe(false);
  fireEvent.change(context(), { target: { value: 'merchant' } });
  expect(onTaskProfile).toHaveBeenCalledExactlyOnceWith('merchant');
});

it('fills a suggestion without sending and retains editable text through stop and recovery', () => {
  const onAsk = vi.fn(), onStop = vi.fn(), onRecoverQuestion = vi.fn();
  const view = render(<Harness onAsk={onAsk} />);
  fireEvent.click(screen.getByRole('button', { name: '下一堂課在哪裡？' }));
  expect(field().value).toBe('下一堂課在哪裡？');
  expect(document.activeElement).toBe(field());
  expect(onAsk).not.toHaveBeenCalled();
  fireEvent.change(field(), { target: { value: '稍後還要問的內容' } });
  view.rerender(<Harness onAsk={onAsk} onStop={onStop} pending asking />);
  fireEvent.keyDown(field(), { key: 'Enter' });
  expect(onAsk).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '停止回答' }));
  expect(onStop).toHaveBeenCalledOnce();
  expect(field().value).toBe('稍後還要問的內容');
  expect(document.activeElement).toBe(field());
  view.rerender(<Harness onAsk={onAsk} recoverableQuestion="上一個尚未完成的問題" onRecoverQuestion={onRecoverQuestion} />);
  fireEvent.click(screen.getByRole('button', { name: '切換到這個問題' }));
  expect(onRecoverQuestion).toHaveBeenCalledOnce();
  expect(onAsk).not.toHaveBeenCalled();
});

it('keeps a signed unfinished-read retry attached to its original turn without confirming actions', () => {
  const onTaskRetry = vi.fn(), onConfirm = vi.fn(), onAsk = vi.fn();
  const turn: Props['turns'][number] = { question: '查課表和公車', reply: {
    answer: '課表已讀取，公車暫時無法取得。', dataRead: true, steps: [], cards: [],
    taskPlan: { version: 1, steps: [
      { id: 'schedule', label: '核對課表', serviceId: 'timetable', dependsOn: [], status: 'completed', summary: '課表已讀取。' },
      { id: 'transit', label: '查公車資訊', serviceId: 'bus', dependsOn: [], status: 'blocked', summary: '公車暫時無法取得。' },
    ] },
    taskRetry: { version: 1, token: 'task_read_retry.' + 'A'.repeat(43), stepIds: ['transit'], expiresAt: Date.now() + 60_000 },
  } };
  const view = render(<Harness turns={[turn]} onTaskRetry={onTaskRetry} onConfirm={onConfirm} onAsk={onAsk} />);
  fireEvent.click(screen.getByRole('button', { name: '重查未完成項目' }));
  expect(onTaskRetry).toHaveBeenCalledExactlyOnceWith(turn, ['transit']);
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onAsk).not.toHaveBeenCalled();
  expect(checkbox().checked).toBe(false);
  view.rerender(<Harness turns={[turn]} pending onTaskRetry={onTaskRetry} onConfirm={onConfirm} />);
  expect((screen.getByRole('button', { name: '重查未完成項目' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重查未完成項目' }));
  expect(onTaskRetry).toHaveBeenCalledOnce();
});

it('preserves the full-page controls and consent disclosure', () => {
  render(<Harness inline={false} />);
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
  expect(screen.getByLabelText('目前要處理')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '今天想問什麼？' })).toBeTruthy();
  expect(screen.getByRole('checkbox').closest('label')!.textContent).toContain('餐點偏好與社團貼文摘要傳送');
});
