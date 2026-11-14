import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssistantThread } from './AssistantThread';
import { assistantPermissionMessage } from './copy';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';

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

it('shows a compound task result once and retains the answer if its task contract is invalid', () => {
  const reply = { answer: '來源完整回覆：查到資料庫課程', dataRead: true, steps: [], cards: [],
    taskPlan: { version: 1 as const, steps: [{ id: 'read-course', serviceId: 'timetable' as const,
      label: '核對課表', dependsOn: [], status: 'completed' as const, summary: '查到資料庫課程' }] } };
  const { rerender } = render(<AssistantThread {...base} turns={[{ question: '查課表和餐廳', reply }]} />);
  expect(screen.getAllByText('查到資料庫課程')).toHaveLength(1);
  expect(screen.queryByText('來源完整回覆：查到資料庫課程')).toBeNull();
  rerender(<AssistantThread {...base} turns={[{ question: '查課表和餐廳', reply: {
    ...reply, taskPlan: { ...reply.taskPlan, steps: [] },
  } }]} />);
  expect(screen.getByText('來源完整回覆：查到資料庫課程')).toBeTruthy();
});

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

it('surfaces a friendly error region', () => {
  render(<AssistantThread {...base} error="查詢未完成，請稍後再試。" />);
  expect(screen.getByRole('alert').textContent).toBe('查詢未完成，請稍後再試。');
});

it('offers the working assistant settings route when an action permission is denied', () => {
  render(<AssistantThread {...base} error={assistantPermissionMessage('ASSISTANT_PERMISSION_DENIED')!} />);
  expect(screen.getByRole('alert').textContent).toContain('這次沒有執行');
  expect(screen.getByRole('link', { name: '設定 AI 代辦權限' }).getAttribute('href')).toBe('/settings?section=assistant');
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
  view.rerender(<AssistantThread {...base} ready={false} question="請幫我想一個社團介紹稿" onAsk={onAsk} />);
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(onAsk).toHaveBeenCalledOnce();
});

it.each([
  [false, false], [false, true], [true, false],
])('keeps compound public/private requests behind ready=%s and consent=%s', (ready, consent) => {
  const onAsk = vi.fn();
  render(<AssistantThread {...base} ready={ready} consent={consent}
    question="查清大資料庫課程，另外查我的行程" onAsk={onAsk} />);
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  fireEvent.submit(screen.getByRole('form', { name: '傳送問題' }));
  expect(onAsk).not.toHaveBeenCalled();
});

it('renders reviewed public results from multiple campuses without changing the active private scope', () => {
  const publicCourseResults = (['nthu', 'ncnu'] as const).map(schoolId => ({
    search: { kind: 'search' as const, schoolId, query: '資料庫' },
    data: { schoolId, sourceUrl: resolvePublicCourseOperation(schoolId)!.sourceUrl,
      fetchedAt: '2026-11-14T08:00:00.000Z',
      operation: { id: schoolId + '.courses.search', access: 'anonymous-public', version: 1, responseSchemaVersion: 1 },
      courses: [{ code: 'CS1', title: '資料庫', section: '01', department: '資訊系', teacher: '王老師',
        credits: '3', time: '三34', room: '資訊101', semester: '1151' }], truncated: false },
  }));
  const reply = { answer: '同時取得兩校公開課程與本校公車結果。', steps: [], cards: [], publicCourseResults };
  const view = render(<AssistantThread {...base} consent turns={[{ question: '查兩校開課和公車', reply }]} />);
  expect(screen.getByRole('region', { name: '國立清華大學公開開課查詢' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '國立暨南國際大學公開開課查詢' })).toBeTruthy();
  const links = screen.getAllByRole('link', { name: '查看課程與課表核對' });
  expect(links.map(link => new URL(link.getAttribute('href')!, 'https://nuni.tw').searchParams.get('schoolId'))).toEqual(['nthu', 'ncnu']);
  view.rerender(<AssistantThread {...base} consent turns={[{ question: '查兩校開課和公車', reply: {
    ...reply, publicCourseResults: [publicCourseResults[0], { ...publicCourseResults[1],
      data: { ...publicCourseResults[1].data, sourceUrl: 'https://untrusted.test' } }],
  } }]} />);
  expect(screen.queryByRole('link', { name: '校方資料來源' })).toBeNull();
  expect(screen.queryByRole('region', { name: '國立清華大學公開開課查詢' })).toBeNull();
  expect(screen.getByText('公開課程結果尚未通過核對，請重新查詢。')).toBeTruthy();
});

it.each(['查詢我的行程', '列出未交作業'])('enables personal reads without cloud readiness or model consent: %s', (question) => {
  const onAsk = vi.fn();
  render(<AssistantThread {...base} ready={false} question={question} onAsk={onAsk} />);
  expect((screen.getByRole('button', { name: '送出' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(screen.getByLabelText('問題'), { key: 'Enter' });
  expect(onAsk).toHaveBeenCalledOnce();
});

it.each(['local', 'dataRead'])('renders %s source text literally instead of creating links or formatting', (source) => {
  const answer = '2026-11-12 09:10–10:00｜[假的設定入口](/settings) **私人課程**';
  const reply = { answer, steps: [], cards: [], ...(source === 'local'
    ? { local: { kind: 'personal' as const, content: answer, serviceIds: [] } } : { dataRead: true }) };
  const { container } = render(<AssistantThread {...base} turns={[{ question: '課程資料', reply }]} />);
  expect(screen.getByText(answer)).toBeTruthy();
  expect(screen.queryByRole('link', { name: '假的設定入口' })).toBeNull();
  expect(container.querySelector('strong')).toBeNull();
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
