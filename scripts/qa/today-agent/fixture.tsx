import { createRoot } from 'react-dom/client';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import { TodayAgent } from '../../../apps/web/src/features/nuni/TodayAgent';
import { readAssistantExecutionJournal } from '../../../apps/web/src/lib/assistantExecutionJournal';
import { readPersonalImports } from '../../../apps/web/src/lib/personalImports';
import type { HomeTask } from '../../../apps/web/src/lib/homeOverview';
import '../../../apps/web/src/app/globals.css';

// Only campus/feature hooks, Next's link adapter, fixed source tasks and HTTP are
// replaced. The controller, panel/CSS, cards, journal, receipt validation, locks
// and local calendar readback are the real product code. No account is connected.
const query = new URLSearchParams(location.search);
const mode = query.get('mode') === 'lost-response' ? 'lost-response' : 'normal';
document.documentElement.dataset.theme = query.get('theme') === 'dark' ? 'dark' : 'light';
const context = 'a'.repeat(43);
const accountId = 'qa-agent';
const schoolId = 'fixture-campus-a';
const localScope = { owner: 'platform:' + accountId, schoolId };
const journalScope = { ...localScope, context };
const now = new Date('2026-11-13T13:00:00+08:00');
const urgent: HomeTask = { id: 'task-urgent', courseId: 'course-a', kind: 'assignment',
  title: '資料結構作業', courseName: '資料結構', dueAt: '2026-11-14T23:59:00+08:00' };
const later: HomeTask = { id: 'task-later', courseId: 'course-b', kind: 'quiz',
  title: '英文測驗', courseName: '大一英文', dueAt: '2026-11-16T12:00:00+08:00' };
const card = {
  tool: 'propose_personal_event', token: 'qa-signed-home-calendar-001',
  mutationId: 'qa-home-calendar-001', schoolId, destination: '個人行事曆',
  args: { title: '準備作業：資料結構作業', date: '2026-11-13', allDay: false,
    startTime: '14:00', endTime: '14:30' },
};
type RecordRow = ReturnType<typeof createAssistantCalendarReceipt>['record'];
type RequestRow = { action: string; body: Record<string, unknown>; outcome?: string };
const records = new Map<string, RecordRow>();
const requests: RequestRow[] = [];
const writes: RecordRow[] = [];
const violations: string[] = [];
let journalAtConfirm: ReturnType<typeof readAssistantExecutionJournal> = [];
let readbacks = 0;
const fail = (message: string): never => { violations.push(message); throw new Error(message); };
const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});
function readReceipt(replay: boolean) {
  const record = records.get(card.mutationId) ?? fail('Readback did not find the confirmed record');
  readbacks += 1;
  return createAssistantCalendarReceipt({ schoolId, mutationId: card.mutationId, event: card.args,
    storage: 'synced', revision: 1, verifiedAt: new Date().toISOString(), replay, record });
}

window.fetch = async (input, init) => {
  const path = String(input);
  const action = path.slice(path.lastIndexOf('/') + 1);
  if (!/^\/api\/nuni\/assistant\/(plan|confirm|reconcile)$/.test(path)) fail('Unexpected HTTP request: ' + path);
  if (init?.method !== 'POST' || new Headers(init.headers).get('X-Campus-Session') !== context)
    fail('Request did not carry the fixture session');
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  const request: RequestRow = { action, body };
  requests.push(request);
  if (body.schoolId !== schoolId || 'question' in body || 'history' in body)
    fail('Expected a scoped structured action without a chat prompt');
  if (action === 'plan') {
    if (JSON.stringify(body.task) !== JSON.stringify({ workspaceId: urgent.courseId, taskId: urgent.id, kind: urgent.kind }))
      fail('Automatic planning did not choose the earliest future task');
    if (!body.routeToken) return json({ bootstrap: true, conversationId: 'qa-home-conversation', routeToken: 'qa-route-token' });
    if (body.routeToken !== 'qa-route-token' || body.conversationId !== 'qa-home-conversation')
      fail('Plan did not retain the bootstrap owner');
    return json({ version: 2, dataRead: true, modelCalls: 0, simulation: false,
      // This matches the accepted API contract, not an assertion of a live server.
      expiresAt: Date.now() + 300000, stopReason: '', cards: [card],
      answer: '已核對原作業、課表與行程，找到今天 14:00–14:30 的 30 分鐘準備時間。確認後會加入個人行事曆。',
      steps: [
        { name: 'get_course_work', status: 'ok', summary: '已重新核對作業截止時間與課程資格' },
        { name: 'find_coursework_study_time', status: 'ok', summary: '已核對已同步課表及個人行程，這段時間沒有衝突' },
      ],
    });
  }
  if (body.conversationId !== 'qa-home-conversation' || body.token !== card.token ||
      JSON.stringify(body.args) !== JSON.stringify(card.args)) fail('Action changed its original signed proposal');
  if (action === 'confirm') {
    journalAtConfirm = readAssistantExecutionJournal(journalScope);
    if (journalAtConfirm.length !== 1 || journalAtConfirm[0].card.mutationId !== card.mutationId)
      fail('Confirmation was dispatched without durable recovery evidence');
    if (records.has(card.mutationId)) fail('The UI issued a second confirmation');
    const record: RecordRow = { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
      schoolId, academicYear: '', semester: '', importedAt: new Date().toISOString(),
      source: { type: 'paste', name: '助理確認', line: 1, rawText: '' } };
    records.set(card.mutationId, record);
    writes.push(record);
    if (mode === 'lost-response') {
      request.outcome = 'committed-response-lost';
      throw new TypeError('QA: connection lost after the synthetic server committed');
    }
  }
  request.outcome = 'readback-verified';
  return json(readReceipt(action === 'reconcile'));
};

Object.assign(window, { __todayAgentQA: { snapshot: () => ({
  fixture: true, mode, requests, writes, readbacks, violations, journalAtConfirm,
  records: [...records.values()], imports: readPersonalImports(localScope),
  journal: readAssistantExecutionJournal(journalScope),
  nativeLocks: typeof navigator.locks?.request === 'function',
}) } });
createRoot(document.getElementById('root')!).render(<main className="fixture-main">
  <p className="fixture-banner">合成 API 驗證頁｜固定台北時間 2026/11/13 13:00。使用真正的首頁代辦介面與瀏覽器儲存，未連接正式帳號、校園系統或模型。情境：{mode === 'lost-response' ? '確認送出後回應遺失，再唯讀核對' : '預覽後確認並讀回'}。</p>
  <TodayAgent context={context} accountId={accountId} now={now} tasks={[later, urgent]} />
</main>);
