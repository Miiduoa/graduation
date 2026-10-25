export type CampusEventTime = {
  startsAt?: string | null;
  endsAt?: string | null;
};

export type CampusEventPhase = 'upcoming' | 'ongoing' | 'ended' | 'started' | 'unscheduled';

export function campusEventPhase(event: CampusEventTime, now: number): CampusEventPhase {
  const start = event.startsAt ? Date.parse(event.startsAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(now)) return 'unscheduled';
  if (start > now) return 'upcoming';
  const end = event.endsAt ? Date.parse(event.endsAt) : NaN;
  // A past start alone does not tell us whether an event has finished.
  if (!Number.isFinite(end) || end <= start) return 'started';
  return end > now ? 'ongoing' : 'ended';
}

export function campusEventPhaseLabel(phase: CampusEventPhase): string {
  switch (phase) {
    case 'upcoming': return '即將開始';
    case 'ongoing': return '進行中';
    case 'ended': return '已結束';
    case 'started': return '已開始';
    case 'unscheduled': return '時間待公告';
  }
}

const phaseOrder: Record<CampusEventPhase, number> = {
  ongoing: 0,
  upcoming: 1,
  started: 2,
  ended: 3,
  unscheduled: 4,
};

/** Sort only the loaded records; a later page can still contain a nearer event. */
export function compareCampusEventTime(a: CampusEventTime, b: CampusEventTime, now: number): number {
  const phaseA = campusEventPhase(a, now);
  const phaseB = campusEventPhase(b, now);
  if (phaseA !== phaseB) return phaseOrder[phaseA] - phaseOrder[phaseB];
  if (phaseA === 'unscheduled') return 0;
  const difference = Date.parse(a.startsAt!) - Date.parse(b.startsAt!);
  return phaseA === 'ended' || phaseA === 'started' ? -difference : difference;
}
