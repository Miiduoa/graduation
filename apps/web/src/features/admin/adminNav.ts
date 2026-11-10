import { collapseInternalPathHash } from '@/lib/navigation';

export type AdminSection =
  | 'overview'
  | 'school-review'
  | 'schools'
  | 'people'
  | 'announcements'
  | 'merchants'
  | 'affiliation'
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
  reviewId: string | null;
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
    label: '工作總覽',
    heading: '工作總覽',
    purpose: '先看待辦，再進入案件處理。學校、店家與社群的工作都從這裡開始。',
  },
  'school-review': {
    label: '學校接入',
    heading: '學校接入申請',
    purpose: '審核申請、指定校方管理員，再確認服務與開通學校。',
  },
  schools: {
    label: '學校管理',
    heading: '學校管理',
    purpose: '查找學校、確認開通狀態與服務設定。',
  },
  people: {
    label: '人員授權',
    heading: '校方人員與授權',
    purpose: '先選學校，查看既有授權，再新增校方管理員或職員。',
  },
  announcements: {
    label: '校園公告',
    heading: '校園公告',
    purpose: '使用有公告編輯權限的校方帳號，進入該校工作區發布公告。',
  },
  merchants: {
    label: '店家管理',
    heading: '店家申請與營運',
    purpose: '處理合作意向與進駐申請，並查看已登錄門市的服務與公開狀態。',
  },
  affiliation: {
    label: '課班掛靠',
    heading: '課班掛靠申請',
    purpose: '核對課班、目標學校與申請原因，決定是否建立所屬關係。',
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
    reviewId: null,
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
  let selected: string | null = null;
  try {
    selected = segments[1] ? decodeURIComponent(segments[1]) : null;
  } catch {
    // A malformed bookmark can still open its section without selecting an item.
  }
  return {
    section,
    schoolId:
      section === 'schools' || section === 'people' || section === 'announcements'
        ? selected
        : null,
    reportId: section === 'reports' ? selected : null,
    reviewId:
      section === 'school-review' || section === 'merchants' || section === 'affiliation'
        ? selected
        : null,
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
  if (
    location.section === 'schools' ||
    location.section === 'people' ||
    location.section === 'announcements'
  ) {
    if (location.schoolId) path += `/${encodeURIComponent(location.schoolId)}`;
    if (location.section === 'schools') {
      if (location.schoolQuery) params.set('q', location.schoolQuery);
      if (location.schoolLifecycle !== 'all') params.set('lifecycle', location.schoolLifecycle);
    }
  } else if (location.section === 'reports') {
    if (location.reportId) path += `/${encodeURIComponent(location.reportId)}`;
    if (location.reportState !== 'open') params.set('state', location.reportState);
  } else if (
    location.section === 'school-review' ||
    location.section === 'merchants' ||
    location.section === 'affiliation'
  ) {
    if (location.reviewId) path += `/${encodeURIComponent(location.reviewId)}`;
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
  return resolveAdminLocation(
    window.location.pathname,
    window.location.search,
    window.location.hash,
  );
}

/** Preserve saved operations links while moving every task into the same workspace. */
export function resolveAdminLocation(
  pathname: string,
  search: string,
  hash: string,
): AdminLocation {
  if (pathname === '/admin/school-review') {
    return { ...defaultAdminLocation(), section: 'school-review' };
  }
  if (pathname === '/admin/ops') {
    const params = new URLSearchParams(search);
    const legacySections: AdminSection[] = [
      'schools',
      'people',
      'merchants',
      'affiliation',
      'audit',
    ];
    const querySection = params.get('tab') as AdminSection;
    const withHash = !hash || hash.startsWith('#') ? hash : `#${hash}`;
    const fragment = tryParseAdminHash(collapseInternalPathHash(withHash));
    const section = legacySections.includes(querySection)
      ? querySection
      : fragment && legacySections.includes(fragment.section)
        ? fragment.section
        : 'schools';
    const school = params.get('school') ?? params.get('tenantId');
    const schoolId = school && /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/.test(school) ? school : null;
    return {
      ...defaultAdminLocation(),
      section,
      schoolId: section === 'schools' || section === 'people' ? schoolId : null,
    };
  }
  return tryParseAdminHash(hash) ?? defaultAdminLocation();
}

export function writeAdminLocation(location: AdminLocation, mode: 'push' | 'replace' = 'push') {
  if (typeof window === 'undefined') return;
  const next = serializeAdminHash(location);
  if (
    window.location.pathname === '/admin' &&
    !window.location.search &&
    next === window.location.hash
  )
    return;
  const url = `/admin${next}`;
  if (mode === 'replace') {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
  }
}
