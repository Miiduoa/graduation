import type { NuniClassCoursework, ReviewedWorkspaceCourse } from '../services/nuniClassCoursework';
import type { PlatformTimetableAccess } from '../services/assistantTimetableSource';
import type { SavedClassRead } from '../services/savedClassQuery';

export type CourseworkChoice = { classIndex: number } | { workspaceId: string };
export type CourseworkRead = {
  anchor: SavedClassRead;
  checkedAt?: string;
  selectedWorkspaceId?: string;
  expectedReviewed?: ReviewedWorkspaceCourse;
  expectedLinkedWorkspaceId?: string;
  result: NuniClassCoursework | { kind: 'choose-class' };
};
export type CourseworkRequests = {
  request: (path: string, input?: Record<string, unknown>) => Promise<unknown>;
  bffRequest: (path: string) => Promise<unknown>;
};

export function classCourseworkQuestion(text: string, hasPreviousClass = false): 'current' | 'next' | 'context' | null {
  const question = text.trim().replace(/[？?！!。\s]/g, '').replace(/^(?:請問|幫我查一下|幫我查|查一下|查)/, '');
  if (hasPreviousClass && /^(?:有作業嗎|有什麼作業(?:要交)?|要交什麼作業|作業呢)$/.test(question)) return 'context';
  const match = question.match(/^(下(?:一)?[堂節]課?|(?:我)?(?:現在|目前)(?:(?:這一?)?[堂節門]課?|上的課|課程)?|(?:剛才)?[這那]一?[堂門節]課?|該課程)(?:的)?(?:有(?:哪(?:些|幾個)|什麼|沒有)?(?:要交的)?作業|(?:要交)?什麼作業|作業(?:有哪些|有什麼|是什麼)?)(?:嗎|呢)?$/);
  if (!match) return null;
  return match[1].startsWith('下') ? 'next' : /現在|目前/.test(match[1]) ? 'current' : 'context';
}

export async function answerNuniCoursework(
  previous: { savedClassRead?: SavedClassRead; courseworkRead?: CourseworkRead } | undefined,
  platform: PlatformTimetableAccess,
  schoolId: string,
  isCurrent: () => boolean,
  transport?: CourseworkRequests,
  choice?: CourseworkChoice,
): Promise<{ content: string; courseworkRead?: CourseworkRead }> {
  const lastWork = previous?.courseworkRead;
  const read = previous?.savedClassRead ?? lastWork?.anchor;
  if (!read || read.uid || read.owner !== `nuni:${platform.accountId}` || read.schoolId !== schoolId || !read.classes.length) {
    return { content: '請先查現在或下一堂課，選好課堂後就能連線查 nuni 作業。' };
  }
  let anchor = read;
  let workspaceId = lastWork?.selectedWorkspaceId;
  let expectedReviewed = lastWork?.expectedReviewed;
  const expectedLinkedWorkspaceId = !workspaceId && lastWork?.result.kind === 'assignments'
    ? lastWork.result.workspace.id : lastWork?.expectedLinkedWorkspaceId;
  if (choice && 'classIndex' in choice) {
    const item = read.classes[choice.classIndex];
    if (lastWork?.result.kind !== 'choose-class' || !item) return { content: '請重新選擇要查作業的課堂。' };
    anchor = { ...read, classes: [item] };
  } else if (choice && 'workspaceId' in choice) {
    const candidate = lastWork?.result.kind === 'choose'
      ? lastWork.result.workspaces.find((item) => item.id === choice.workspaceId) : undefined;
    if (!candidate) {
      return { content: '請重新核對要查詢的 nuni 課程。' };
    }
    workspaceId = candidate.id;
    expectedReviewed = candidate.reviewed;
  }
  if (anchor.classes.length > 1) {
    return { content: '要查哪一堂課的作業？', courseworkRead: { anchor, result: { kind: 'choose-class' } } };
  }
  if (!transport) return { content: '暫時無法連線查詢作業。', courseworkRead: { anchor, result: { kind: 'unavailable' } } };
  const { readNuniClassCoursework } = require('../services/nuniClassCoursework') as typeof import('../services/nuniClassCoursework');
  const result = await readNuniClassCoursework({
    ...transport, accountId: platform.accountId, isCurrent, schoolId, occurrence: anchor.classes[0],
    selectedWorkspaceId: workspaceId, expectedReviewed, expectedLinkedWorkspaceId,
  });
  return { content: `${anchor.classes[0].name}的課堂作業`, courseworkRead: {
    anchor, result, checkedAt: new Date().toISOString(),
    ...(workspaceId && (result.kind === 'unavailable' || result.kind === 'assignments') && { selectedWorkspaceId: workspaceId, expectedReviewed }),
    ...(expectedLinkedWorkspaceId && result.kind === 'unavailable' && { expectedLinkedWorkspaceId }),
  } };
}
