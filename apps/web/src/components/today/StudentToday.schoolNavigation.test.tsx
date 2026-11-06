import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanCourse, cleanMeta } from '@campus/shared';
import { TODAY_COPY } from '@campus/shared/src/pickNextAction';
import { CampusProviders } from '@/components/CampusProviders';
import { schoolPreferenceKey, useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { StudentTodayPage } from '@/components/today/StudentToday';
import { useNuniSession } from '@/features/nuni/Session';
import { usePersonalImportScope } from '@/lib/usePersonalImports';
import { savePersonalImportBatch } from '@/lib/personalImports';
import { savePersonalTimetable } from '@/lib/timetable/store';

const state = vi.hoisted(() => ({
  search: 'campus=ntu',
  pathname: '/',
  session: { authenticated: false } as Record<string, unknown>,
  unexpected: [] as string[],
  auth: { user: null, loading: false, error: null },
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => state.auth }));
vi.mock('@/components/imports/PersonalImportSync', () => ({
  PersonalImportSyncBridge: () => null,
}));
vi.mock('@/components/today/TodayUnreadNotifications', () => ({
  TodayUnreadNotifications: () => null,
}));
vi.mock('@/lib/firebase', () => ({
  isFirebaseConfigured: () => false,
  getAuth: () => null,
  getDb: () => {
    throw new Error('No real Firestore allowed');
  },
  getFunctionsInstance: () => {
    throw new Error('No real callable allowed');
  },
  getCloudFunctionUrl: () => {
    throw new Error('No real callable allowed');
  },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({
    replace: (href: string) => {
      const next = new URL(href, 'https://fixture.invalid');
      state.pathname = next.pathname;
      state.search = next.search.slice(1);
    },
  }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const ACCOUNT = 'pa_11111111-1111-4111-8111-111111111111';
const now = new Date('2026-11-02T00:00:00Z');
const TITLE = '合成個人課程';
const catalog = [
  { id: 'pu', name: '合成校園 PU' },
  { id: 'ntu', name: '合成校園 NTU' },
  { id: 'ncku', name: '合成校園 NCKU' },
];

function Bound() {
  const session = useNuniSession();
  const school = useSelectedSchool();
  const scope = usePersonalImportScope();
  return (
    <>
      <output data-testid="scope">
        {scope.loading ? 'loading' : `${scope.scope.owner}|${school.selectedSchoolId}`}
      </output>
      <StudentTodayPage
        now={now}
        updatedAt={null}
        signedIn={!!session.session}
        unsigned={!session.session}
        skeleton={false}
        todos={[]}
        todosError=""
        lmsUnconnected={!!session.session}
        onRetryTodos={() => {}}
      />
    </>
  );
}
function App() {
  return (
    <CampusProviders>
      <Bound />
    </CampusProviders>
  );
}

beforeEach(() => {
  Object.assign(state, {
    search: 'campus=ntu',
    pathname: '/',
    session: { authenticated: false },
    unexpected: [],
    auth: { user: null, loading: false, error: null },
  });
  window.scrollTo = vi.fn();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: (_key: string, action: () => unknown) => Promise.resolve().then(action) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (method === 'GET' && init?.body === undefined && url === '/api/schools')
        return new Response(JSON.stringify({ schools: catalog }), { status: 200 });
      if (method === 'GET' && init?.body === undefined && url === '/api/nuni/session') {
        return new Response(JSON.stringify(state.session), { status: 200 });
      }
      state.unexpected.push(`${method} ${url}`);
      throw new Error('Only synthetic catalog/session GET is allowed');
    }),
  );
});
afterEach(() => {
  expect(state.unexpected).toEqual([]);
  vi.unstubAllGlobals();
});

function prepare(identity: 'guest' | 'platform') {
  if (identity === 'platform')
    state.session = {
      authenticated: true,
      platformAccountId: ACCOUNT,
      isPlatformOperator: false,
      context: 'a'.repeat(43),
    };
  const owner = identity === 'platform' ? `platform:${ACCOUNT}` : 'guest';
  localStorage.setItem(
    schoolPreferenceKey(identity === 'platform' ? `|${ACCOUNT}` : null),
    JSON.stringify({ schoolId: 'pu' }),
  );
  return owner;
}
async function seedManual(owner: string, title = TITLE) {
  return savePersonalTimetable(
    null,
    {
      schoolId: 'ncku',
      updatedAt: now.toISOString(),
      shareWithFriends: false,
      meta: cleanMeta({ year: '115', semester: '1' }),
      courses: [
        cleanCourse({
          id: 'synthetic-ncku',
          name: title,
          day: 1,
          start: 3,
          end: 4,
          room: '合成教室 301',
        }),
      ],
    },
    owner,
  );
}
async function seedImport(owner: string, linkedCourseId?: string, title = TITLE) {
  return savePersonalImportBatch({ owner, schoolId: 'ntu' }, [
    {
      id: 'synthetic-import-row',
      kind: 'timetable',
      title,
      schoolId: 'ntu',
      academicYear: '115',
      semester: '1',
      dayOfWeek: 1,
      startTime: '09:00',
      endTime: '10:00',
      location: '合成教室 301',
      ...(linkedCourseId ? { linkedCourseId } : {}),
      source: { type: 'paste', line: 1, rawText: 'synthetic fixture' },
    },
  ]);
}
async function links(owner: string, schoolId = 'ntu', title = TITLE) {
  await waitFor(() => expect(screen.getByTestId('scope').textContent).toBe(`${owner}|${schoolId}`));
  const hero = await screen.findByTestId('next-action');
  await waitFor(() => expect(hero.textContent).toContain(title));
  const heroHref = within(hero).getByRole('link').getAttribute('href');
  const listHref = within(screen.getByTestId('today-classes'))
    .getByRole('link', { name: new RegExp(title) })
    .getAttribute('href');
  return { heroHref, listHref };
}

function expectActionLabel(fallback: boolean) {
  const hero = within(screen.getByTestId('next-action'));
  expect(
    hero.getByRole('link', {
      name: fallback ? TODAY_COPY.viewWeek : TODAY_COPY.viewCourse,
    }),
  ).toBeTruthy();
  expect(
    hero.queryByRole('link', {
      name: fallback ? TODAY_COPY.viewCourse : TODAY_COPY.viewWeek,
    }),
  ).toBeNull();
}

it.each([
  ['guest', 'imported', 'ntu'],
  ['platform', 'imported', 'ntu'],
  ['guest', 'manual', 'ncku'],
  ['platform', 'manual', 'ncku'],
] as const)(
  'keeps explicit scope on both unlinked home entries: %s %s %s with saved PU',
  async (identity, source, schoolId) => {
    const owner = prepare(identity);
    state.search = `campus=${schoolId}`;
    if (source === 'manual') await seedManual(owner);
    else await seedImport(owner);
    const view = render(<App />);
    const found = await links(owner, schoolId);
    expectActionLabel(true);
    const firstHref = found.heroHref!;
    const destination = new URL(firstHref, 'https://fixture.invalid');
    state.pathname = destination.pathname;
    state.search = destination.search.slice(1);
    view.rerender(<App />);
    await waitFor(() => expect(screen.getByTestId('scope').textContent).not.toBe('loading'));
    const afterScope = screen.getByTestId('scope').textContent;
    const expected = `/timetable?campus=${schoolId}`;
    expect(found.heroHref).toBe(expected);
    expect(found.listHref).toBe(expected);
    expect(afterScope).toBe(`${owner}|${schoolId}`);
  },
);

it.each([
  ['school', 'cs-db', '/course/cs-db#week'],
  [
    'nuni',
    'cw_12345678-1234-1234-1234-123456789abc',
    '/classroom/course/cw_12345678-1234-1234-1234-123456789abc#week',
  ],
])(
  'preserves explicit %s course destination on hero and list',
  async (_kind, linkedCourseId, expectedHref) => {
    const owner = prepare('platform');
    await seedImport(owner, linkedCourseId);
    render(<App />);
    const found = await links(owner);
    expectActionLabel(false);
    expect(found.heroHref).toBe(expectedHref);
    expect(found.listHref).toBe(expectedHref);
  },
);

it('uses the current campus when an imported course reference is invalid', async () => {
  const owner = prepare('platform');
  await seedImport(owner, '../../another-campus');
  render(<App />);
  const found = await links(owner);
  expectActionLabel(true);
  expect(found.heroHref).toBe('/timetable?campus=ntu');
  expect(found.listHref).toBe('/timetable?campus=ntu');
});

it('keeps each campus course and fallback isolated through NTU–NCKU–NTU navigation', async () => {
  const owner = prepare('guest');
  await seedImport(owner, undefined, '台大合成課程');
  await seedManual(owner, '成大合成課程');
  const view = render(<App />);
  expect((await links(owner, 'ntu', '台大合成課程')).listHref).toBe('/timetable?campus=ntu');

  state.search = 'campus=ncku';
  view.rerender(<App />);
  const ncku = await links(owner, 'ncku', '成大合成課程');
  expect(ncku.heroHref).toBe('/timetable?campus=ncku');
  expect(ncku.listHref).toBe('/timetable?campus=ncku');
  expect(screen.queryByText('台大合成課程')).toBeNull();

  state.search = 'campus=ntu';
  view.rerender(<App />);
  const ntu = await links(owner, 'ntu', '台大合成課程');
  expect(ntu.heroHref).toBe('/timetable?campus=ntu');
  expect(ntu.listHref).toBe('/timetable?campus=ntu');
  expect(screen.queryByText('成大合成課程')).toBeNull();
});
