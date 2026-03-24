/* eslint-disable */
import { Paths, File } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { getDocumentAsync } from "expo-document-picker";
import ICAL from "ical.js";

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
  const calendarName = comp.getFirstPropertyValue("x-wr-calname") as string | null;

  const vevents = comp.getAllSubcomponents("vevent");
  const events: ICalEvent[] = [];

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);

    const startDate = event.startDate?.toJSDate();
    if (!startDate) continue;

    const endDate = event.endDate?.toJSDate();
    const isAllDay = event.startDate?.isDate ?? false;

    const categoriesProp = vevent.getFirstProperty("categories");
    const categories = categoriesProp
      ? (categoriesProp.getValues() as string[])
      : undefined;

    events.push({
      id: event.uid || `ical-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: event.summary || "(無標題)",
      description: event.description || undefined,
      location: event.location || undefined,
      startDate,
      endDate: endDate || undefined,
      allDay: isAllDay,
      url: vevent.getFirstPropertyValue("url") as string | undefined,
      categories,
    });
  }

  return {
    name: calendarName || undefined,
    events: events.sort((a, b) => a.startDate.getTime() - b.startDate.getTime()),
  };
}

export function generateICalString(events: ICalEvent[], calendarName?: string): string {
  const comp = new ICAL.Component(["vcalendar", [], []]);

  comp.updatePropertyWithValue("prodid", "-//Campus App//TW");
  comp.updatePropertyWithValue("version", "2.0");
  comp.updatePropertyWithValue("calscale", "GREGORIAN");
  comp.updatePropertyWithValue("method", "PUBLISH");

  if (calendarName) {
    comp.updatePropertyWithValue("x-wr-calname", calendarName);
  }

  for (const ev of events) {
    const vevent = new ICAL.Component("vevent");

    vevent.updatePropertyWithValue("uid", ev.id);
    vevent.updatePropertyWithValue("summary", ev.title);

    if (ev.description) {
      vevent.updatePropertyWithValue("description", ev.description);
    }
    if (ev.location) {
      vevent.updatePropertyWithValue("location", ev.location);
    }
    if (ev.url) {
      vevent.updatePropertyWithValue("url", ev.url);
    }

    const startTime = ICAL.Time.fromJSDate(ev.startDate, false);
    if (ev.allDay) {
      startTime.isDate = true;
    }
    vevent.updatePropertyWithValue("dtstart", startTime);

    if (ev.endDate) {
      const endTime = ICAL.Time.fromJSDate(ev.endDate, false);
      if (ev.allDay) {
        endTime.isDate = true;
      }
      vevent.updatePropertyWithValue("dtend", endTime);
    }

    const now = ICAL.Time.fromJSDate(new Date(), false);
    vevent.updatePropertyWithValue("dtstamp", now);

    if (ev.categories && ev.categories.length > 0) {
      const catProp = new ICAL.Property("categories");
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
      type: ["text/calendar", "application/ics", "*/*"],
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
    console.error("Failed to pick/parse iCal file:", error);
    throw error;
  }
}

export async function exportAndShareICalFile(
  events: ICalEvent[],
  filename: string = "campus-calendar.ics",
  calendarName?: string
): Promise<void> {
  const icsContent = generateICalString(events, calendarName);
  const file = new File(Paths.cache, filename);

  await file.write(icsContent);

  const canShare = await isAvailableAsync();
  if (canShare) {
    await shareAsync(file.uri, {
      mimeType: "text/calendar",
      dialogTitle: "匯出行事曆",
      UTI: "public.calendar",
    });
  } else {
    throw new Error("分享功能不可用");
  }
}

export async function saveICalToFile(
  events: ICalEvent[],
  filename: string = "campus-calendar.ics",
  calendarName?: string
): Promise<string> {
  const icsContent = generateICalString(events, calendarName);
  const file = new File(Paths.document, filename);

  await file.write(icsContent);

  return file.uri;
}

export function generateSubscriptionUrl(
  baseUrl: string,
  schoolId: string,
  userId?: string
): string {
  const params = new URLSearchParams({ schoolId });
  if (userId) {
    params.append("userId", userId);
  }
  return `${baseUrl}/api/calendar/subscribe?${params.toString()}`;
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
  type: "event" | "assignment" = "event"
): ICalEvent[] {
  return appEvents
    .map((e) => {
      const startDate = e.startsAt?.toDate?.() ?? (e.startsAt ? new Date(e.startsAt) : null);
      if (!startDate || isNaN(startDate.getTime())) return null;

      const endDate = e.endsAt?.toDate?.() ?? (e.endsAt ? new Date(e.endsAt) : undefined);

      return {
        id: `${type}-${e.id}`,
        title: e.title ?? "(無標題)",
        description: e.description,
        location: e.location,
        startDate,
        endDate: endDate && !isNaN(endDate.getTime()) ? endDate : undefined,
        categories: [type === "event" ? "活動" : "作業"],
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
  }>
): ICalEvent[] {
  return assignments
    .map((a) => {
      const dueDate = a.dueAt?.toDate?.() ?? (a.dueAt ? new Date(a.dueAt) : null);
      if (!dueDate || isNaN(dueDate.getTime())) return null;

      return {
        id: `assignment-${a.id}`,
        title: `[作業] ${a.title ?? "(無標題)"}`,
        description: a.groupName ? `課程：${a.groupName}` : undefined,
        startDate: dueDate,
        allDay: true,
        categories: ["作業"],
      } as ICalEvent;
    })
    .filter((e): e is ICalEvent => e !== null);
}
