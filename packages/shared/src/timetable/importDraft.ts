import {
  cleanCourse,
  cleanCourses,
  courseKey,
  coursesOverlap,
  sameCourseSlot,
  type PersonalCourse,
} from './course';

export type ImportMode = 'replace' | 'merge';

export type ImportFlag = {
  type: 'low' | 'duplicate' | 'conflict';
  label: string;
};

export type ImportDraft = PersonalCourse & {
  selected?: boolean;
  confidence?: number;
  raw?: string;
  flags?: ImportFlag[];
};

export function analyzeImportDrafts(
  current: PersonalCourse[],
  drafts: ImportDraft[],
  mode: ImportMode,
): ImportDraft[] {
  return drafts.map((draft, index) => {
    const flags: ImportFlag[] = [];
    if ((draft.confidence ?? 100) < 65) flags.push({ type: 'low', label: '需確認' });
    if (mode === 'merge' && current.some((course) => sameCourseSlot(draft, course))) {
      flags.push({ type: 'duplicate', label: '已有相同課' });
    } else if (mode === 'merge' && current.some((course) => coursesOverlap(draft, course))) {
      flags.push({ type: 'conflict', label: '與現有課衝堂' });
    }
    const previous = drafts.slice(0, index);
    if (previous.some((course) => sameCourseSlot(draft, course))) {
      flags.push({ type: 'duplicate', label: '清單內重複' });
    } else if (previous.some((course) => coursesOverlap(draft, course))) {
      flags.push({ type: 'conflict', label: '清單內衝堂' });
    }
    return { ...draft, flags };
  });
}

export function selectedDrafts(drafts: ImportDraft[]): ImportDraft[] {
  return drafts.filter((draft) => draft.selected !== false && draft.name?.trim());
}

export function applyImport(
  current: PersonalCourse[],
  drafts: ImportDraft[],
  mode: ImportMode,
): PersonalCourse[] {
  const incoming = selectedDrafts(drafts).map((draft) => cleanCourse(draft));
  if (mode === 'replace') return cleanCourses(incoming);
  const keys = new Set(current.map(courseKey));
  return cleanCourses([...current, ...incoming.filter((course) => !keys.has(courseKey(course)))]);
}

export const IMPORT_NOT_APPLIED_COPY = '沒有修改你原本的課表';
export const IMPORT_CONFIRM_COPY = '課表尚未被修改，按確認匯入後才會套用';
