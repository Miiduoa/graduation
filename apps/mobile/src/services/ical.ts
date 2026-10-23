/* eslint-disable */
import { Paths, File } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { getDocumentAsync } from 'expo-document-picker';
import ICAL from 'ical.js';

export type ICalEvent = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startDate: Date;
  endDate?: Date;
  allDay?: boolean;
  url?: string;
  categories?: string[];
};

export type ParsedCalendar = {
  name?: string;
  events: ICalEvent[];
};

export function parseICalString(icsContent: string): ParsedCalendar {
  const jcalData = ICAL.parse(icsContent);
  const comp = new ICAL.Component(jcalData);
  const calendarName = comp.getFirstPropertyValue('x-wr-calname') as string | null;

  const vevents = comp.getAllSubcomponents('vevent');
  const events: ICalEvent[] = [];

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);

    const startDate = event.startDate?.toJSDate();
    if (!startDate) continue;

    const endDate = event.endDate?.toJSDate();
    const isAllDay = event.startDate?.isDate ?? false;

    const categoriesProp = vevent.getFirstProperty('categories');
    const categories = categoriesProp ? (categoriesProp.getValues() as string[]) : undefined;

    events.push({
      id: event.uid || `ical-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: event.summary || '(無標題)',
      description: event.description || undefined,
      location: event.location || undefined,
      startDate,
      endDate: endDate || undefined,
      allDay: isAllDay,
      url: vevent.getFirstPropertyValue('url') as string | undefined,
      categories,
    });
  }

  return {
    name: calendarName || undefined,
    events: events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime()),
  };
}

export function generateICalString(events: ICalEvent[], calendarName?: string): string {
  const comp = new ICAL.Component(['vcalendar', [], []]);

  comp.updatePropertyWithValue('prodid', '-//Campus App//TW');
  comp.updatePropertyWithValue('version', '2.0');
  comp.updatePropertyWithValue('calscale', 'GREGORIAN');
  comp.updatePropertyWithValue('method', 'PUBLISH');

  if (calendarName) {
    comp.updatePropertyWithValue('x-wr-calname', calendarName);
  }

  for (const ev of events) {
    const vevent = new ICAL.Component('vevent');

    vevent.updatePropertyWithValue('uid', ev.id);
    vevent.updatePropertyWithValue('summary', ev.title);

    if (ev.description) {
      vevent.updatePropertyWithValue('description', ev.description);
    }
    if (ev.location) {
      vevent.updatePropertyWithValue('location', ev.location);
    }
    if (ev.url) {
      vevent.updatePropertyWithValue('url', ev.url);
    }

    const startTime = ICAL.Time.fromJSDate(ev.startDate, false);
    if (ev.allDay) {
      startTime.isDate = true;
    }
    vevent.updatePropertyWithValue('dtstart', startTime);

    if (ev.endDate) {
      const endTime = ICAL.Time.fromJSDate(ev.endDate, false);
      if (ev.allDay) {
        endTime.isDate = true;
      }
      vevent.updatePropertyWithValue('dtend', endTime);
    }

    const now = ICAL.Time.fromJSDate(new Date(), false);
    vevent.updatePropertyWithValue('dtstamp', now);

    if (ev.categories && ev.categories.length > 0) {
      const catProp = new ICAL.Property('categories');
      catProp.setValues(ev.categories);
      vevent.addProperty(catProp);
    }

    comp.addSubcomponent(vevent);
  }

  return comp.toString();
}

export async function pickAndParseICalFile(): Promise<ParsedCalendar | null> {
  try {
    const result = await getDocumentAsync({
      type: ['text/calendar', 'application/ics', '*/*'],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const file = new File(asset.uri);
    const content = await file.text();

    return parseICalString(content);
  } catch (error) {
    console.error('Failed to pick/parse iCal file:', error);
    throw error;
  }
}

export async function exportAndShareICalFile(
  events: ICalEvent[],
  filename: string = 'campus-calendar.ics',
  calendarName?: string,
): Promise<void> {
  const icsContent = generateICalString(events, calendarName);
  await shareICalContent(icsContent, filename);
}

type ICalShareDependencies = {
  isAvailable(): Promise<boolean>;
  write(content: string, filename: string): Promise<{ uri: string; remove(): void }>;
  share(uri: string): Promise<void>;
};

let nextOwnedICalExportSeq = 0;

/**
 * Distinct cache basename for one export invocation.
 * Keeps a human-readable stem and `.ics` while isolating overlapping shares / account switches.
 */
export function ownedICalCacheFilename(requestedName: string, now = Date.now()): string {
  nextOwnedICalExportSeq += 1;
  const trimmed = requestedName.trim() || 'campus-calendar.ics';
  const withoutExt = /\.ics$/i.test(trimmed) ? trimmed.slice(0, -4) : trimmed;
  const stem = withoutExt.replace(/[/\\]/g, '-').trim() || 'campus-calendar';
  return `${stem}-${now}-${nextOwnedICalExportSeq}.ics`;
}

const nativeICalShare: ICalShareDependencies = {
  isAvailable: isAvailableAsync,
  async write(content, filename) {
    const file = new File(Paths.cache, ownedICalCacheFilename(filename));
    await file.write(content);
    return {
      uri: file.uri,
      remove: () => {
        if (file.exists) file.delete();
      },
    };
  },
  share: (uri) =>
    shareAsync(uri, {
      mimeType: 'text/calendar',
      dialogTitle: '匯出行事曆',
      UTI: 'public.calendar',
    }),
};

/**
 * Writes an ICS payload to a cache file and opens the native share sheet.
 * Scope fencing must be provided by callers so a deferred share cannot cross accounts.
 */
export async function shareICalContent(
  content: string,
  filename = 'campus-one-personal-events.ics',
  active: () => boolean = () => true,
  dependencies: ICalShareDependencies = nativeICalShare,
): Promise<void> {
  const requireActive = () => {
    if (!active()) throw new Error('帳號或學校已切換，這次匯出已停止。');
  };
  requireActive();
  if (!content.trim()) throw new Error('目前沒有可匯出的行程。');
  const available = await dependencies.isAvailable();
  requireActive();
  if (!available) throw new Error('這台裝置暫時無法開啟分享選單，行程仍保留，請稍後再試。');
  const file = await dependencies.write(content, filename);
  try {
    requireActive();
  } catch (error) {
    file.remove();
    throw error;
  }
  try {
    await dependencies.share(file.uri);
    // Keep the owned cache file only while the same scope is still active: some targets
    // finish reading asynchronously. A post-share scope change must remove the old file.
    requireActive();
  } catch (error) {
    file.remove();
    throw error instanceof Error ? error : new Error('分享選單未能開啟，請重試。');
  }
}

export async function saveICalToFile(
  events: ICalEvent[],
  filename: string = 'campus-calendar.ics',
  calendarName?: string,
): Promise<string> {
  const icsContent = generateICalString(events, calendarName);
  const file = new File(Paths.document, filename);

  await file.write(icsContent);

  return file.uri;
}

export function generateSubscriptionUrl(baseUrl: string, schoolId: string): string {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('公開活動訂閱網址設定有誤');
  }
  if (
    !schoolId.trim() ||
    schoolId !== schoolId.trim() ||
    schoolId.length > 120 ||
    /[/\r\n\0]/.test(schoolId) ||
    schoolId === '.' ||
    schoolId === '..'
  ) {
    throw new Error('學校資料無法用於訂閱');
  }
  const params = new URLSearchParams({ schoolId, type: 'events' });
  return `${base.href.replace(/\/+$/, '')}/calendarSubscribe?${params.toString()}`;
}

export function convertAppEventsToICalEvents(
  appEvents: Array<{
    id: string;
    title?: string;
    startsAt?: any;
    endsAt?: any;
    location?: string;
    description?: string;
  }>,
  type: 'event' | 'assignment' = 'event',
): ICalEvent[] {
  return appEvents
    .map((e) => {
      const startDate = e.startsAt?.toDate?.() ?? (e.startsAt ? new Date(e.startsAt) : null);
      if (!startDate || isNaN(startDate.getTime())) return null;

      const endDate = e.endsAt?.toDate?.() ?? (e.endsAt ? new Date(e.endsAt) : undefined);

      return {
        id: `${type}-${e.id}`,
        title: e.title ?? '(無標題)',
        description: e.description,
        location: e.location,
        startDate,
        endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
        categories: [type === 'event' ? '活動' : '作業'],
      } as ICalEvent;
    })
    .filter((e): e is ICalEvent => e !== null);
}

export function convertAssignmentsToICalEvents(
  assignments: Array<{
    id: string;
    title?: string;
    dueAt?: any;
    groupName?: string;
  }>,
): ICalEvent[] {
  return assignments
    .map((a) => {
      const dueDate = a.dueAt?.toDate?.() ?? (a.dueAt ? new Date(a.dueAt) : null);
      if (!dueDate || isNaN(dueDate.getTime())) return null;

      return {
        id: `assignment-${a.id}`,
        title: `[作業] ${a.title ?? '(無標題)'}`,
        description: a.groupName ? `課程：${a.groupName}` : undefined,
        startDate: dueDate,
        allDay: true,
        categories: ['作業'],
      } as ICalEvent;
    })
    .filter((e): e is ICalEvent => e !== null);
}
