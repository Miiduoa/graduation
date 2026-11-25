import { isPersonalImportDate } from '@campus/shared';

/** Calendar keyboard movement uses date-only UTC arithmetic, independent of device timezone. */
export function monthCalendarKeyboardDate(date: string, key: string): string | null {
  if (!isPersonalImportDate(date)) return null;
  const next = new Date(`${date}T00:00:00Z`);
  const day = next.getUTCDate();
  switch (key) {
    case 'ArrowLeft':
      next.setUTCDate(day - 1);
      break;
    case 'ArrowRight':
      next.setUTCDate(day + 1);
      break;
    case 'ArrowUp':
      next.setUTCDate(day - 7);
      break;
    case 'ArrowDown':
      next.setUTCDate(day + 7);
      break;
    case 'Home':
      next.setUTCDate(day - next.getUTCDay());
      break;
    case 'End':
      next.setUTCDate(day + 6 - next.getUTCDay());
      break;
    case 'PageUp':
    case 'PageDown': {
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + (key === 'PageUp' ? -1 : 1));
      const last = new Date(next);
      last.setUTCMonth(last.getUTCMonth() + 1, 0);
      next.setUTCDate(Math.min(day, last.getUTCDate()));
      break;
    }
    default:
      return null;
  }
  const result = next.toISOString().slice(0, 10);
  return isPersonalImportDate(result) ? result : null;
}
