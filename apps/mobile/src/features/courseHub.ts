import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { getAuthInstance, getDb, isFirebaseMockMode } from '../firebase';
import { tcFetchCourseDetail } from '../services/tronClassClient';
import { isTronClassDataFetchEnabled } from '../services/tronClassDataEnabled';
import type { CourseHubTarget } from '../utils/courseHubRoute';
import { courseSubmissionState, type CourseSubmissionState } from './courseSubmissionState';

export type CourseHubScope = { uid: string; schoolId: string; target: CourseHubTarget };
type Section<T> = { status: 'ready'; items: T[] } | { status: 'error'; items: [] };
export type HubAssignment = {
  id: string;
  title: string;
  description: string;
  dueAt: string | null;
  closed: boolean;
  submission?: CourseSubmissionState;
};
export type HubMaterial = {
  id: string;
  title: string;
  description: string;
  url: string | null;
  order: number;
};
export type CourseHubData = {
  name: string;
  description: string;
  details: string[];
  assignments: Section<HubAssignment>;
  materials: Section<HubMaterial>;
};
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
export function courseResourceUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function dateText(value: unknown): string | null {
  if (!value) return null;
  try {
    const timestamp = value as { toDate?: () => Date };
    const date =
      typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch {
    return null;
  }
}
function assertCurrent(scope: CourseHubScope, current: () => boolean) {
  if (
    !current() ||
    isFirebaseMockMode() ||
    !scope.uid ||
    getAuthInstance().currentUser?.uid !== scope.uid
  ) {
    throw new Error('請重新登入後開啟課程。');
  }
  if ([scope.uid, scope.schoolId].some((id) => !id || id.includes('/')))
    throw new Error('課程連結不完整。');
}
async function authorize(scope: CourseHubScope, current: () => boolean) {
  assertCurrent(scope, current);
  const db = getDb();
  const school = await getDocFromServer(doc(db, 'schools', scope.schoolId, 'members', scope.uid));
  assertCurrent(scope, current);
  if (!school.exists() || school.data().status !== 'active')
    throw new Error('目前無法確認學校成員資格。');
  if (scope.target.source === 'tronclass') return null;
  const { groupId } = scope.target;
  if (!groupId || groupId.includes('/')) throw new Error('課程連結不完整。');
  const [group, member] = await Promise.all([
    getDocFromServer(doc(db, 'groups', groupId)),
    getDocFromServer(doc(db, 'groups', groupId, 'members', scope.uid)),
  ]);
  assertCurrent(scope, current);
  if (
    !group.exists() ||
    group.data().type !== 'course' ||
    group.data().schoolId !== scope.schoolId ||
    group.data().isDemo === true ||
    group.data().source === 'demo' ||
    /^demo-/i.test(groupId) ||
    !member.exists() ||
    member.data().status !== 'active'
  )
    throw new Error('目前無法存取這門課，請回到課程列表重新選擇。');
  return {
    group: group.data(),
    role: String(member.data().role ?? ''),
  };
}

export async function loadCourseHub(
  scope: CourseHubScope,
  current: () => boolean = () => true,
): Promise<CourseHubData> {
  const courseAccess = await authorize(scope, current);
  if (scope.target.source === 'tronclass') {
    if (scope.schoolId !== 'pu' || !isTronClassDataFetchEnabled())
      throw new Error('目前無法連線到這門校方課程。');
    const course = await tcFetchCourseDetail(scope.target.courseId);
    assertCurrent(scope, current);
    if (!course || course.id !== scope.target.courseId || !text(course.name))
      throw new Error('目前無法確認校方課程資料，請重新連線後再試。');
    await authorize(scope, current);
    const teachers = course.instructors
      ?.map((teacher) => text(teacher.name))
      .filter(Boolean)
      .join('、');
    return {
      name: text(course.name),
      description: '',
      details: [
        text(course.course_code),
        text(course.semester?.name),
        teachers,
        typeof course.credit === 'number' && Number.isFinite(course.credit)
          ? `${course.credit} 學分`
          : '',
      ].filter(Boolean),
      assignments: { status: 'ready', items: [] },
      materials: { status: 'ready', items: [] },
    };
  }
  const { groupId } = scope.target;
  const group = courseAccess?.group;
  const canTeach = ['owner', 'instructor', 'moderator'].includes(courseAccess?.role ?? '');
  const db = getDb();
  const [assignments, materials] = await Promise.allSettled([
    getDocsFromServer(collection(db, 'groups', groupId, 'assignments')),
    getDocsFromServer(collection(db, 'groups', groupId, 'modules')),
  ]);
  assertCurrent(scope, current);
  await authorize(scope, current);
  const visible = (id: string, row: Record<string, unknown>) =>
    row.published === true &&
    !['draft', 'retracted', 'archived', 'deleted'].includes(String(row.status)) &&
    row.isDemo !== true &&
    row.source !== 'demo' &&
    !/^demo-/i.test(id) &&
    (row.schoolId == null || row.schoolId === scope.schoolId) &&
    (row.groupId == null || row.groupId === groupId);
  const releasedFile = (id: string, row: Record<string, unknown>) =>
    row.published !== false &&
    !['draft', 'retracted', 'archived', 'deleted'].includes(String(row.status ?? '')) &&
    row.isDemo !== true &&
    row.source !== 'demo' &&
    !/^demo-/i.test(id);
  const modules =
    materials.status === 'fulfilled'
      ? materials.value.docs
          .filter((entry) => visible(entry.id, entry.data()))
          .map((entry) => {
            const row = entry.data();
            return {
              id: entry.id,
              title: text(row.title) || '課程單元',
              description: text(row.description),
              url: courseResourceUrl(row.resourceUrl),
              order: typeof row.order === 'number' ? row.order : 999,
            };
          })
          .sort((a, b) => a.order - b.order)
      : [];
  const nested =
    materials.status === 'fulfilled'
      ? await Promise.all(
          modules.map(async (module) => {
            try {
              const snap = await getDocsFromServer(
                collection(db, 'groups', groupId, 'modules', module.id, 'materials'),
              );
              return { moduleId: module.id, ok: true as const, docs: snap.docs };
            } catch {
              return { moduleId: module.id, ok: false as const, docs: [] };
            }
          }),
        )
      : [];
  if (nested.length) {
    assertCurrent(scope, current);
    await authorize(scope, current);
  }
  const files = modules.flatMap((module) => {
    const folder = nested.find((row) => row.moduleId === module.id);
    const cabinet = (folder?.docs ?? [])
      .filter((entry) => releasedFile(entry.id, entry.data()))
      .map((entry, index) => {
        const row = entry.data();
        return {
          id: `${module.id}:${entry.id}`,
          title: text(row.label) || text(row.title) || module.title,
          description: text(row.description) || module.description,
          url: courseResourceUrl(row.url) ?? courseResourceUrl(row.resourceUrl),
          order: module.order + index / 1000,
        };
      })
      .filter((item) => item.url);
    if (cabinet.length) return cabinet;
    return [module];
  });
  const published = assignments.status === 'fulfilled'
    ? assignments.value.docs.filter(
        (entry) =>
          visible(entry.id, entry.data()) &&
          entry.data().type === 'assignment' &&
          ['published', 'closed'].includes(entry.data().status),
      )
    : [];
  const assignmentItems: HubAssignment[] = [];
  const batchSize = 8;

  for (let offset = 0; offset < published.length; offset += batchSize) {
    const batch = published.slice(offset, offset + batchSize);
    const receipts = canTeach
      ? []
      : await Promise.allSettled(
          batch.map((entry) =>
            getDocFromServer(doc(db, 'groups', groupId, 'assignments', entry.id, 'submissions', scope.uid)),
          ),
        );
    assertCurrent(scope, current);

    for (const [index, entry] of batch.entries()) {
      const row = entry.data();
      const receipt = receipts[index];
      const submission: CourseSubmissionState = canTeach
        ? { kind: 'instructor' }
        : receipt?.status === 'fulfilled'
          ? courseSubmissionState(receipt.value.exists() ? (receipt.value.data() ?? null) : null)
          : { kind: 'unavailable' };
      assignmentItems.push({
        id: entry.id,
        title: text(row.title) || '未命名作業',
        description: text(row.description),
        dueAt: dateText(row.dueAt),
        closed: row.status === 'closed',
        submission,
      });
    }
  }
  if (published.length) await authorize(scope, current);

  return {
    name: text(group?.name) || '未命名課程',
    description: text(group?.description),
    details: [],
    assignments: assignments.status === 'rejected'
      ? { status: 'error', items: [] }
      : { status: 'ready', items: assignmentItems },
    materials:
      materials.status === 'rejected'
        ? { status: 'error', items: [] }
        : { status: 'ready', items: files },
  };
}
