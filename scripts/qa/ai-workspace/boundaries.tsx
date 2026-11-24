import {
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createAssistantCalendarReceipt } from '@campus/shared/src/assistantExecution';
import type { AssistantCourseworkFollowup } from '@campus/shared/src/assistantCourseworkFollowup';
import { readAssistantExecutionJournal } from '@/lib/assistantExecutionJournal';
import { readPersonalImports } from '@/lib/personalImports';
import { readTodayAgentFollowups } from '@/lib/todayAgentFollowups';

// Only identity, campus selection, routing and infrastructure are synthetic.
// The workspace, composer, conversation, response rendering and CSS are real.
export const fixtureOptions = new URLSearchParams(location.search);
export const courseworkScenario = fixtureOptions.get('coursework');
if (courseworkScenario !== null && !['normal', 'read-failure'].includes(courseworkScenario))
  throw new Error('Unknown coursework fixture scenario');
export const courseworkTask = {
  id: 'qa-work',
  courseId: 'qa-course',
  kind: 'assignment' as const,
  title: '合成資料模型作業',
  courseName: '合成資料庫課程',
  dueAt: '2026-11-25T23:59:00+08:00',
};
const schools = [
  { id: 'pu', code: 'PU', name: '合成校園・靜宜大學', shortName: '合成靜宜', status: 'open' },
  { id: 'ntu', code: 'NTU', name: '合成校園・臺灣大學', shortName: '合成臺大', status: 'open' },
];
let state = {
  owner: 'qa-alpha',
  guest: fixtureOptions.get('guest') === '1',
  schoolId: 'pu' as string | null,
  pathname: '/',
  search: 'school=PU&schoolId=pu&campus=pu',
  checking: false,
  cloudReady: true,
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => state;
export const useFixture = () => useSyncExternalStore(subscribe, snapshot, snapshot);
function update(change: Partial<typeof state>) {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}
const ledger = {
  requests: [] as Array<{
    path: string;
    method: string;
    body: Record<string, unknown> | null;
    session: string | null;
    outcome?: string;
    proofPhase?: 'journal' | 'durable';
  }>,
  navigations: [] as string[],
  unexpected: [] as string[],
};
const courseworkScope = { owner: 'platform:qa-alpha', schoolId: 'pu' };
const courseworkContext = 'a'.repeat(43);
const courseworkConversation = 'qa-chat-coursework-conversation';
const courseworkCard = {
  tool: 'propose_personal_event',
  token: 'qa-signed-chat-coursework-001',
  coursework: true,
  mutationId: 'qa-chat-coursework-001',
  schoolId: 'pu',
  destination: '個人行事曆',
  args: {
    title: '準備合成資料模型作業',
    date: '2026-11-24',
    allDay: false,
    startTime: '14:00',
    endTime: '14:30',
  },
};
const homeCard = {
  ...courseworkCard,
  token: 'qa-signed-home-unsent-001',
  mutationId: 'qa-home-unsent-001',
};
type RecordRow = ReturnType<typeof createAssistantCalendarReceipt>['record'];
const courseworkServer = {
  records: [] as RecordRow[],
  writes: [] as RecordRow[],
  readbacks: 0,
  followupFailure: courseworkScenario === 'read-failure',
  journalAtConfirm: [] as ReturnType<typeof readAssistantExecutionJournal>,
  journalRemovals: [] as Array<{ key: string; proofs: ReturnType<typeof readTodayAgentFollowups> }>,
};
const courseworkJournalScope = { ...courseworkScope, context: courseworkContext };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

// Observe the real storage operation without seeding or replacing product proofs.
// Classification first reads the signed backend source; journal removal must wait
// until that result has been saved through the product's real Web Lock/storage code.
if (courseworkScenario) {
  const removeItem = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (key: string) {
    if (this === window.sessionStorage && key.startsWith('campus.assistant-execution.v1:')) {
      courseworkServer.journalRemovals.push({
        key,
        proofs: readTodayAgentFollowups(courseworkScope),
      });
    }
    removeItem.call(this, key);
  };
}
export function navigate(href: string) {
  const url = new URL(href, location.origin);
  if (url.origin !== location.origin) throw new Error('Fixture navigation must stay local');
  ledger.navigations.push(url.pathname + url.search + url.hash);
  history.pushState({}, '', url.pathname + url.search + url.hash);
  update({ pathname: url.pathname, search: url.search.slice(1) });
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
addEventListener('popstate', () =>
  update({ pathname: location.pathname, search: location.search.slice(1) }),
);

export default function Link({
  href = '/',
  onClick,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate(String(href));
  }
  return (
    <a {...props} href={href} onClick={follow}>
      {children}
    </a>
  );
}
export const usePathname = () => useFixture().pathname;
export function useSearchParams() {
  const query = useFixture().search;
  return useMemo(() => new URLSearchParams(query), [query]);
}
export const useRouter = () => ({ push: navigate, replace: navigate });
export function switchAccount() {
  update({ owner: state.owner === 'qa-alpha' ? 'qa-beta' : 'qa-alpha', guest: false });
}
export function setGuest(guest: boolean) {
  update({ guest });
}
export function setChecking(checking: boolean) {
  update({ checking });
}
export function setCloudReady(cloudReady: boolean) {
  update({ cloudReady });
}
export function selectCampus(schoolId: string | null) {
  const school = schools.find((item) => item.id === schoolId);
  const search = school
    ? `school=${school.code}&schoolId=${school.id}&campus=${school.id}`
    : 'campus=all';
  history.replaceState({}, '', state.pathname + '?' + search);
  update({ schoolId, search });
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
export function useAuth() {
  const current = useFixture();
  // Platform-only identity exercises the real Nuni Conversation without a
  // synthetic school token or any Firebase account.
  return {
    user: null,
    loading: current.checking,
    error: null,
    signOutUser: async () => setGuest(true),
  };
}
export function useNuniSession() {
  const current = useFixture();
  return {
    session: current.guest
      ? null
      : {
          platformAccountId: current.owner,
          context: (current.owner === 'qa-alpha' ? 'a' : 'b').repeat(43),
        },
    loading: current.checking,
    error: null,
    pendingLogout: false,
    refresh: async () => {},
    logout: async () => setGuest(true),
  };
}
export const useOptionalNuniSession = useNuniSession;
export function useSelectedSchool() {
  const current = useFixture();
  return {
    schools,
    selectedSchool: schools.find((item) => item.id === current.schoolId) ?? null,
    selectedSchoolId: current.schoolId,
    loading: current.checking,
    catalogStatus: 'ready',
    selectSchool: selectCampus,
    onRetryCatalog: () => {},
  };
}
export const useOptionalSelectedSchool = useSelectedSchool;
export function NuniSessionProvider({ children }: { children: ReactNode }) {
  return children;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  return children;
}
export const AuthGuard = AuthProvider;
export const GuestAuthProvider = AuthProvider;
export const SelectedSchoolProvider = AuthProvider;

function unexpected(name: string): never {
  ledger.unexpected.push(name);
  throw new Error('Real infrastructure is disabled in AI workspace QA: ' + name);
}
export async function browserRequest(path: string) {
  return unexpected('browserRequest:' + path);
}
export async function browserUpload(path: string) {
  return unexpected('browserUpload:' + path);
}

const json = (value: object, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function courseworkResponse(request: (typeof ledger.requests)[number]): Response {
  const { path, method, body, session } = request;
  const action = path.slice(path.lastIndexOf('/') + 1);
  if (
    !/^\/api\/nuni\/assistant\/(ask|plan|confirm|reconcile|followup)$/.test(path) ||
    method !== 'POST' ||
    !body ||
    body.schoolId !== 'pu' ||
    session !== courseworkContext ||
    state.owner !== 'qa-alpha' ||
    state.schoolId !== 'pu' ||
    state.guest
  )
    return unexpected('unscoped-coursework:' + path);
  if (action === 'ask' || action === 'plan') {
    const chat = action === 'ask';
    const conversationId = chat ? courseworkConversation : 'qa-home-unsent-conversation';
    const routeToken = chat ? 'qa-chat-coursework-route' : 'qa-home-unsent-route';
    if (
      chat
        ? body.question !== '幫我規劃資料模型的準備時間' ||
          body.consent !== true ||
          !same(body.history, [])
        : !same(body.task, {
            workspaceId: courseworkTask.courseId,
            taskId: courseworkTask.id,
            kind: courseworkTask.kind,
          })
    )
      return unexpected('unbound-coursework-preview:' + action);
    if (!body.routeToken) {
      request.outcome = 'bootstrap';
      return json({ bootstrap: true, conversationId, routeToken });
    }
    if (body.routeToken !== routeToken || body.conversationId !== conversationId)
      return unexpected('coursework-preview-owner-changed:' + action);
    request.outcome = 'preview-only';
    return json({
      version: 2,
      dataRead: true,
      modelCalls: 0,
      simulation: false,
      expiresAt: Date.now() + 300_000,
      stopReason: '',
      answer: '合成課業安排：已核對來源與時間，確認後才新增一筆行程。',
      steps: [
        { name: 'get_course_work', status: 'ok', summary: '合成來源：資料模型作業與準備時間' },
      ],
      cards: [chat ? courseworkCard : homeCard],
    });
  }
  const allowedKeys = [
    'schoolId',
    'conversationId',
    'token',
    'args',
    ...(action === 'followup' ? ['issuedContext'] : []),
  ];
  if (
    !same(Object.keys(body).sort(), allowedKeys.sort()) ||
    body.conversationId !== courseworkConversation ||
    body.token !== courseworkCard.token ||
    !same(body.args, courseworkCard.args)
  )
    return unexpected('coursework-original-proof-changed:' + action);
  if (action === 'confirm') {
    courseworkServer.journalAtConfirm = readAssistantExecutionJournal(courseworkJournalScope);
    const saved = courseworkServer.journalAtConfirm;
    if (
      saved.length !== 1 ||
      saved[0].conversationId !== courseworkConversation ||
      saved[0].card.mutationId !== courseworkCard.mutationId ||
      saved[0].card.token !== courseworkCard.token ||
      saved[0].card.coursework !== true ||
      !same(saved[0].card.args, courseworkCard.args)
    )
      return unexpected('coursework-confirm-without-durable-journal');
    if (courseworkServer.records.length) return unexpected('duplicate-coursework-confirm');
    const record: RecordRow = {
      ...courseworkCard.args,
      id: courseworkCard.mutationId,
      batchId: courseworkCard.mutationId,
      kind: 'events',
      schoolId: 'pu',
      academicYear: '',
      semester: '',
      importedAt: '2026-11-24T00:30:00.000Z',
      source: { type: 'paste', name: '合成助理確認', line: 1, rawText: '' },
    };
    courseworkServer.records.push(record);
    courseworkServer.writes.push(record);
  }
  const record = courseworkServer.records.find((row) => row.id === courseworkCard.mutationId);
  if (!record || !same(record, courseworkServer.writes[0]))
    return unexpected('coursework-read-without-confirmed-record');
  if (action === 'followup') {
    if (body.issuedContext !== courseworkContext)
      return unexpected('coursework-issued-context-changed');
    const proofs = readTodayAgentFollowups(courseworkScope);
    const proof = proofs.find((row) => row.card.mutationId === courseworkCard.mutationId);
    if (proof) {
      if (
        proofs.length !== 1 ||
        proof.issuedContext !== courseworkContext ||
        proof.conversationId !== courseworkConversation ||
        proof.card.token !== courseworkCard.token ||
        !same(proof.card.args, courseworkCard.args)
      )
        return unexpected('coursework-durable-proof-changed');
      request.proofPhase = 'durable';
    } else {
      const journal = readAssistantExecutionJournal(courseworkJournalScope);
      if (
        proofs.length ||
        journal.length !== 1 ||
        journal[0].conversationId !== courseworkConversation ||
        journal[0].card.token !== courseworkCard.token ||
        !same(journal[0].card.args, courseworkCard.args)
      )
        return unexpected('coursework-classification-without-recovery-proof');
      request.proofPhase = 'journal';
    }
    if (courseworkServer.followupFailure) {
      request.outcome = 'synthetic-read-failed';
      return json({ error: 'QA_READ_UNAVAILABLE', message: '合成來源暫時無法讀取。' }, 503);
    }
    const result: AssistantCourseworkFollowup = {
      version: 1,
      operation: 'coursework.followup',
      schoolId: 'pu',
      mutationId: courseworkCard.mutationId,
      checkedAt: '2026-11-24T00:30:00.000Z',
      status: 'scheduled',
      calendar: 'matching',
      event: { ...courseworkCard.args },
      task: {
        workspaceId: courseworkTask.courseId,
        taskId: courseworkTask.id,
        kind: courseworkTask.kind,
      },
      source: {
        title: courseworkTask.title,
        courseName: courseworkTask.courseName,
        dueAt: courseworkTask.dueAt,
        state: 'open',
        submitted: false,
      },
    };
    request.outcome = result.status;
    return json(result);
  }
  courseworkServer.readbacks += 1;
  request.outcome = 'readback-verified';
  return json(
    createAssistantCalendarReceipt({
      schoolId: 'pu',
      mutationId: courseworkCard.mutationId,
      event: courseworkCard.args,
      storage: 'synced',
      revision: 1,
      verifiedAt: '2026-11-24T00:30:00.000Z',
      replay: action === 'reconcile',
      record,
    }),
  );
}
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = init?.method || (input instanceof Request ? input.method : 'GET');
  const body =
    typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  const request = {
    path: url.pathname,
    method,
    body,
    session: new Headers(init?.headers).get('X-Campus-Session'),
  };
  ledger.requests.push(request);
  if (url.origin !== location.origin) return unexpected('external-fetch:' + url.origin);
  if (url.pathname === '/api/nuni/assistant/capability' && method === 'GET')
    return json({
      enabled: true,
      ready: state.cloudReady,
      version: 2,
      planning: true,
      fallback: false,
    });
  if (courseworkScenario) return courseworkResponse(request);
  if (url.pathname === '/api/nuni/assistant/ask' && method === 'POST') {
    if (
      !body ||
      typeof body.question !== 'string' ||
      body.consent !== true ||
      state.guest ||
      !state.cloudReady
    )
      return unexpected('unconsented-or-unavailable-ask');
    // The reply is explicitly synthetic; there are no actionable write cards.
    return json({
      answer: `合成回覆：已為 ${state.owner} 整理「${body.question}」。`,
      steps: [],
      cards: [],
    });
  }
  return unexpected(method + ':' + url.pathname);
};
Object.assign(window, {
  __aiWorkspaceQA: {
    snapshot: () => ({
      state,
      ...ledger,
      ...(courseworkScenario
        ? {
            coursework: {
              scenario: courseworkScenario,
              ...courseworkServer,
              imports: readPersonalImports(courseworkScope),
              proofs: readTodayAgentFollowups(courseworkScope),
              journal: readAssistantExecutionJournal(courseworkJournalScope),
              otherAccountProofs: readTodayAgentFollowups({
                ...courseworkScope,
                owner: 'platform:qa-beta',
              }),
              otherSchoolProofs: readTodayAgentFollowups({ ...courseworkScope, schoolId: 'ntu' }),
              nativeLocks: typeof navigator.locks?.request === 'function',
            },
          }
        : {}),
    }),
    navigate,
    switchAccount,
    selectCampus,
    setGuest,
    setChecking,
    setCloudReady,
    setFollowupFailure: (failed: boolean) => {
      if (!courseworkScenario) return unexpected('coursework-controls-outside-scenario');
      courseworkServer.followupFailure = failed;
    },
  },
});
