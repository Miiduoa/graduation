import { createRoot } from 'react-dom/client';
import { Assistant } from '../../../apps/web/src/features/nuni/Assistant';
import '../../../apps/web/src/app/globals.css';

// This is an isolated browser fixture, never a backend/model or a real account.
// Real Assistant, cards, journal, receipt parser and local mirroring remain bundled.
const DATE = '2026-11-12';
const INSTANT = '2026-11-09T12:00:00.000Z';
const DRAFT_PREFIX = 'campus.assistant-plan-draft.v1:';
const BACKEND_KEY = 'qa.assistant-backend.v1';
const persistentBackend = new URLSearchParams(location.search).get('draft-reload') === '1';
const nativeStorage = {
  getItem: Storage.prototype.getItem,
  setItem: Storage.prototype.setItem,
  removeItem: Storage.prototype.removeItem,
};
type FixtureEvent = { title: string; date: string; allDay: boolean; endDate?: string; startTime?: string; endTime?: string };
const original: FixtureEvent[] = [
  { title: '測試微積分複習', date: DATE, allDay: false, startTime: '19:00', endTime: '19:30' },
  { title: '測試英文閱讀', date: DATE, allDay: false, startTime: '20:00', endTime: '20:30' },
];
type Card = { tool: string; args: FixtureEvent; token: string; mutationId: string; schoolId: string; destination: string };
type RequestRow = { sequence: number; action: string; account: string; body: Record<string, any>; outcome?: string };
type FixtureScope = { account: string; school: string; context: string };
type PlanFixture = { originalEvents: FixtureEvent[]; revisedEvents: FixtureEvent[] | null };
type Preview = { ask: number; account: string; cards: Card[] };
type Write = { mutationId: string; record: Record<string, unknown> };
const defaultFaults = {
  revisionAsk: 'none', unknownCancellation: false, holdAsk: false, holdCancel: false,
  holdConfirmAfterWrite: false, draftGetDenied: false, draftSetDenied: false, draftRemoveDenied: false,
  journalGetDenied: false,
};
type SavedBackend = {
  version: 1; pageEpoch: number; askCount: number; school: string; account: string;
  cards: [string, Card][]; cardAccounts: [string, string][]; revoked: string[];
  records: [string, Record<string, unknown>][]; requests: RequestRow[]; previews: Preview[]; writes: Write[];
  faults: typeof defaultFaults; planFixture: PlanFixture; draftKeys: [string, FixtureScope][];
};
const savedRaw = persistentBackend ? nativeStorage.getItem.call(sessionStorage, BACKEND_KEY) : null;
const saved: SavedBackend | null = savedRaw === null ? null : JSON.parse(savedRaw);
if (saved && (saved.version !== 1 || !Number.isSafeInteger(saved.pageEpoch) || !Number.isSafeInteger(saved.askCount) ||
  !['qa-agent', 'qa-agent-b'].includes(saved.account) || !['fixture-campus-a', 'fixture-campus-b'].includes(saved.school)))
  throw new Error('Invalid QA fake-backend snapshot');
const pageEpoch = persistentBackend ? (saved?.pageEpoch ?? 0) + 1 : 0;
const cards = new Map<string, Card>(saved?.cards);
const cardAccounts = new Map<string, string>(saved?.cardAccounts);
const revoked = new Set<string>(saved?.revoked);
const records = new Map<string, Record<string, unknown>>(saved?.records);
const requests: RequestRow[] = saved?.requests ?? [];
const previews: Preview[] = saved?.previews ?? [];
const writes: Write[] = saved?.writes ?? [];
// Only product keys actually observed in this fixture are eligible for QA inspection/mutation.
const draftKeys = new Map<string, FixtureScope>(saved?.draftKeys);
let askCount = saved?.askCount ?? 0;
let pageAskCount = 0;
let release: (() => void) | undefined;
const faults = { ...defaultFaults, ...saved?.faults };
const planFixture: PlanFixture = saved?.planFixture ?? { originalEvents: original, revisedEvents: null };
const qa = {
  pageEpoch, persistentBackend, backendKey: persistentBackend ? BACKEND_KEY : null,
  school: saved?.school ?? 'fixture-campus-a',
  account: saved?.account ?? 'qa-agent',
  requests, writes,
  snapshot: () => ({
    school: qa.school, account: qa.account, requests, writes, revoked: [...revoked],
    records: [...records.values()], previews, waiting: !!release,
    pageEpoch, pageAskCount, persistentBackend, backendKey: persistentBackend ? BACKEND_KEY : null,
    backendPurpose: 'QA-only fake backend and fake tokens; this is not product draft storage.',
  }),
  configure: (value: Partial<typeof faults>) => { Object.assign(faults, value); persistBackend(); },
  // Fixed response data only; changing this does not run the model or write a calendar.
  configurePlan: (value: Partial<PlanFixture>) => { Object.assign(planFixture, structuredClone(value)); persistBackend(); },
  release: () => { const resume = release; release = undefined; resume?.(); },
  inspectDrafts: () => [...draftKeys].map(([key, fixtureScope]) => ({
    key, value: nativeStorage.getItem.call(sessionStorage, key), fixtureScope,
  })).filter(entry => entry.value !== null),
  mutateDraft: (mode: 'expired' | 'corrupt') => {
    if (mode !== 'expired' && mode !== 'corrupt') throw new Error('Unknown draft mutation');
    const scope = currentFixtureScope();
    const matches = [...draftKeys].filter(([, binding]) => sameScope(binding, scope))
      .map(([key]) => ({ key, before: nativeStorage.getItem.call(sessionStorage, key) }))
      .filter((entry): entry is { key: string; before: string } => entry.before !== null);
    if (matches.length !== 1) throw new Error('Expected one existing product draft in the current fixture scope');
    const { key, before } = matches[0];
    const after = mode === 'corrupt' ? '{qa-corrupt-draft' : JSON.stringify({
      ...JSON.parse(before), savedAt: Date.now() - 31 * 60 * 1000,
    });
    nativeStorage.setItem.call(sessionStorage, key, after);
    return { key, mode, before, after };
  },
  switchAccount: (account: string) => {
    if (!['qa-agent', 'qa-agent-b'].includes(account)) throw new Error('Unknown fixture account');
    qa.account = account;
    persistBackend();
    window.dispatchEvent(new Event('qa-account'));
  },
  switchSchool: (school: string) => {
    if (!['fixture-campus-a', 'fixture-campus-b'].includes(school)) throw new Error('Unknown fixture school');
    qa.school = school;
    persistBackend();
    window.dispatchEvent(new Event('qa-school'));
  },
};
function persistBackend() {
  if (!persistentBackend) return;
  const value: SavedBackend = {
    version: 1, pageEpoch, askCount, school: qa.school, account: qa.account,
    cards: [...cards], cardAccounts: [...cardAccounts], revoked: [...revoked], records: [...records],
    requests, previews, writes, faults, planFixture, draftKeys: [...draftKeys],
  };
  nativeStorage.setItem.call(sessionStorage, BACKEND_KEY, JSON.stringify(value));
}
function currentFixtureScope(): FixtureScope {
  return { account: qa.account, school: qa.school, context: (qa.account === 'qa-agent' ? 'a' : 'b').repeat(43) };
}
function sameScope(left: FixtureScope, right: FixtureScope) {
  return left.account === right.account && left.school === right.school && left.context === right.context;
}
function observeDraftKey(storage: Storage, key: string) {
  if (storage !== sessionStorage || draftKeys.has(key)) return;
  // Never rebind an old key during a late cleanup after an account/school switch.
  draftKeys.set(key, currentFixtureScope());
  persistBackend();
}
// Draft faults apply only to product draft operations. Journal read denial is
// a separate controlled case; QA backend persistence always uses native methods.
Storage.prototype.getItem = function(key: string) {
  if (typeof key === 'string' && key.startsWith('campus.assistant-execution.v1:') && faults.journalGetDenied)
    throw new DOMException('Controlled fixture journal read denied', 'SecurityError');
  if (typeof key === 'string' && key.startsWith(DRAFT_PREFIX)) {
    observeDraftKey(this, key);
    if (faults.draftGetDenied) throw new DOMException('Controlled fixture draft read denied', 'SecurityError');
  }
  return nativeStorage.getItem.call(this, key);
};
Storage.prototype.setItem = function(key: string, value: string) {
  if (typeof key === 'string' && key.startsWith(DRAFT_PREFIX)) {
    observeDraftKey(this, key);
    if (faults.draftSetDenied) throw new DOMException('Controlled fixture draft write denied', 'QuotaExceededError');
  }
  return nativeStorage.setItem.call(this, key, value);
};
Storage.prototype.removeItem = function(key: string) {
  if (typeof key === 'string' && key.startsWith(DRAFT_PREFIX)) {
    observeDraftKey(this, key);
    if (faults.draftRemoveDenied) throw new DOMException('Controlled fixture draft removal denied', 'SecurityError');
  }
  return nativeStorage.removeItem.call(this, key);
};
persistBackend();
(window as any).__agentQA = qa;
async function hold() { await new Promise<void>((resolve) => { release = resolve; }); }
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function scope(card: Card) {
  return { version: 1, operation: 'calendar.create', schoolId: card.schoolId, mutationId: card.mutationId, storage: 'synced' };
}
function revokedResult(card: Card) {
  return { ...scope(card), status: 'revoked', checkedAt: INSTANT, revision: writes.length,
    authorizationValid: false, retryable: false, alreadyRevoked: true };
}
function verifiedResult(card: Card, replay: boolean) {
  return { ...scope(card), status: 'verified', verifiedAt: INSTANT, revision: writes.length, replay, record: records.get(card.mutationId) };
}
function sameEventContent(left: FixtureEvent, right: unknown) {
  if (!right || typeof right !== 'object' || Array.isArray(right)) return false;
  const other = right as Record<string, unknown>, keys = Object.keys(left);
  return keys.length === Object.keys(other).length &&
    keys.every(key => Object.hasOwn(other, key) && other[key] === left[key as keyof FixtureEvent]);
}
function preview(schoolId: string, revised: boolean, account: string, requestAsk: number) {
  const events = revised ? planFixture.revisedEvents || planFixture.originalEvents.map((event, index) =>
    index === 1 ? { ...event, startTime: '21:00', endTime: '21:30' } : event) : planFixture.originalEvents;
  const next = events.map((event, index) => {
    const mutationId = persistentBackend
      ? 'qa-page-' + pageEpoch + '-ask-' + requestAsk + '-' + (revised ? 'revised' : 'original') + '-' + (index + 1)
      : 'qa-' + (revised ? 'revised-' + requestAsk : 'original') + '-' + (index + 1);
    const card: Card = { tool: 'propose_personal_event', schoolId, mutationId,
      token: 'fixture-token-' + mutationId, destination: '/calendar', args: { ...event } };
    cards.set(card.token, card);
    cardAccounts.set(card.token, account);
    return card;
  });
  previews.push({ ask: requestAsk, account, cards: next });
  persistBackend();
  return { answer: revised ? '已重新預覽測試安排；請逐筆確認。' : '這是尚未寫入的測試安排。',
    steps: [], cards: next, simulation: true };
}
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  const match = /^\/api\/nuni\/assistant\/(capability|ask|cancel|reconcile|confirm)$/.exec(url.pathname);
  if (url.origin !== location.origin || !match) throw new Error('Fixture rejects network: ' + url.origin + url.pathname);
  const action = match[1];
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const context = new Headers(init?.headers).get('X-Campus-Session');
  const account = context === 'a'.repeat(43) ? 'qa-agent' : context === 'b'.repeat(43) ? 'qa-agent-b' : '';
  const row: RequestRow = { sequence: requests.length + 1, action, account, body };
  requests.push(row);
  persistBackend(); // Dispatch survives reload even if no response is delivered.
  const finish = (value: unknown, status = 200) => { row.outcome = String(status); persistBackend(); return response(value, status); };
  if (!account) return finish({ message: 'Invalid fixture account' }, 400);
  if (action === 'capability') return finish({ version: 2, enabled: true, ready: true, fallback: false });
  if (!['fixture-campus-a', 'fixture-campus-b'].includes(body.schoolId)) return finish({ message: 'Invalid fixture school' }, 400);
  if (action === 'ask') {
    askCount += 1;
    pageAskCount += 1;
    const requestAsk = askCount;
    const revised = persistentBackend ? pageAskCount > 1 : askCount > 1;
    persistBackend();
    if (revised && faults.holdAsk) { faults.holdAsk = false; persistBackend(); await hold(); }
    if (revised && faults.revisionAsk !== 'none') {
      const fault = faults.revisionAsk;
      faults.revisionAsk = 'none';
      persistBackend();
      if (fault === 'malformed') {
        const result = preview(body.schoolId, true, account, requestAsk);
        delete result.cards[1].args.startTime;
        persistBackend();
        return finish(result);
      }
      return fault === 'empty' ? finish({ answer: '受控空預覽', steps: [], cards: [] }) : finish({ message: '受控重新預覽失敗' }, 503);
    }
    return finish(preview(body.schoolId, revised, account, requestAsk));
  }
  const card = cards.get(body.token);
  if (!card || cardAccounts.get(body.token) !== account || card.schoolId !== body.schoolId ||
    !(persistentBackend ? sameEventContent(card.args, body.args) : JSON.stringify(card.args) === JSON.stringify(body.args)))
    return finish({ message: 'Fixture card mismatch' }, 409);
  if (action === 'cancel') {
    if (faults.holdCancel) { faults.holdCancel = false; persistBackend(); await hold(); }
    if (records.has(card.mutationId)) return finish(verifiedResult(card, true));
    revoked.add(card.mutationId);
    persistBackend();
    if (faults.unknownCancellation) {
      row.outcome = 'controlled-network-error'; persistBackend();
      throw new TypeError('Controlled lost cancellation response');
    }
    return finish(revokedResult(card));
  }
  if (action === 'reconcile') {
    if (faults.unknownCancellation) {
      row.outcome = 'controlled-network-error'; persistBackend();
      throw new TypeError('Controlled unavailable reconciliation');
    }
    if (records.has(card.mutationId)) return finish(verifiedResult(card, true));
    if (revoked.has(card.mutationId)) return finish(revokedResult(card));
    return finish({ ...scope(card), status: 'absent', checkedAt: INSTANT, revision: writes.length, authorizationValid: true, retryable: true });
  }
  if (revoked.has(card.mutationId)) return finish({ message: 'This fixture proposal was revoked' }, 409);
  const replay = records.has(card.mutationId);
  if (!replay) {
    const record = { ...card.args, id: card.mutationId, kind: 'events', schoolId: card.schoolId,
      academicYear: '', semester: '', batchId: card.mutationId, importedAt: INSTANT,
      source: { type: 'paste', line: 1, rawText: '' } };
    records.set(card.mutationId, record);
    writes.push({ mutationId: card.mutationId, record });
    persistBackend();
    if (faults.holdConfirmAfterWrite) {
      faults.holdConfirmAfterWrite = false;
      persistBackend();
      await hold();
    }
  }
  return finish(verifiedResult(card, replay));
};
createRoot(document.getElementById('root')!).render(<>
  <aside className="fixture-banner" aria-label="瀏覽器驗證 fixture">
    <p>固定假帳號、假校園與假 API；真實助理元件。沒有連線模型、校務系統或正式行事曆。</p>
    {persistentBackend && <p>重新載入測試將假後端與假 token 存在獨立 QA key；這不是產品草稿，產品草稿不得包含 token。</p>}
    <label>QA 帳號 <select defaultValue={qa.account} onChange={(event) => qa.switchAccount(event.target.value)}>
      <option value="qa-agent">測試帳號 A</option><option value="qa-agent-b">測試帳號 B</option>
    </select></label>
    <label>QA 校園 <select defaultValue={qa.school} onChange={(event) => qa.switchSchool(event.target.value)}>
      <option value="fixture-campus-a">測試校園 A</option><option value="fixture-campus-b">測試校園 B</option>
    </select></label>
  </aside>
  <Assistant />
</>);
