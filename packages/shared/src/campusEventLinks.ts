type CampusEventIdentity = {
  id: string;
  schoolId: string;
  source: 'school-club-events' | 'school-events' | 'legacy-events';
};

/** Share only the event identity; the destination retains its normal access checks. */
export function campusEventDetailPath(event: CampusEventIdentity): string {
  const params = new URLSearchParams({ schoolId: event.schoolId, source: event.source });
  return `/events/${encodeURIComponent(event.id)}?${params.toString()}`;
}
