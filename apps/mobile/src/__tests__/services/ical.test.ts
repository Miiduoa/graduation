import {
  parseICalString,
  generateICalString,
  generateSubscriptionUrl,
  convertAppEventsToICalEvents,
  convertAssignmentsToICalEvents,
  ICalEvent,
} from '../../services/ical';

jest.mock('expo-file-system', () => ({
  Paths: {
    cache: 'file:///mock/cache/',
    document: 'file:///mock/documents/',
  },
  File: jest.fn().mockImplementation((path: string, name?: string) => ({
    uri: name ? `${path}${name}` : path,
    text: jest.fn().mockResolvedValue(''),
    write: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

describe('iCal Service', () => {
  describe('parseICalString', () => {
    const sampleICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
X-WR-CALNAME:Test Calendar
BEGIN:VEVENT
UID:event-1
SUMMARY:Test Event
DESCRIPTION:This is a test event
LOCATION:Room 101
DTSTART:20240115T100000Z
DTEND:20240115T120000Z
END:VEVENT
BEGIN:VEVENT
UID:event-2
SUMMARY:All Day Event
DTSTART;VALUE=DATE:20240116
END:VEVENT
END:VCALENDAR`;

    it('should parse calendar name', () => {
      const result = parseICalString(sampleICS);
      expect(result.name).toBe('Test Calendar');
    });

    it('should parse events', () => {
      const result = parseICalString(sampleICS);
      expect(result.events).toHaveLength(2);
    });

    it('should parse event details', () => {
      const result = parseICalString(sampleICS);
      const event = result.events.find((e) => e.id === 'event-1');

      expect(event).toBeDefined();
      expect(event?.title).toBe('Test Event');
      expect(event?.description).toBe('This is a test event');
      expect(event?.location).toBe('Room 101');
      expect(event?.startDate).toBeInstanceOf(Date);
      expect(event?.endDate).toBeInstanceOf(Date);
    });

    it('should parse all-day events', () => {
      const result = parseICalString(sampleICS);
      const allDayEvent = result.events.find((e) => e.id === 'event-2');

      expect(allDayEvent?.allDay).toBe(true);
    });

    it('should sort events by start date', () => {
      const result = parseICalString(sampleICS);
      const dates = result.events.map((e) => e.startDate.getTime());

      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    it('should handle missing optional fields', () => {
      const minimalICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:minimal-event
DTSTART:20240115T100000Z
END:VEVENT
END:VCALENDAR`;

      const result = parseICalString(minimalICS);
      const event = result.events[0];

      expect(event.title).toBe('(無標題)');
      expect(event.description).toBeUndefined();
      expect(event.location).toBeUndefined();
    });

    it('should parse categories', () => {
      const icsWithCategories = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:cat-event
SUMMARY:Categorized Event
DTSTART:20240115T100000Z
CATEGORIES:Meeting,Important
END:VEVENT
END:VCALENDAR`;

      const result = parseICalString(icsWithCategories);
      expect(result.events[0].categories).toContain('Meeting');
      expect(result.events[0].categories).toContain('Important');
    });

    it('should handle empty calendar', () => {
      const emptyICS = `BEGIN:VCALENDAR
VERSION:2.0
END:VCALENDAR`;

      const result = parseICalString(emptyICS);
      expect(result.events).toHaveLength(0);
    });
  });

  describe('generateICalString', () => {
    const testEvents: ICalEvent[] = [
      {
        id: 'test-1',
        title: 'Test Event',
        description: 'A test event',
        location: 'Room 101',
        startDate: new Date('2024-01-15T10:00:00Z'),
        endDate: new Date('2024-01-15T12:00:00Z'),
      },
      {
        id: 'test-2',
        title: 'All Day Event',
        startDate: new Date('2024-01-16T00:00:00Z'),
        allDay: true,
        categories: ['Meeting', 'Important'],
      },
    ];

    it('should generate valid iCal string', () => {
      const ics = generateICalString(testEvents);

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('VERSION:2.0');
      expect(ics).toContain('END:VCALENDAR');
    });

    it('should include calendar name when provided', () => {
      const ics = generateICalString(testEvents, 'My Calendar');

      expect(ics).toContain('X-WR-CALNAME:My Calendar');
    });

    it('should include event details', () => {
      const ics = generateICalString(testEvents);

      expect(ics).toContain('UID:test-1');
      expect(ics).toContain('SUMMARY:Test Event');
      expect(ics).toContain('DESCRIPTION:A test event');
      expect(ics).toContain('LOCATION:Room 101');
    });

    it('should include categories', () => {
      const ics = generateICalString(testEvents);

      expect(ics).toContain('CATEGORIES:Meeting,Important');
    });

    it('should handle events with URL', () => {
      const eventsWithUrl: ICalEvent[] = [
        {
          id: 'url-event',
          title: 'Event with URL',
          startDate: new Date('2024-01-15T10:00:00Z'),
          url: 'https://example.com/event',
        },
      ];

      const ics = generateICalString(eventsWithUrl);

      expect(ics).toContain('URL:https://example.com/event');
    });

    it('should handle empty events array', () => {
      const ics = generateICalString([]);

      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('END:VCALENDAR');
      expect(ics).not.toContain('BEGIN:VEVENT');
    });

    it('should be parseable by parseICalString', () => {
      const ics = generateICalString(testEvents, 'Roundtrip Test');
      const parsed = parseICalString(ics);

      expect(parsed.name).toBe('Roundtrip Test');
      expect(parsed.events.length).toBe(testEvents.length);
    });
  });

  describe('generateSubscriptionUrl', () => {
    it('should generate URL with schoolId', () => {
      const url = generateSubscriptionUrl(
        'https://api.example.com',
        'school123'
      );

      expect(url).toBe(
        'https://api.example.com/api/calendar/subscribe?schoolId=school123'
      );
    });

    it('should include userId when provided', () => {
      const url = generateSubscriptionUrl(
        'https://api.example.com',
        'school123',
        'user456'
      );

      expect(url).toContain('schoolId=school123');
      expect(url).toContain('userId=user456');
    });

    it('should encode special characters', () => {
      const url = generateSubscriptionUrl(
        'https://api.example.com',
        'school with space'
      );

      // URL encoding may use + or %20 for spaces depending on implementation
      expect(url).toMatch(/school(\+|%20)with(\+|%20)space/);
    });
  });

  describe('convertAppEventsToICalEvents', () => {
    it('should convert app events to iCal format', () => {
      const appEvents = [
        {
          id: 'event-1',
          title: 'Campus Event',
          startsAt: new Date('2024-01-15T10:00:00Z'),
          endsAt: new Date('2024-01-15T12:00:00Z'),
          location: 'Main Hall',
          description: 'A campus event',
        },
      ];

      const result = convertAppEventsToICalEvents(appEvents);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event-event-1');
      expect(result[0].title).toBe('Campus Event');
      expect(result[0].location).toBe('Main Hall');
      expect(result[0].categories).toContain('活動');
    });

    it('should handle Firestore timestamp objects', () => {
      const appEvents = [
        {
          id: 'event-1',
          title: 'Event',
          startsAt: {
            toDate: () => new Date('2024-01-15T10:00:00Z'),
          },
        },
      ];

      const result = convertAppEventsToICalEvents(appEvents);

      expect(result).toHaveLength(1);
      expect(result[0].startDate).toEqual(new Date('2024-01-15T10:00:00Z'));
    });

    it('should filter out events without valid start date', () => {
      const appEvents = [
        {
          id: 'valid-event',
          title: 'Valid',
          startsAt: new Date('2024-01-15T10:00:00Z'),
        },
        {
          id: 'invalid-event',
          title: 'Invalid',
          startsAt: null,
        },
        {
          id: 'invalid-date',
          title: 'Invalid Date',
          startsAt: 'not-a-date',
        },
      ];

      const result = convertAppEventsToICalEvents(appEvents);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event-valid-event');
    });

    it('should use assignment type when specified', () => {
      const appEvents = [
        {
          id: 'assignment-1',
          title: 'Homework',
          startsAt: new Date('2024-01-15T10:00:00Z'),
        },
      ];

      const result = convertAppEventsToICalEvents(appEvents, 'assignment');

      expect(result[0].id).toBe('assignment-assignment-1');
      expect(result[0].categories).toContain('作業');
    });

    it('should handle events without title', () => {
      const appEvents = [
        {
          id: 'no-title',
          startsAt: new Date('2024-01-15T10:00:00Z'),
        },
      ];

      const result = convertAppEventsToICalEvents(appEvents);

      expect(result[0].title).toBe('(無標題)');
    });
  });

  describe('convertAssignmentsToICalEvents', () => {
    it('should convert assignments to iCal format', () => {
      const assignments = [
        {
          id: 'hw-1',
          title: 'Math Homework',
          dueAt: new Date('2024-01-20T23:59:00Z'),
          groupName: 'Mathematics 101',
        },
      ];

      const result = convertAssignmentsToICalEvents(assignments);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('assignment-hw-1');
      expect(result[0].title).toBe('[作業] Math Homework');
      expect(result[0].description).toBe('課程：Mathematics 101');
      expect(result[0].allDay).toBe(true);
      expect(result[0].categories).toContain('作業');
    });

    it('should handle Firestore timestamp for dueAt', () => {
      const assignments = [
        {
          id: 'hw-1',
          title: 'Assignment',
          dueAt: {
            toDate: () => new Date('2024-01-20T23:59:00Z'),
          },
        },
      ];

      const result = convertAssignmentsToICalEvents(assignments);

      expect(result).toHaveLength(1);
      expect(result[0].startDate).toEqual(new Date('2024-01-20T23:59:00Z'));
    });

    it('should filter out assignments without valid due date', () => {
      const assignments = [
        {
          id: 'valid',
          title: 'Valid Assignment',
          dueAt: new Date('2024-01-20T23:59:00Z'),
        },
        {
          id: 'invalid',
          title: 'Invalid Assignment',
          dueAt: null,
        },
      ];

      const result = convertAssignmentsToICalEvents(assignments);

      expect(result).toHaveLength(1);
    });

    it('should handle assignments without title', () => {
      const assignments = [
        {
          id: 'no-title',
          dueAt: new Date('2024-01-20T23:59:00Z'),
        },
      ];

      const result = convertAssignmentsToICalEvents(assignments);

      expect(result[0].title).toBe('[作業] (無標題)');
    });

    it('should not include description when groupName is missing', () => {
      const assignments = [
        {
          id: 'no-group',
          title: 'Independent Assignment',
          dueAt: new Date('2024-01-20T23:59:00Z'),
        },
      ];

      const result = convertAssignmentsToICalEvents(assignments);

      expect(result[0].description).toBeUndefined();
    });
  });
});
