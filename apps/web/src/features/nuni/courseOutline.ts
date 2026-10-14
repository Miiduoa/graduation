import type {
  NuniAssignment,
  NuniMaterial,
  NuniQuiz,
  NuniUnit,
} from '@campus/shared/src/nuni';
import { NuniError } from '@campus/shared/src/nuni';

export type CourseOutlineSection = {
  id: string | null;
  title: string;
  materials: NuniMaterial[];
  assignments: NuniAssignment[];
  quizzes: NuniQuiz[];
  missingUnit: boolean;
};

type CourseActivity = Pick<NuniAssignment, 'state' | 'dueAt' | 'mySubmission'> &
  Partial<Pick<NuniQuiz, 'myResponse'>>;

export function selectCourseUnit(form: FormData, units: NuniUnit[] | null): string | undefined {
  const selected = form.get('unitId');
  if (selected === null || selected === '') return undefined;
  if (typeof selected !== 'string' || !units?.some((unit) => unit.id === selected)) {
    throw new NuniError(409, 'UNIT_NOT_AVAILABLE');
  }
  return selected;
}

export function buildCourseOutline(
  units: NuniUnit[],
  materials: NuniMaterial[],
  assignments: NuniAssignment[],
  quizzes: NuniQuiz[],
): CourseOutlineSection[] {
  const ordered = [...units].sort(
    (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const sections: CourseOutlineSection[] = ordered.map((unit) => ({
    id: unit.id,
    title: unit.title,
    materials: [],
    assignments: [],
    quizzes: [],
    missingUnit: false,
  }));
  const loose: CourseOutlineSection = {
    id: null,
    title: ordered.length ? '其他內容' : '尚未分類',
    materials: [],
    assignments: [],
    quizzes: [],
    missingUnit: false,
  };
  const byUnit = new Map(sections.map((section) => [section.id, section]));
  let missingUnit = false;
  function target(unitId: string | null) {
    if (unitId && !byUnit.has(unitId)) missingUnit = true;
    return (unitId ? byUnit.get(unitId) : undefined) ?? loose;
  }
  for (const item of materials) target(item.unitId).materials.push(item);
  for (const item of assignments) target(item.unitId).assignments.push(item);
  for (const item of quizzes) target(item.unitId).quizzes.push(item);
  loose.missingUnit = missingUnit;
  for (const section of [...sections, loose]) {
    section.materials.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const bySuggestedDate = (a: { dueAt: string | null; title: string }, b: { dueAt: string | null; title: string }) =>
      (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
      a.title.localeCompare(b.title, 'zh-TW');
    section.assignments.sort(bySuggestedDate);
    section.quizzes.sort(bySuggestedDate);
  }
  if (loose.materials.length || loose.assignments.length || loose.quizzes.length || !ordered.length) {
    sections.push(loose);
  }
  return sections;
}

export function courseTaskTotals(assignments: NuniAssignment[], quizzes: NuniQuiz[], now: number) {
  const assigned = assignments.length + quizzes.length;
  const completed = assignments.filter((item) => !!item.mySubmission).length +
    quizzes.filter((item) => !!item.myResponse).length;
  const pending = assignments.filter((item) => item.state === 'open' && !item.mySubmission).length +
    quizzes.filter((item) => item.state === 'open' && !item.myResponse).length;
  const suggestedSoon = [
    ...assignments.filter((item) => item.state === 'open' && !item.mySubmission),
    ...quizzes.filter((item) => item.state === 'open' && !item.myResponse),
  ].filter((item) => item.dueAt !== null && Date.parse(item.dueAt) <= now + 7 * 24 * 60 * 60 * 1000).length;
  return { assigned, completed, pending, suggestedSoon };
}

export function courseActivityStatus(
  item: NuniAssignment | NuniQuiz,
  kind: 'assignment' | 'quiz',
) {
  const submitted = kind === 'assignment'
    ? !!(item as NuniAssignment).mySubmission
    : !!(item as NuniQuiz).myResponse;
  if (submitted) return kind === 'assignment' ? '已繳交' : '已作答';
  if (item.state === 'closed') return kind === 'assignment' ? '已停止收件' : '已結束';
  return kind === 'assignment' ? '待繳交' : '待作答';
}
