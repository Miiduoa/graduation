import {
  formatDateTime,
  toDate,
  formatRelativeTime,
  formatCountdown,
  formatDuration,
  isOpenNow,
  getTimeUntilClose,
  formatFileSize,
  truncateText,
  generateId,
} from '../../utils/format';

describe('format utilities', () => {
  describe('formatDateTime', () => {
    it('should return empty string for null input', () => {
      expect(formatDateTime(null)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(formatDateTime(undefined)).toBe('');
    });

    it('should format Date object', () => {
      const date = new Date('2024-01-15T10:30:00');
      const result = formatDateTime(date);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should format ISO string', () => {
      const result = formatDateTime('2024-01-15T10:30:00');
      expect(result).toBeTruthy();
    });

    it('should format timestamp number', () => {
      const timestamp = new Date('2024-01-15T10:30:00').getTime();
      const result = formatDateTime(timestamp);
      expect(result).toBeTruthy();
    });

    it('should handle Firestore Timestamp-like object', () => {
      const firestoreTimestamp = {
        seconds: 1705315800,
        nanoseconds: 0,
        toDate: () => new Date(1705315800 * 1000),
      };
      const result = formatDateTime(firestoreTimestamp);
      expect(result).toBeTruthy();
    });

    it('should handle object with only seconds', () => {
      const obj = { seconds: 1705315800 };
      const result = formatDateTime(obj);
      expect(result).toBeTruthy();
    });

    it('should return string representation for invalid date', () => {
      expect(formatDateTime('invalid-date')).toBe('invalid-date');
    });
  });

  describe('toDate', () => {
    it('should return null for null input', () => {
      expect(toDate(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(toDate(undefined)).toBeNull();
    });

    it('should return Date for Date input', () => {
      const date = new Date('2024-01-15');
      expect(toDate(date)).toEqual(date);
    });

    it('should convert Firestore Timestamp', () => {
      const timestamp = {
        toDate: () => new Date('2024-01-15'),
      };
      const result = toDate(timestamp);
      expect(result).toEqual(new Date('2024-01-15'));
    });

    it('should convert seconds-based timestamp', () => {
      const timestamp = { seconds: 1705276800 };
      const result = toDate(timestamp);
      expect(result).toBeInstanceOf(Date);
    });

    it('should convert ISO string', () => {
      const result = toDate('2024-01-15T10:00:00Z');
      expect(result).toBeInstanceOf(Date);
    });

    it('should return null for invalid date string', () => {
      expect(toDate('not-a-date')).toBeNull();
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T12:00:00'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return "剛剛" for time less than 1 minute ago', () => {
      const date = new Date('2024-01-15T11:59:30');
      expect(formatRelativeTime(date)).toBe('剛剛');
    });

    it('should return "即將" for time less than 1 minute in future', () => {
      const date = new Date('2024-01-15T12:00:30');
      expect(formatRelativeTime(date)).toBe('即將');
    });

    it('should format minutes ago', () => {
      const date = new Date('2024-01-15T11:30:00');
      expect(formatRelativeTime(date)).toBe('30 分鐘前');
    });

    it('should format minutes in future', () => {
      const date = new Date('2024-01-15T12:30:00');
      expect(formatRelativeTime(date)).toBe('30 分鐘後');
    });

    it('should format hours ago', () => {
      const date = new Date('2024-01-15T09:00:00');
      expect(formatRelativeTime(date)).toBe('3 小時前');
    });

    it('should format hours in future', () => {
      const date = new Date('2024-01-15T15:00:00');
      expect(formatRelativeTime(date)).toBe('3 小時後');
    });

    it('should format days ago', () => {
      const date = new Date('2024-01-12T12:00:00');
      expect(formatRelativeTime(date)).toBe('3 天前');
    });

    it('should format days in future', () => {
      const date = new Date('2024-01-18T12:00:00');
      expect(formatRelativeTime(date)).toBe('3 天後');
    });

    it('should return formatted date for more than 7 days', () => {
      const date = new Date('2024-01-01T12:00:00');
      const result = formatRelativeTime(date);
      expect(result).toMatch(/\d+/);
    });
  });

  describe('formatCountdown', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T12:00:00'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return expired state for past date', () => {
      const pastDate = new Date('2024-01-14T12:00:00');
      const result = formatCountdown(pastDate);
      expect(result.isExpired).toBe(true);
      expect(result.days).toBe(0);
      expect(result.hours).toBe(0);
      expect(result.minutes).toBe(0);
      expect(result.seconds).toBe(0);
    });

    it('should calculate countdown correctly', () => {
      const futureDate = new Date('2024-01-16T14:30:45');
      const result = formatCountdown(futureDate);
      expect(result.isExpired).toBe(false);
      expect(result.days).toBe(1);
      expect(result.hours).toBe(2);
      expect(result.minutes).toBe(30);
      expect(result.seconds).toBe(45);
    });

    it('should handle same day countdown', () => {
      const futureDate = new Date('2024-01-15T13:30:00');
      const result = formatCountdown(futureDate);
      expect(result.isExpired).toBe(false);
      expect(result.days).toBe(0);
      expect(result.hours).toBe(1);
      expect(result.minutes).toBe(30);
    });
  });

  describe('formatDuration', () => {
    it('should format minutes only', () => {
      expect(formatDuration(30)).toBe('30 分鐘');
    });

    it('should format exact hours', () => {
      expect(formatDuration(60)).toBe('1 小時');
      expect(formatDuration(120)).toBe('2 小時');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(90)).toBe('1 小時 30 分鐘');
      expect(formatDuration(150)).toBe('2 小時 30 分鐘');
    });

    it('should handle zero', () => {
      expect(formatDuration(0)).toBe('0 分鐘');
    });
  });

  describe('isOpenNow', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return true during open hours', () => {
      jest.setSystemTime(new Date('2024-01-15T12:00:00'));
      expect(isOpenNow('09:00', '18:00')).toBe(true);
    });

    it('should return false before open hours', () => {
      jest.setSystemTime(new Date('2024-01-15T08:00:00'));
      expect(isOpenNow('09:00', '18:00')).toBe(false);
    });

    it('should return false after close hours', () => {
      jest.setSystemTime(new Date('2024-01-15T19:00:00'));
      expect(isOpenNow('09:00', '18:00')).toBe(false);
    });

    it('should handle overnight hours (open)', () => {
      jest.setSystemTime(new Date('2024-01-15T23:00:00'));
      expect(isOpenNow('22:00', '02:00')).toBe(true);
    });

    it('should handle overnight hours (after midnight)', () => {
      jest.setSystemTime(new Date('2024-01-15T01:00:00'));
      expect(isOpenNow('22:00', '02:00')).toBe(true);
    });

    it('should handle overnight hours (closed)', () => {
      jest.setSystemTime(new Date('2024-01-15T15:00:00'));
      expect(isOpenNow('22:00', '02:00')).toBe(false);
    });
  });

  describe('getTimeUntilClose', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should calculate minutes until close', () => {
      jest.setSystemTime(new Date('2024-01-15T17:00:00'));
      expect(getTimeUntilClose('18:00')).toBe(60);
    });

    it('should handle close time next day', () => {
      jest.setSystemTime(new Date('2024-01-15T19:00:00'));
      const result = getTimeUntilClose('18:00');
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1048576)).toBe('1 MB');
      expect(formatFileSize(1572864)).toBe('1.5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1073741824)).toBe('1 GB');
    });
  });

  describe('truncateText', () => {
    it('should not truncate short text', () => {
      expect(truncateText('Hello', 10)).toBe('Hello');
    });

    it('should truncate long text with ellipsis', () => {
      expect(truncateText('Hello World', 8)).toBe('Hello...');
    });

    it('should handle exact length', () => {
      expect(truncateText('Hello', 5)).toBe('Hello');
    });

    it('should handle empty string', () => {
      expect(truncateText('', 10)).toBe('');
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    it('should return string', () => {
      expect(typeof generateId()).toBe('string');
    });

    it('should have reasonable length', () => {
      const id = generateId();
      expect(id.length).toBeGreaterThan(5);
    });
  });
});
