'use client';

import { useEffect, useState } from 'react';
import type { CampusEventTime } from '@campus/shared/src/campusEventTime';

export function useEventClock(event?: CampusEventTime, leadTime = 0): number {
  const [now, setNow] = useState(Date.now);
  const start = Date.parse(event?.startsAt ?? '');
  const end = Date.parse(event?.endsAt ?? '');
  useEffect(() => {
    let timer: number;
    const boundaries = [start - leadTime, start, end];
    function update() {
      const time = Date.now();
      setNow(time);
      window.clearTimeout(timer);
      const next = Math.min(time + 60_000, ...boundaries.filter(boundary => boundary > time));
      timer = window.setTimeout(update, next - time);
    }
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [start, end, leadTime]);
  return now;
}
