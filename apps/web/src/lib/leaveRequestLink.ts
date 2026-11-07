export function parseLeaveRequestId(value: unknown): string | null {
  return typeof value === 'string' && value === value.trim() && /^[a-zA-Z0-9_-]{12,64}$/.test(value) ? value : null;
}

export function leaveRequestHref(requestId: unknown, schoolId?: unknown): string | null {
  const id = parseLeaveRequestId(requestId);
  if (!id) return null;
  const params = new URLSearchParams();
  if (schoolId != null) {
    if (typeof schoolId !== 'string' || schoolId === 'all' || schoolId !== schoolId.trim() || !/^[a-z0-9_-]{1,80}$/.test(schoolId)) return null;
    params.set('schoolId', schoolId);
  }
  params.set('requestId', id);
  return `/leave?${params.toString()}`;
}
