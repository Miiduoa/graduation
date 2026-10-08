export type CourseHubTarget =
  | { source: 'group'; groupId: string }
  | { source: 'tronclass'; courseId: number };

export function resolveCourseHubTarget(
  params: Record<string, unknown> = {},
): CourseHubTarget | null {
  if (params.source === 'tronclass') {
    const id = String(params.courseId ?? '');
    return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0
      ? { source: 'tronclass', courseId: Number(id) }
      : null;
  }
  if (params.source != null && params.source !== 'group') return null;
  const id = params.groupId ?? params.courseSpaceId;
  return typeof id === 'string' && id.trim() && !id.includes('/')
    ? { source: 'group', groupId: id.trim() }
    : null;
}
