import { createRoot } from 'react-dom/client';
import { Assistant } from '../../../apps/web/src/features/nuni/Assistant';
import '../../../apps/web/src/app/globals.css';

// This is an isolated browser fixture, never a backend/model or a real account.
// Real Assistant, cards, journal, receipt parser and local mirroring remain bundled.
const DATE = '2026-11-12';
const INSTANT = '2026-11-09T12:00:00.000Z';
type FixtureEvent = { title: string; date: string; allDay: boolean; endDate?: string; startTime?: string; endTime?: string };
const original: FixtureEvent[] = [
  { title: '測試微積分複習', date: DATE, allDay: false, startTime: '19:00', endTime: '19:30' },
  { title: '測試英文閱讀', date: DATE, allDay: false, startTime: '20:00', endTime: '20:30' },
];
type Card = { tool: string; args: FixtureEvent; token: string; mutationId: string; schoolId: string; destination: string };
type RequestRow = { sequence: number; action: string; account: string; body: Record<string, any>; outcome?: string };
const cards = new Map<string, Card>();
const cardAccounts = new Map<string, string>();
const revoked = new Set<string>();
const records = new Map<string, Record<string, unknown>>();
const requests: RequestRow[] = [];
const previews: { ask: number; account: string; cards: Card[] }[] = [];
const writes: { mutationId: string; record: Record<string, unknown> }[] = [];
let askCount = 0;
let release: (() => void) | undefined;
const faults = { revisionAsk: 'none', unknownCancellation: false, holdAsk: false, holdCancel: false };
const planFixture: { originalEvents: FixtureEvent[]; revisedEvents: FixtureEvent[] | null } = { originalEvents: original, revisedEvents: null };
const qa = {
  school: 'fixture-campus-a',
  account: 'qa-agent',
  requests, writes,
  snapshot: () => ({ school: qa.school, account: qa.account, requests, writes, revoked: [...revoked], records: [...records.values()], previews, waiting: !!release }),
  configure: (value: Partial<typeof faults>) => Object.assign(faults, value),
  // Fixed response data only; changing this does not run the model or write a calendar.
  configurePlan: (value: Partial<typeof planFixture>) => Object.assign(planFixture, structuredClone(value)),
  release: () => { const resume = release; release = undefined; resume?.(); },
  switchAccount: (account: string) => {
    if (!['qa-agent', 'qa-agent-b'].includes(account)) throw new Error('Unknown fixture account');
    qa.account = account;
    window.dispatchEvent(new Event('qa-account'));
  },
  switchSchool: (school: string) => {
    if (!['fixture-campus-a', 'fixture-campus-b'].includes(school)) throw new Error('Unknown fixture school');
    qa.school = school;
    window.dispatchEvent(new Event('qa-school'));
  },
};
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
function preview(schoolId: string, revised: boolean, account: string) {
  const events = revised ? planFixture.revisedEvents || planFixture.originalEvents.map((event, index) =>
    index === 1 ? { ...event, startTime: '21:00', endTime: '21:30' } : event) : planFixture.originalEvents;
  const next = events.map((event, index) => {
    const mutationId = `qa-${revised ? `revised-${askCount}` : 'original'}-${index + 1}`;
    const card: Card = { tool: 'propose_personal_event', schoolId, mutationId,
      token: `fixture-token-${mutationId}`, destination: '/calendar',
      args: { ...event } };
    cards.set(card.token, card);
    cardAccounts.set(card.token, account);
    return card;
  });
  previews.push({ ask: askCount, account, cards: next });
  return { answer: revised ? '已重新預覽測試安排；請逐筆確認。' : '這是尚未寫入的測試安排。',
    steps: [], cards: next, simulation: true };
}
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  const match = /^\/api\/nuni\/assistant\/(capability|ask|cancel|reconcile|confirm)$/.exec(url.pathname);
  if (url.origin !== location.origin || !match) throw new Error(`Fixture rejects network: ${url.origin}${url.pathname}`);
  const action = match[1];
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const context = new Headers(init?.headers).get('X-Campus-Session');
  const account = context === 'a'.repeat(43) ? 'qa-agent' : context === 'b'.repeat(43) ? 'qa-agent-b' : '';
  const row: RequestRow = { sequence: requests.length + 1, action, account, body };
  requests.push(row);
  const finish = (value: unknown, status = 200) => { row.outcome = String(status); return response(value, status); };
  if (!account) return finish({ message: 'Invalid fixture account' }, 400);
  if (action === 'capability') return finish({ version: 2, enabled: true, ready: true, fallback: false });
  if (!['fixture-campus-a', 'fixture-campus-b'].includes(body.schoolId)) return finish({ message: 'Invalid fixture school' }, 400);
  if (action === 'ask') {
    askCount += 1;
    const revised = askCount > 1;
    if (revised && faults.holdAsk) { faults.holdAsk = false; await hold(); }
    if (revised && faults.revisionAsk !== 'none') {
      const fault = faults.revisionAsk;
      faults.revisionAsk = 'none';
      if (fault === 'malformed') {
        const result = preview(body.schoolId, true, account);
        delete result.cards[1].args.startTime;
        return finish(result);
      }
      return fault === 'empty' ? finish({ answer: '受控空預覽', steps: [], cards: [] }) : finish({ message: '受控重新預覽失敗' }, 503);
    }
    return finish(preview(body.schoolId, revised, account));
  }
  const card = cards.get(body.token);
  if (!card || cardAccounts.get(body.token) !== account || card.schoolId !== body.schoolId || JSON.stringify(card.args) !== JSON.stringify(body.args))
    return finish({ message: 'Fixture card mismatch' }, 409);
  if (action === 'cancel') {
    if (faults.holdCancel) { faults.holdCancel = false; await hold(); }
    if (records.has(card.mutationId)) return finish(verifiedResult(card, true));
    revoked.add(card.mutationId);
    if (faults.unknownCancellation) { row.outcome = 'controlled-network-error'; throw new TypeError('Controlled lost cancellation response'); }
    return finish(revokedResult(card));
  }
  if (action === 'reconcile') {
    if (faults.unknownCancellation) { row.outcome = 'controlled-network-error'; throw new TypeError('Controlled unavailable reconciliation'); }
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
  }
  return finish(verifiedResult(card, replay));
};
createRoot(document.getElementById('root')!).render(<>
  <aside className="fixture-banner" aria-label="瀏覽器驗證 fixture">
    <p>固定假帳號、假校園與假 API；真實助理元件。沒有連線模型、校務系統或正式行事曆。</p>
    <label>QA 帳號 <select defaultValue={qa.account} onChange={(event) => qa.switchAccount(event.target.value)}>
      <option value="qa-agent">測試帳號 A</option><option value="qa-agent-b">測試帳號 B</option>
    </select></label>
    <label>QA 校園 <select defaultValue={qa.school} onChange={(event) => qa.switchSchool(event.target.value)}>
      <option value="fixture-campus-a">測試校園 A</option><option value="fixture-campus-b">測試校園 B</option>
    </select></label>
  </aside>
  <Assistant />
</>);
