import type { PeriodProfileId } from '../timetable/schoolPeriods';

export type PersonalImportKind = 'timetable' | 'grades' | 'events';

export type PersonalImportSource = {
  type: 'paste' | 'file' | 'screenshot';
  name?: string;
  /** One-based source line. Source images themselves are not retained. */
  line: number;
  rawText: string;
};

/** An editable personal draft. Missing values stay missing until the user supplies them. */
export type PersonalImportRow = {
  id: string;
  kind: PersonalImportKind;
  title: string;
  schoolId: string;
  academicYear: string;
  semester: string;
  courseCode?: string;
  teacher?: string;
  className?: string;
  location?: string;
  dayOfWeek?: number;
  startPeriod?: number;
  endPeriod?: number;
  /** Original school period notation when it is not a mapped grid slot. */
  periodLabel?: string;
  startTime?: string;
  endTime?: string;
  credits?: number;
  /** Preserves numeric, letter, and pass/fail grades without estimating earned credits. */
  grade?: string;
  date?: string;
  /** For all-day events, endDate is exclusive, matching iCalendar semantics. */
  endDate?: string;
  allDay?: boolean;
  /** Personal reference only. Never constitutes membership or instructor authority. */
  linkedCourseId?: string;
  source: PersonalImportSource;
};

export type ImportIssue = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  rowId?: string;
  field?: keyof PersonalImportRow;
};

export type PersonalImportOptions = {
  kind: PersonalImportKind;
  schoolId: string;
  academicYear: string;
  semester: string;
  source?: Pick<PersonalImportSource, 'type' | 'name'>;
  /** School weekday/period grid used to map paste/screenshot text into slots. */
  periodProfile?: PeriodProfileId;
};

export type PersonalImportRecord = PersonalImportRow & {
  classExceptions?: ClassException[];
  batchId: string;
  importedAt: string;
};

export type PersonalImportCatalogCourse = {
  id: string;
  title: string;
  schoolId: string;
  academicYear: string;
  semester: string;
  courseCode?: string;
  teacher?: string;
  className?: string;
  /** Set only from a trusted catalog, never from uploaded/OCR data. */
  verified: boolean;
};

export const PERSONAL_IMPORT_MAX_ROWS = 500;
export const PERSONAL_IMPORT_MAX_TEXT_LENGTH = 200_000;

export type ClassException = {
  id: string;
  courseKey: string;
  originalDate: string;
  kind: 'cancel' | 'move' | 'room';
  date?: string;
  startTime?: string;
  endTime?: string;
  endDate?: string;
  location?: string;
  createdAt: string;
  original: PersonalImportRecord;
};
