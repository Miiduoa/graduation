export type AdminSection =
  | 'overview'
  | 'schools'
  | 'people'
  | 'merchants'
  | 'boards'
  | 'reports'
  | 'audit';

export type ReportStateFilter = 'open' | 'hidden' | 'dismissed';

export type SchoolLifecycleFilter =
  | 'all'
  | 'pending'
  | 'provisioned'
  | 'open'
  | 'suspended'
  | 'rejected';

export type AdminLocation = {
  section: AdminSection;
  schoolId: string | null;
  reportId: string | null;
  reportState: ReportStateFilter;
  schoolQuery: string;
  schoolLifecycle: SchoolLifecycleFilter;
  boardsCreate: boolean;
  auditQuery: string;
};

export const sectionMeta: Record<
  AdminSection,
  { label: string; purpose: string; heading: string }
> = {
  overview: {
    label: '平台全覽',
    heading: '平台全覽',
    purpose: '跨校掌握學校、校方授權、店家與待處理事項。',
  },
  schools: {
    label: '學校管理',
    heading: '學校管理',
    purpose: '查找學校、確認開通狀態與服務設定。',
  },
  people: {
    label: '校方與權責',
    heading: '校方與權責',
    purpose: '確認各校負責人與已核發授權，釐清校務、承辦與學生本人的管理範圍。',
  },
  merchants: {
    label: '店家服務',
    heading: '店家服務',
    purpose: '跨校查看店家接入、營運模式與公開狀態。',
  },
  boards: {
    label: '公開看板',
    heading: '公開看板',
    purpose: '查看看板與發文方式，或建立新的交流空間。',
  },
  reports: {
    label: '社群檢舉',
    heading: '社群檢舉',
    purpose: '先查看檢舉內容與原因，再決定處理方式。',
  },
  audit: {
    label: '操作紀錄',
    heading: '操作紀錄',
    purpose: '依操作者、學校或動作查找紀錄。',
  },
};

const sections = Object.keys(sectionMeta) as AdminSection[];
const reportStates: ReportStateFilter[] = ['open', 'hidden', 'dismissed'];
const lifecycles: SchoolLifecycleFilter[] = [
  'all',
  'pending',
  'provisioned',
  'open',
  'suspended',
  'rejected',
];

export function defaultAdminLocation(): AdminLocation {
  return {
    section: 'overview',
    schoolId: null,
    reportId: null,
    reportState: 'open',
    schoolQuery: '',
    schoolLifecycle: 'all',
    boardsCreate: false,
    auditQuery: '',
  };
}

function readParam(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? '';
}

/** True when the hash addresses an admin workbench section, not a page content anchor. */
export function isAdminWorkbenchHash(hash: string): boolean {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return false;
  const pathPart = raw.split('?')[0] || '';
  const section = pathPart.split('/').filter(Boolean)[0];
  return sections.includes(section as AdminSection);
}

/**
 * Parse a workbench location from the hash. Returns null for ordinary content
 * anchors (e.g. #page-content) so callers can keep the current admin location.
 */
export function tryParseAdminHash(hash: string): AdminLocation | null {
  if (!isAdminWorkbenchHash(hash)) return null;
  return parseAdminHash(hash);
}

export function parseAdminHash(hash: string): AdminLocation {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const section = sections.includes(segments[0] as AdminSection)
    ? (segments[0] as AdminSection)
    : 'overview';
  const params = new URLSearchParams(queryPart);
  const schoolLifecycle = lifecycles.includes(
    readParam(params, 'lifecycle') as SchoolLifecycleFilter,
  )
    ? (readParam(params, 'lifecycle') as SchoolLifecycleFilter)
    : 'all';
  const reportState = reportStates.includes(readParam(params, 'state') as ReportStateFilter)
    ? (readParam(params, 'state') as ReportStateFilter)
    : 'open';
  const selected = segments[1] || null;
  return {
    section,
    schoolId: section === 'schools' || section === 'people' ? selected : null,
    reportId: section === 'reports' ? selected : null,
    reportState,
    schoolQuery: section === 'schools' ? readParam(params, 'q') : '',
    schoolLifecycle: section === 'schools' ? schoolLifecycle : 'all',
    boardsCreate: section === 'boards' && params.get('create') === '1',
    auditQuery: section === 'audit' ? readParam(params, 'q') : '',
  };
}

export function serializeAdminHash(location: AdminLocation): string {
  const params = new URLSearchParams();
  let path = location.section;
  if (location.section === 'schools' || location.section === 'people') {
    if (location.schoolId) path += `/${encodeURIComponent(location.schoolId)}`;
    if (location.section === 'schools') {
      if (location.schoolQuery) params.set('q', location.schoolQuery);
      if (location.schoolLifecycle !== 'all') params.set('lifecycle', location.schoolLifecycle);
    }
  } else if (location.section === 'reports') {
    if (location.reportId) path += `/${encodeURIComponent(location.reportId)}`;
    if (location.reportState !== 'open') params.set('state', location.reportState);
  } else if (location.section === 'boards') {
    if (location.boardsCreate) params.set('create', '1');
  } else if (location.section === 'audit') {
    if (location.auditQuery) params.set('q', location.auditQuery);
  }
  const query = params.toString();
  return query ? `#${path}?${query}` : `#${path}`;
}

export function readAdminLocation(): AdminLocation {
  if (typeof window === 'undefined') return defaultAdminLocation();
  return tryParseAdminHash(window.location.hash) ?? defaultAdminLocation();
}

export function writeAdminLocation(location: AdminLocation, mode: 'push' | 'replace' = 'push') {
  if (typeof window === 'undefined') return;
  const next = serializeAdminHash(location);
  if (next === (window.location.hash || '#overview')) return;
  if (mode === 'replace') {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${next}`,
    );
  } else {
    window.history.pushState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${next}`,
    );
  }
}
