/** Page-memory-only data. Never retain revisions, upload IDs or submission state. */
export type TronClassLocalDraft = {
  courseId: number;
  homeworkId: number;
  content: string;
  files: File[];
};

export function sameTronClassDraftScope(
  draft: TronClassLocalDraft,
  courseId: number,
  homeworkId: number,
): boolean {
  return draft.courseId === courseId && draft.homeworkId === homeworkId;
}
