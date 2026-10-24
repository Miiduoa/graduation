/**
 * School-specific official public entry points.
 * Source evidence checked 2026-10-24 (see docs/SCHOOL_PUBLIC_SERVICE_SOURCES_2026-10-24.md).
 * These are external public pages only — not Campus One integrations, private
 * records, appointments, job listings, or authenticated school APIs.
 */

export type SchoolPublicServiceKind = 'courses' | 'dormitory' | 'health' | 'career';

export type SchoolPublicServiceLink = {
  label: string;
  url: string;
  sourceLabel: string;
  entryKind: 'dedicated' | 'student-portal' | 'official-guide' | 'student-portal-fallback';
};

export type SchoolPublicServices = {
  schoolId: 'pu' | 'ncku' | 'ntpu' | 'ntu';
  schoolName: string;
  services: Record<SchoolPublicServiceKind, SchoolPublicServiceLink>;
};

type CanonicalSchoolId = SchoolPublicServices['schoolId'];

const ALIASES: Record<string, CanonicalSchoolId> = {
  pu: 'pu',
  'tw-pu': 'pu',
  ncku: 'ncku',
  'tw-ncku': 'ncku',
  ntpu: 'ntpu',
  'tw-ntpu': 'ntpu',
  ntu: 'ntu',
  'tw-ntu': 'ntu',
};

/** Checked 2026-10-24 — 靜宜大學公開入口 */
const PU: SchoolPublicServices = {
  schoolId: 'pu',
  schoolName: '靜宜大學',
  services: {
    courses: {
      label: '靜宜課程綱要查詢入口',
      url: 'https://alcat.pu.edu.tw/',
      sourceLabel: '靜宜大學課程綱要查詢系統公開入口',
      entryKind: 'student-portal',
    },
    dormitory: {
      label: '靜宜住宿服務組',
      url: 'https://osadorm.pu.edu.tw/',
      sourceLabel: '靜宜大學住宿服務組公開網站',
      entryKind: 'dedicated',
    },
    health: {
      label: '靜宜諮商暨健康中心',
      url: 'https://osachc.pu.edu.tw/',
      sourceLabel: '靜宜大學諮商暨健康中心公開網站',
      entryKind: 'dedicated',
    },
    career: {
      label: '靜宜職涯發展暨產業促進處',
      url: 'https://cdif.pu.edu.tw/',
      sourceLabel: '靜宜大學職涯發展暨產業促進處公開網站',
      entryKind: 'dedicated',
    },
  },
};

/** Checked 2026-10-24 — 國立成功大學公開入口 */
const NCKU: SchoolPublicServices = {
  schoolId: 'ncku',
  schoolName: '國立成功大學',
  services: {
    courses: {
      label: '成大課程資訊及選課系統',
      url: 'https://course.ncku.edu.tw/index.php?c=portal',
      sourceLabel: '國立成功大學課程資訊及選課系統公開入口',
      entryKind: 'dedicated',
    },
    dormitory: {
      label: '成大住宿服務組',
      url: 'https://housing-osa.ncku.edu.tw/',
      sourceLabel: '國立成功大學住宿服務組公開網站',
      entryKind: 'dedicated',
    },
    health: {
      label: '成大心理健康與諮商輔導組',
      url: 'https://counseling-osa.ncku.edu.tw/',
      sourceLabel: '國立成功大學心理健康與諮商輔導組公開網站',
      entryKind: 'dedicated',
    },
    career: {
      label: '成大生涯發展與就業輔導組',
      url: 'https://grad-osa.ncku.edu.tw/',
      sourceLabel: '國立成功大學生涯發展與就業輔導組公開網站',
      entryKind: 'dedicated',
    },
  },
};

/** Checked 2026-10-24 — 國立臺北大學公開入口 */
const NTPU: SchoolPublicServices = {
  schoolId: 'ntpu',
  schoolName: '國立臺北大學',
  services: {
    courses: {
      label: '北大課程查詢官方說明',
      url: 'https://sfai.ntpu.edu.tw/web/information/information.jsp?cp_id=CP1603460657954',
      sourceLabel: '國立臺北大學課程查詢官方說明頁',
      entryKind: 'official-guide',
    },
    dormitory: {
      label: '北大住宿輔導組',
      url: 'https://new.ntpu.edu.tw/osa/housing?lang=zh',
      sourceLabel: '國立臺北大學住宿輔導組公開網站',
      entryKind: 'dedicated',
    },
    health: {
      label: '北大學生諮商中心',
      url: 'https://new.ntpu.edu.tw/osa/counseling',
      sourceLabel: '國立臺北大學學生諮商中心公開網站',
      entryKind: 'dedicated',
    },
    career: {
      label: '北大職涯發展中心',
      url: 'https://career.ntpu.edu.tw/cht/index.php',
      sourceLabel: '國立臺北大學職涯發展中心公開網站',
      entryKind: 'dedicated',
    },
  },
};

/** Checked 2026-10-24 — 國立臺灣大學公開入口（宿舍／健康／職涯為學生專區後備） */
const NTU: SchoolPublicServices = {
  schoolId: 'ntu',
  schoolName: '國立臺灣大學',
  services: {
    courses: {
      label: '臺大課程網',
      url: 'https://course.ntu.edu.tw/',
      sourceLabel: '國立臺灣大學課程網公開網站',
      entryKind: 'dedicated',
    },
    dormitory: {
      label: '臺大學生專區（住宿資訊入口）',
      url: 'https://www.ntu.edu.tw/student.html',
      sourceLabel: '國立臺灣大學學生專區公開網頁',
      entryKind: 'student-portal-fallback',
    },
    health: {
      label: '臺大學生專區（諮商資訊入口）',
      url: 'https://www.ntu.edu.tw/student.html',
      sourceLabel: '國立臺灣大學學生專區公開網頁',
      entryKind: 'student-portal-fallback',
    },
    career: {
      label: '臺大學生專區（職涯資訊入口）',
      url: 'https://www.ntu.edu.tw/student.html',
      sourceLabel: '國立臺灣大學學生專區公開網頁',
      entryKind: 'student-portal-fallback',
    },
  },
};

const DIRECTORY: Record<CanonicalSchoolId, SchoolPublicServices> = {
  pu: PU,
  ncku: NCKU,
  ntpu: NTPU,
  ntu: NTU,
};

function normalizeCanonicalSchoolId(schoolId: string | null | undefined): CanonicalSchoolId | null {
  const raw = (schoolId ?? '').trim().toLowerCase();
  if (!raw || raw === 'all') return null;
  return Object.prototype.hasOwnProperty.call(ALIASES, raw) ? ALIASES[raw] : null;
}

export function resolveSchoolPublicServices(
  schoolId: string | null | undefined,
): SchoolPublicServices | null {
  const canonical = normalizeCanonicalSchoolId(schoolId);
  if (!canonical) return null;
  return DIRECTORY[canonical];
}
