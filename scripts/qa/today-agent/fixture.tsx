import { createRoot } from 'react-dom/client';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import type { AssistantCourseworkFollowup, AssistantCourseworkFollowupStatus } from '@campus/shared/src/assistantCourseworkFollowup';
import { TodayAgent } from '../../../apps/web/src/features/nuni/TodayAgent';
import { readAssistantExecutionJournal } from '../../../apps/web/src/lib/assistantExecutionJournal';
import { readPersonalImports } from '../../../apps/web/src/lib/personalImports';
import { readTodayAgentFollowups } from '../../../apps/web/src/lib/todayAgentFollowups';
import type { HomeTask } from '../../../apps/web/src/lib/homeOverview';
import '../../../apps/web/src/app/globals.css';

// Only campus/feature hooks, Next's link adapter, source tasks and HTTP are replaced.
// The controller, panel/CSS, cards, proof storage, journal, parsers and Web Locks
// are real product code. Followup responses describe synthetic backend states;
// backend classification/authentication is covered separately by service tests.
const query = new URLSearchParams(location.search);
const mode = query.get('mode') === 'lost-response' ? 'lost-response' : 'normal';
document.documentElement.dataset.theme = query.get('theme') === 'dark' ? 'dark' : 'light';
const context = 'a'.repeat(43);
const accountId = 'qa-agent';
const schoolId = 'fixture-campus-a';
const localScope = { owner: 'platform:' + accountId, schoolId };
const conversationId = 'qa-home-conversation';
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
type RequestRow = {
  action: string;
  body: Record<string, unknown>;
  accountId: string;
  session: string;
  outcome?: string;
  followup?: AssistantCourseworkFollowup;
};
type TaskList = 'all' | 'urgent' | 'none';
type ServerState = {
  version: 1;
  mode: typeof mode;
  requests: RequestRow[];
  records: RecordRow[];
  writes: RecordRow[];
  violations: string[];
  readbacks: number;
  journalAtConfirm: ReturnType<typeof readAssistantExecutionJournal>;
  journalRemovals: { key: string; proofs: ReturnType<typeof readTodayAgentFollowups> }[];
  followupStatus: AssistantCourseworkFollowupStatus;
  followupFailure: boolean;
  activeAccount: string;
  activeContext: string;
  tasks: TaskList;
  generation: number;
  loads: number;
};
// This is the synthetic HTTP server's ledger, deliberately separate from the
// product's localStorage. Keeping it across reloads proves that the real product
// restores its own proof instead of creating another event after a page reload.
const SERVER_KEY = 'qa.today-agent.synthetic-server.v2';
const saved = sessionStorage.getItem(SERVER_KEY);
const server: ServerState = saved ? JSON.parse(saved) : {
  version: 1, mode, requests: [], records: [], writes: [], violations: [], readbacks: 0,
  journalAtConfirm: [], journalRemovals: [], followupStatus: 'scheduled', followupFailure: false,
  activeAccount: accountId, activeContext: context, tasks: 'all', generation: 0, loads: 0,
};
if (server.version !== 1 || server.mode !== mode) throw new Error('Unexpected synthetic server state');
server.loads += 1;
function persist() { sessionStorage.setItem(SERVER_KEY, JSON.stringify(server)); }
persist();
const currentScope = () => ({ owner: 'platform:' + server.activeAccount, schoolId });
const currentJournalScope = () => ({ ...currentScope(), context: server.activeContext });
const fail = (message: string): never => {
  server.violations.push(message);
  persist();
  throw new Error(message);
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const target = { workspaceId: urgent.courseId, taskId: urgent.id, kind: urgent.kind };

// Observe real journal removal without replacing storage behavior. The browser
// assertions require a matching durable proof to exist before recovery is cleared.
const nativeRemoveItem = Storage.prototype.removeItem;
Storage.prototype.removeItem = function (key: string) {
  if (this === window.localStorage && key.startsWith('campus.assistant-execution.v1:')) {
    server.journalRemovals.push({ key, proofs: readTodayAgentFollowups(currentScope()) });
    persist();
  }
  nativeRemoveItem.call(this, key);
};

function readReceipt(replay: boolean) {
  const record = server.records.find(row => row.id === card.mutationId) ?? fail('Readback did not find the confirmed record');
  server.readbacks += 1;
  persist();
  return createAssistantCalendarReceipt({ schoolId, mutationId: card.mutationId, event: card.args,
    storage: 'synced', revision: 1, verifiedAt: now.toISOString(), replay, record });
}
function followup(): AssistantCourseworkFollowup {
  const status = server.followupStatus;
  const checkedAt = status === 'elapsed' ? new Date('2026-11-13T15:00:00+08:00').toISOString()
    : status === 'in_progress' ? new Date('2026-11-13T14:15:00+08:00').toISOString() : now.toISOString();
  const source = {
    title: status === 'source_changed' ? urgent.title + '（已更新）' : urgent.title,
    courseName: urgent.courseName,
    dueAt: status === 'source_changed' ? '2026-11-13T13:45:00+08:00' : urgent.dueAt!,
    state: status === 'closed' ? 'closed' as const : 'open' as const,
    submitted: status === 'submitted',
  };
  return { version: 1, operation: 'coursework.followup', schoolId, mutationId: card.mutationId,
    checkedAt, status, task: status === 'not_coursework' ? null : { ...target, kind: 'assignment' },
    source: status === 'unavailable' || status === 'not_coursework' ? null : source,
    calendar: status === 'event_changed' ? 'changed' : status === 'event_missing' ? 'missing'
      : status === 'unavailable' || status === 'not_coursework' ? 'unavailable' : 'matching',
    event: { ...card.args } };
}

window.fetch = async (input, init) => {
  const path = String(input);
  const action = path.slice(path.lastIndexOf('/') + 1);
  if (!/^\/api\/nuni\/assistant\/(plan|confirm|reconcile|followup)$/.test(path)) fail('Unexpected HTTP request: ' + path);
  if (init?.method !== 'POST' || new Headers(init.headers).get('X-Campus-Session') !== server.activeContext)
    fail('Request did not carry the fixture session');
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  const request: RequestRow = { action, body, accountId: server.activeAccount, session: server.activeContext };
  server.requests.push(request);
  persist();
  if (body.schoolId !== schoolId || 'question' in body || 'history' in body)
    fail('Expected a scoped structured action without a chat prompt');
  if (action === 'plan') {
    if (server.activeAccount !== accountId || !same(body.task, target))
      fail('Automatic planning did not choose the earliest future task');
    if (!body.routeToken) return json({ bootstrap: true, conversationId, routeToken: 'qa-route-token' });
    if (body.routeToken !== 'qa-route-token' || body.conversationId !== conversationId)
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
  if (body.conversationId !== conversationId || body.token !== card.token ||
      !same(body.args, card.args)) fail('Action changed its original signed proposal');
  if (action === 'followup') {
    if (server.activeAccount !== accountId || body.issuedContext !== context ||
        !same(Object.keys(body).sort(), ['schoolId', 'conversationId', 'issuedContext', 'token', 'args'].sort()))
      fail('Followup changed the original proof, current account or request contract');
    const proofs = readTodayAgentFollowups(currentScope());
    if (proofs.length !== 1 || proofs[0].issuedContext !== context ||
        proofs[0].conversationId !== conversationId || proofs[0].card.mutationId !== card.mutationId ||
        !same(proofs[0].card.args, card.args) || !server.records.some(row => row.id === card.mutationId))
      fail('Followup was not backed by the verified persisted arrangement');
    if (server.followupFailure) {
      request.outcome = 'synthetic-read-failed';
      persist();
      return json({ error: 'QA_READ_UNAVAILABLE', message: 'QA：來源暫時無法讀取。' }, 503);
    }
    request.followup = followup();
    request.outcome = request.followup.status;
    persist();
    return json(request.followup);
  }
  if (action === 'confirm') {
    server.journalAtConfirm = readAssistantExecutionJournal(currentJournalScope());
    if (server.journalAtConfirm.length !== 1 || server.journalAtConfirm[0].card.mutationId !== card.mutationId)
      fail('Confirmation was dispatched without durable recovery evidence');
    if (server.records.some(row => row.id === card.mutationId)) fail('The UI issued a second confirmation');
    const record: RecordRow = { ...card.args, id: card.mutationId, batchId: card.mutationId, kind: 'events',
      schoolId, academicYear: '', semester: '', importedAt: now.toISOString(),
      source: { type: 'paste', name: '助理確認', line: 1, rawText: '' } };
    server.records.push(record);
    server.writes.push(record);
    if (mode === 'lost-response') {
      request.outcome = 'committed-response-lost';
      persist();
      throw new TypeError('QA: connection lost after the synthetic server committed');
    }
  }
  request.outcome = 'readback-verified';
  return json(readReceipt(action === 'reconcile'));
};

function clearAutomaticCooldown() {
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith('campus.today-agent-auto.v1:')) sessionStorage.removeItem(key);
}
const root = createRoot(document.getElementById('root')!);
function render() {
  const tasks = server.tasks === 'all' ? [later, urgent] : server.tasks === 'urgent' ? [urgent] : [];
  root.render(<main className="fixture-main">
    <p className="fixture-banner">合成 API 驗證頁｜固定台北時間 2026/11/13 13:00。使用真正的首頁代辦介面與瀏覽器儲存，未連接正式帳號、校園系統或模型。情境：{mode === 'lost-response' ? '確認送出後回應遺失，再唯讀核對' : '預覽、確認與後續追蹤'}。</p>
    <TodayAgent key={server.generation} context={server.activeContext} accountId={server.activeAccount}
      now={now} tasks={tasks} />
  </main>);
}
function switchSession(account: string, session: string, tasks: TaskList) {
  server.activeAccount = account;
  server.activeContext = session;
  server.tasks = tasks;
  server.generation += 1;
  clearAutomaticCooldown();
  persist();
  render();
}
Object.assign(window, { __todayAgentQA: {
  snapshot: () => ({
    fixture: true, ...server, imports: readPersonalImports(currentScope()),
    journal: readAssistantExecutionJournal(currentJournalScope()),
    proofs: readTodayAgentFollowups(currentScope()), primaryProofs: readTodayAgentFollowups(localScope),
    otherSchoolProofs: readTodayAgentFollowups({ ...localScope, schoolId: 'fixture-campus-b' }),
    nativeLocks: typeof navigator.locks?.request === 'function',
  }),
  setFollowupStatus: (status: AssistantCourseworkFollowupStatus) => { server.followupStatus = status; persist(); },
  setFollowupFailure: (failed: boolean) => { server.followupFailure = failed; persist(); },
  setTasks: (tasks: TaskList) => { server.tasks = tasks; persist(); render(); },
  clearAutomaticCooldown,
  remount: () => { server.generation += 1; clearAutomaticCooldown(); persist(); render(); },
  relogin: () => switchSession(accountId, 'b'.repeat(43), 'urgent'),
  switchAccount: () => switchSession('qa-agent-other', 'c'.repeat(43), 'none'),
  returnAccount: () => switchSession(accountId, 'd'.repeat(43), 'urgent'),
} });
render();
