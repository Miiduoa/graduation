/* eslint-disable */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Course, CourseSchedule, CalendarEvent } from '../data/types';
import { useAuth } from './auth';
import { getDataSource, hasDataSource } from '../data';
import { getRuntimeDataSourcePolicy } from '../config/runtime';
import { useSchool } from './school';
import { getFirstStorageValue, getScopedStorageKey } from '../services/scopedStorage';
import {
  getCachedCourses,
  getAnyCachedCourses,
  getCachedTCCourses,
  getAnyCachedTCCourses,
} from '../services/puDataCache';
import { isProvidenceSchoolId, toPublicSchoolId } from '../data/schoolIds';
import type { PUCourse } from '../services/puDirectScraper';
import type { TCCourse } from '../services/tronClassClient';

// ===== Types =====

export type ScheduleEvent = {
  id: string;
  courseId?: string;
  title: string;
  location?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  color?: string;
  type: 'class' | 'event' | 'personal';
  instructor?: string;
  courseCode?: string;
};

export type DaySchedule = {
  dayOfWeek: number;
  events: ScheduleEvent[];
};

export type WeekSchedule = {
  [dayOfWeek: number]: ScheduleEvent[];
};

export type ScheduleView = 'week' | 'day' | 'list';

export type ScheduleFilter = {
  showClasses: boolean;
  showEvents: boolean;
  showPersonal: boolean;
};

type ScheduleContextType = {
  schedule: WeekSchedule;
  courses: Course[];
  loading: boolean;
  error: string | null;
  currentSemester: string;
  view: ScheduleView;
  filter: ScheduleFilter;
  selectedDate: Date;

  setCurrentSemester: (semester: string) => void;
  setView: (view: ScheduleView) => void;
  setFilter: (filter: Partial<ScheduleFilter>) => void;
  setSelectedDate: (date: Date) => void;

  addCourse: (course: Course) => Promise<void>;
  removeCourse: (courseId: string) => Promise<void>;
  addPersonalEvent: (event: Omit<ScheduleEvent, 'id' | 'type'>) => Promise<void>;
  removeEvent: (eventId: string) => Promise<void>;

  getDaySchedule: (date: Date) => ScheduleEvent[];
  getWeekSchedule: () => WeekSchedule;
  hasConflict: (event: ScheduleEvent) => boolean;

  refreshSchedule: () => Promise<Course[]>;
  exportToCalendar: () => Promise<CalendarEvent[]>;
};

// ===== Storage Keys =====

const LEGACY_STORAGE_KEYS = {
  COURSES: '@schedule_courses',
  EVENTS: '@schedule_events',
  SEMESTER: '@schedule_semester',
  VIEW: '@schedule_view',
  FILTER: '@schedule_filter',
};

const RUNTIME_DATA_POLICY = getRuntimeDataSourcePolicy();
const SHOULD_SKIP_REMOTE_SCHEDULE_SYNC =
  RUNTIME_DATA_POLICY.requestedMode === 'mock' ||
  (RUNTIME_DATA_POLICY.requestedMode === 'hybrid' && !RUNTIME_DATA_POLICY.hybridPreferRealApi);

function getScheduleStorageKeys(userId: string | null, schoolId: string | null) {
  return {
    COURSES: getScopedStorageKey('schedule-courses', { uid: userId, schoolId }),
    EVENTS: getScopedStorageKey('schedule-events', { uid: userId, schoolId }),
    SEMESTER: getScopedStorageKey('schedule-semester', { uid: userId, schoolId }),
    VIEW: getScopedStorageKey('schedule-view', { uid: userId, schoolId }),
    FILTER: getScopedStorageKey('schedule-filter', { uid: userId, schoolId }),
  };
}

function isDemoCourse(course: Course): boolean {
  const id = String(course.id ?? '');
  const schoolId = String(course.schoolId ?? '');
  return (
    /^(tw-(pu|nchu)|pu)-crs-\d+$/i.test(id) ||
    (/^(tw-(pu|nchu)|pu)$/i.test(schoolId) && /-crs-\d+$/i.test(id))
  );
}

function normalizeScheduleDay(day: number | null | undefined): number | null {
  if (typeof day !== 'number' || !Number.isFinite(day)) return null;
  if (day === 7) return 0;
  if (day >= 0 && day <= 6) return day;
  return null;
}

function parseStoredCourses(raw: string | null): Course[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return SHOULD_SKIP_REMOTE_SCHEDULE_SYNC
      ? parsed.filter((course) => !isDemoCourse(course))
      : parsed;
  } catch (error) {
    console.warn('[Schedule] Failed to parse stored courses:', error);
    return [];
  }
}

// ===== Context =====

const ScheduleContext = createContext<ScheduleContextType | null>(null);

export function useSchedule(): ScheduleContextType {
  const context = useContext(ScheduleContext);
  if (!context) {
    throw new Error('useSchedule must be used within a ScheduleProvider');
  }
  return context;
}

// ===== Helper Functions =====

function getCurrentSemester(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (month >= 8) {
    return `${year}-1`;
  } else if (month >= 2) {
    return `${year - 1}-2`;
  } else {
    return `${year - 1}-1`;
  }
}

function courseToScheduleEvents(course: Course): ScheduleEvent[] {
  return course.schedule.flatMap((schedule, index) => {
    const dayOfWeek = normalizeScheduleDay(schedule.dayOfWeek);
    if (dayOfWeek == null) return [];
    return [
      {
        id: `${course.id}_${index}`,
        courseId: course.id,
        title: course.name,
        location: schedule.location,
        dayOfWeek,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        color: getRandomColor(course.id),
        type: 'class' as const,
        instructor: course.instructor,
        courseCode: course.code,
      },
    ];
  });
}

function getRandomColor(seed: string): string {
  const colors = [
    '#AF52DE',
    '#FF2D55',
    '#FF9500',
    '#34C759',
    '#5856D6',
    '#5856D6',
    '#FF9500',
    '#14B8A6',
    '#A855F7',
    '#FF3B30',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function isTimeOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);

  return s1 < e2 && s2 < e1;
}

// ===== PU / TronClass → Course 轉換 =====

/** 靜宜大學節次 → 時間對照表 */
const PERIOD_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: '08:10', end: '09:00' },
  2: { start: '09:10', end: '10:00' },
  3: { start: '10:10', end: '11:00' },
  4: { start: '11:10', end: '12:00' },
  5: { start: '13:10', end: '14:00' },
  6: { start: '14:10', end: '15:00' },
  7: { start: '15:10', end: '16:00' },
  8: { start: '16:10', end: '17:00' },
  9: { start: '17:10', end: '18:00' },
  10: { start: '18:05', end: '18:55' },
  11: { start: '19:00', end: '19:50' },
  12: { start: '19:55', end: '20:45' },
  13: { start: '20:50', end: '21:40' },
};

function puCourseToCourse(pu: PUCourse, index: number): Course {
  const scheduleEntries: CourseSchedule[] = [];
  const normalizedDay = normalizeScheduleDay(pu.dayOfWeek);

  if (normalizedDay != null) {
    const periods = pu.periods?.length ? pu.periods : [];
    const startPeriod = periods.length > 0 ? Math.min(...periods) : undefined;
    const endPeriod = periods.length > 0 ? Math.max(...periods) : undefined;
    const startTime =
      pu.startTime ?? (startPeriod ? PERIOD_TIMES[startPeriod]?.start : undefined) ?? '08:10';
    const endTime =
      pu.endTime ?? (endPeriod ? PERIOD_TIMES[endPeriod]?.end : undefined) ?? '09:00';

    scheduleEntries.push({
      dayOfWeek: normalizedDay,
      startTime,
      endTime,
      location: pu.location ?? '',
      startPeriod,
      endPeriod,
    });
  }

  return {
    id: `pu_${pu.code}_${index}`,
    code: pu.code,
    name: pu.name,
    instructor: pu.teacherName ?? pu.teacherEmail ?? '',
    credits: pu.credits,
    semester: '',
    schedule: scheduleEntries,
    location: pu.location ?? undefined,
    dayOfWeek: normalizedDay ?? undefined,
    startTime: scheduleEntries[0]?.startTime,
    endTime: scheduleEntries[0]?.endTime,
  };
}

function tcCourseToCourse(tc: TCCourse): Course {
  // TronClass courses don't carry per-timeslot schedule info in the list API,
  // but classroom_schedule might hold it. For now, create a placeholder.
  return {
    id: `tc_${tc.id}`,
    code: tc.course_code ?? '',
    name: tc.name,
    instructor: tc.instructors?.map((i) => i.name).join(', ') ?? '',
    credits: tc.credit ?? 0,
    semester: tc.semester?.name ?? '',
    schedule: [],
  };
}

function canLoadPuScheduleCache(
  selectedSchoolId?: string | null,
  profileSchoolId?: string | null,
): boolean {
  // PU/TronClass cache is Providence-only; never grant it from platform identity alone.
  if (!isProvidenceSchoolId(selectedSchoolId)) return false;
  const profile = typeof profileSchoolId === 'string' ? profileSchoolId.trim() : '';
  return isProvidenceSchoolId(profile);
}

export type LoadCoursesFromCacheOptions = {
  schoolId?: string | null;
  profileSchoolId?: string | null;
};

/** 僅在所選校園與已確認的校務帳號皆為靜宜時讀取 E 校園／TronClass 快取。 */
export async function loadCoursesFromCache(
  options: LoadCoursesFromCacheOptions = {},
): Promise<Course[]> {
  if (!canLoadPuScheduleCache(options.schoolId, options.profileSchoolId)) {
    return [];
  }

  const results: Course[] = [];

  try {
    // Retain offline recovery after the selected and account schools were checked above.
    const puResult = (await getCachedCourses()) ?? (await getAnyCachedCourses());
    if (puResult?.courses?.length) {
      for (let i = 0; i < puResult.courses.length; i++) {
        results.push(puCourseToCourse(puResult.courses[i], i));
      }
      console.log(`[Schedule] Loaded ${puResult.courses.length} PU courses from cache`);
    }
  } catch (e) {
    console.warn('[Schedule] Failed to load PU courses from cache:', e);
  }

  try {
    const tcCourses = (await getCachedTCCourses()) ?? (await getAnyCachedTCCourses());
    if (tcCourses?.length) {
      const existingCodes = new Set(results.map((c) => c.code.toLowerCase()));
      for (const tc of tcCourses) {
        const code = (tc.course_code ?? '').toLowerCase();
        if (!code || !existingCodes.has(code)) {
          results.push(tcCourseToCourse(tc));
          if (code) existingCodes.add(code);
        }
      }
      console.log(`[Schedule] Loaded ${tcCourses.length} TronClass courses from cache`);
    }
  } catch (e) {
    console.warn('[Schedule] Failed to load TronClass courses from cache:', e);
  }

  return results;
}

// ===== Provider =====

type ScheduleProviderProps = {
  children: ReactNode;
};

type ScheduleScopeProviderProps = {
  children: ReactNode;
  userId: string | null;
  schoolId: string | null;
  profileSchoolId: string | null;
};

function ScheduleScopeProvider({
  children,
  userId,
  schoolId,
  profileSchoolId,
}: ScheduleScopeProviderProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [personalEvents, setPersonalEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSemester, setCurrentSemesterState] = useState(getCurrentSemester());
  const [view, setViewState] = useState<ScheduleView>('week');
  const [filter, setFilterState] = useState<ScheduleFilter>({
    showClasses: true,
    showEvents: true,
    showPersonal: true,
  });
  const [selectedDate, setSelectedDate] = useState(new Date());
  const storageKeys = useMemo(
    () => getScheduleStorageKeys(userId, schoolId),
    [userId, schoolId],
  );
  const cacheOptions = useMemo(
    () => ({ schoolId, profileSchoolId }),
    [schoolId, profileSchoolId],
  );

  const isMountedRef = useRef(true);
  const refreshGenerationRef = useRef(0);
  const activeRefreshRef = useRef(0);
  const sourceSchoolRef = useRef(schoolId);
  sourceSchoolRef.current = schoolId;
  const profileSchoolRef = useRef(profileSchoolId);
  if (profileSchoolRef.current !== profileSchoolId) {
    profileSchoolRef.current = profileSchoolId;
    refreshGenerationRef.current += 1;
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, []);

  const isRefreshCurrent = useCallback((generation: number, sourceSchool: string | null) => {
    return (
      isMountedRef.current &&
      refreshGenerationRef.current === generation &&
      sourceSchoolRef.current === sourceSchool &&
      toPublicSchoolId(profileSchoolRef.current) === sourceSchool
    );
  }, []);

  const schedule = useMemo(() => {
    const result: WeekSchedule = {};
    for (let day = 0; day <= 6; day++) {
      result[day] = [];
    }

    if (filter.showClasses) {
      courses.forEach((course) => {
        const events = courseToScheduleEvents(course);
        events.forEach((event) => {
          result[event.dayOfWeek]?.push(event);
        });
      });
    }

    if (filter.showPersonal) {
      personalEvents.forEach((event) => {
        result[event.dayOfWeek]?.push(event);
      });
    }

    Object.keys(result).forEach((day) => {
      result[parseInt(day)].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    });

    return result;
  }, [courses, personalEvents, filter.showClasses, filter.showPersonal]);

  // Private courses/events: scoped keys only. Never import unscoped legacy ownership.
  // View/filter/semester may reuse global convenience prefs.
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      try {
        const [storedCourses, storedEvents, storedSemester, storedView, storedFilter] =
          await Promise.all([
            AsyncStorage.getItem(storageKeys.COURSES),
            AsyncStorage.getItem(storageKeys.EVENTS),
            getFirstStorageValue([storageKeys.SEMESTER, LEGACY_STORAGE_KEYS.SEMESTER]),
            getFirstStorageValue([storageKeys.VIEW, LEGACY_STORAGE_KEYS.VIEW]),
            getFirstStorageValue([storageKeys.FILTER, LEGACY_STORAGE_KEYS.FILTER]),
          ]);

        if (cancelled) return;

        setCourses(parseStoredCourses(storedCourses));
        setPersonalEvents(storedEvents ? JSON.parse(storedEvents) : []);
        setCurrentSemesterState(storedSemester || getCurrentSemester());
        setViewState(storedView ? (storedView as ScheduleView) : 'week');
        setFilterState(
          storedFilter
            ? JSON.parse(storedFilter)
            : {
                showClasses: true,
                showEvents: true,
                showPersonal: true,
              },
        );
      } catch (e) {
        console.error('[Schedule] Failed to load data:', e);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [storageKeys]);

  const hasFetchedRef = useRef(false);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const refreshScheduleRef = useRef<() => Promise<Course[]>>(async () => []);

  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem(storageKeys.COURSES, JSON.stringify(courses)).catch((e) =>
        console.error('[Schedule] Failed to save courses:', e),
      );
    }
  }, [courses, loading, storageKeys.COURSES]);

  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem(storageKeys.EVENTS, JSON.stringify(personalEvents)).catch((e) =>
        console.error('[Schedule] Failed to save events:', e),
      );
    }
  }, [personalEvents, loading, storageKeys.EVENTS]);

  const setCurrentSemester = useCallback(
    async (semester: string) => {
      setCurrentSemesterState(semester);
      await AsyncStorage.setItem(storageKeys.SEMESTER, semester);
    },
    [storageKeys.SEMESTER],
  );

  const setView = useCallback(
    async (newView: ScheduleView) => {
      setViewState(newView);
      await AsyncStorage.setItem(storageKeys.VIEW, newView);
    },
    [storageKeys.VIEW],
  );

  const setFilter = useCallback(
    async (newFilter: Partial<ScheduleFilter>) => {
      setFilterState((prev) => {
        const updated = { ...prev, ...newFilter };
        AsyncStorage.setItem(storageKeys.FILTER, JSON.stringify(updated)).catch((e) =>
          console.error('[Schedule] Failed to save filter:', e),
        );
        return updated;
      });
    },
    [storageKeys.FILTER],
  );

  const addCourse = useCallback(
    async (course: Course) => {
      const events = courseToScheduleEvents(course);
      const hasConflict = events.some((event) => {
        const dayEvents = schedule[event.dayOfWeek] || [];
        return dayEvents.some(
          (existing) =>
            existing.id !== event.id &&
            isTimeOverlap(event.startTime, event.endTime, existing.startTime, existing.endTime),
        );
      });

      if (hasConflict) {
        throw new Error('課程時間有衝突');
      }

      setCourses((prev) => [...prev.filter((c) => c.id !== course.id), course]);
    },
    [schedule],
  );

  const removeCourse = useCallback(async (courseId: string) => {
    setCourses((prev) => prev.filter((c) => c.id !== courseId));
  }, []);

  const addPersonalEvent = useCallback(
    async (event: Omit<ScheduleEvent, 'id' | 'type'>) => {
      const newEvent: ScheduleEvent = {
        ...event,
        id: `personal_${Date.now()}`,
        type: 'personal',
      };

      const dayEvents = schedule[event.dayOfWeek] || [];
      const hasConflict = dayEvents.some((existing) =>
        isTimeOverlap(event.startTime, event.endTime, existing.startTime, existing.endTime),
      );

      if (hasConflict) {
        throw new Error('時間有衝突');
      }

      setPersonalEvents((prev) => [...prev, newEvent]);
    },
    [schedule],
  );

  const removeEvent = useCallback(async (eventId: string) => {
    setPersonalEvents((prev) => prev.filter((e) => e.id !== eventId));
  }, []);

  const getDaySchedule = useCallback(
    (date: Date): ScheduleEvent[] => {
      const dayOfWeek = date.getDay();
      return schedule[dayOfWeek] || [];
    },
    [schedule],
  );

  const getWeekSchedule = useCallback((): WeekSchedule => {
    return schedule;
  }, [schedule]);

  const hasConflict = useCallback(
    (event: ScheduleEvent): boolean => {
      const dayEvents = schedule[event.dayOfWeek] || [];
      return dayEvents.some(
        (existing) =>
          existing.id !== event.id &&
          isTimeOverlap(event.startTime, event.endTime, existing.startTime, existing.endTime),
      );
    },
    [schedule],
  );

  const refreshSchedule = useCallback(async (): Promise<Course[]> => {
    const sourceSchool = schoolId;
    const generation = ++refreshGenerationRef.current;

    if (!userId || !schoolId || toPublicSchoolId(profileSchoolId) !== schoolId) return courses;
    activeRefreshRef.current = generation;

    const applyCourses = (next: Course[]): Course[] => {
      if (!isRefreshCurrent(generation, sourceSchool)) return courses;
      setCourses(next);
      return next;
    };

    if (SHOULD_SKIP_REMOTE_SCHEDULE_SYNC) {
      const cachedCourses = await loadCoursesFromCache(cacheOptions);
      if (!isRefreshCurrent(generation, sourceSchool)) return courses;
      if (cachedCourses.length > 0) {
        return applyCourses(cachedCourses);
      }
      const filtered = courses.filter((course) => !isDemoCourse(course));
      return applyCourses(filtered);
    }

    if (isRefreshCurrent(generation, sourceSchool)) {
      setLoading(true);
      setError(null);
    }

    try {
      if (!hasDataSource()) {
        console.warn('[Schedule] DataSource not set, trying puDataCache...');
        const cachedCourses = await loadCoursesFromCache(cacheOptions);
        if (!isRefreshCurrent(generation, sourceSchool)) return courses;
        if (cachedCourses.length > 0) {
          return applyCourses(cachedCourses);
        }
        return courses;
      }

      const ds = getDataSource();
      const enrollments = await ds.listEnrollments(
        userId,
        currentSemester,
        schoolId ?? undefined,
      );
      if (!isRefreshCurrent(generation, sourceSchool)) return courses;

      const enrolledCourses: Course[] = [];
      for (const enrollment of enrollments) {
        if (enrollment.status === 'enrolled' &&
          (!enrollment.schoolId || toPublicSchoolId(enrollment.schoolId) === sourceSchool)) {
          const course = await ds.getCourse(enrollment.courseId, schoolId ?? undefined);
          if (!isRefreshCurrent(generation, sourceSchool)) return courses;
          if (course && (!course.schoolId || toPublicSchoolId(course.schoolId) === sourceSchool)) {
            enrolledCourses.push(course);
          }
        }
      }

      if (!isRefreshCurrent(generation, sourceSchool)) return courses;

      if (enrolledCourses.length > 0) {
        return applyCourses(enrolledCourses);
      }

      console.log('[Schedule] No enrollments from DataSource, trying puDataCache...');
      const cachedCourses = await loadCoursesFromCache(cacheOptions);
      if (!isRefreshCurrent(generation, sourceSchool)) return courses;
      if (cachedCourses.length > 0) {
        console.log(`[Schedule] Loaded ${cachedCourses.length} courses from puDataCache`);
        return applyCourses(cachedCourses);
      }
      return applyCourses([]);
    } catch (e) {
      if (!isRefreshCurrent(generation, sourceSchool)) return courses;
      console.error('[Schedule] Failed to fetch courses:', e);
      try {
        const cachedCourses = await loadCoursesFromCache(cacheOptions);
        if (!isRefreshCurrent(generation, sourceSchool)) return courses;
        if (cachedCourses.length > 0) {
          console.log(`[Schedule] Fallback: loaded ${cachedCourses.length} courses from cache`);
          setError(null);
          return applyCourses(cachedCourses);
        }
      } catch (_) {
        /* ignore */
      }
      if (isRefreshCurrent(generation, sourceSchool)) {
        setError(e instanceof Error ? e.message : '刷新失敗');
      }
      return courses;
    } finally {
      if (isMountedRef.current && activeRefreshRef.current === generation) {
        setLoading(false);
      }
    }
  }, [userId, currentSemester, schoolId, profileSchoolId, courses, cacheOptions, isRefreshCurrent]);

  useEffect(() => {
    refreshScheduleRef.current = refreshSchedule;
  }, [refreshSchedule]);

  useEffect(() => {
    hasFetchedRef.current = false;
  }, [profileSchoolId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    if (SHOULD_SKIP_REMOTE_SCHEDULE_SYNC) {
      hasFetchedRef.current = true;
      return;
    }

    // Await confirmed matching canonical profile before consuming the one-shot.
    // Late profile arrival / revocation is fenced via deps + isRefreshCurrent.
    if (!schoolId || toPublicSchoolId(profileSchoolId) !== schoolId) {
      return;
    }

    if (!loading && courses.length === 0 && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchAbortRef.current = new AbortController();

      (async () => {
        try {
          await refreshScheduleRef.current();
        } catch (error) {
          if (isMountedRef.current) {
            console.warn('[Schedule] Auto-fetch failed:', error);
          }
        } finally {
          fetchAbortRef.current = null;
        }
      })();
    }

    return () => {
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
        fetchAbortRef.current = null;
      }
    };
  }, [userId, loading, courses.length, schoolId, profileSchoolId]);

  const exportToCalendar = useCallback(async (): Promise<CalendarEvent[]> => {
    const calendarEvents: CalendarEvent[] = [];

    Object.values(schedule)
      .flat()
      .forEach((event) => {
        calendarEvents.push({
          id: event.id,
          userId: userId || '',
          title: event.title,
          description: event.courseCode ? `${event.courseCode} - ${event.instructor}` : undefined,
          startAt: event.startTime,
          endAt: event.endTime,
          location: event.location,
          color: event.color,
          type: event.type === 'class' ? 'class' : 'personal',
          sourceId: event.courseId,
          sourceType: event.courseId ? 'course' : 'custom',
          recurrence: {
            frequency: 'weekly',
            byDays: [event.dayOfWeek],
          },
        });
      });

    return calendarEvents;
  }, [schedule, userId]);

  const contextValue = useMemo(
    () => ({
      schedule,
      courses,
      loading,
      error,
      currentSemester,
      view,
      filter,
      selectedDate,
      setCurrentSemester,
      setView,
      setFilter,
      setSelectedDate,
      addCourse,
      removeCourse,
      addPersonalEvent,
      removeEvent,
      getDaySchedule,
      getWeekSchedule,
      hasConflict,
      refreshSchedule,
      exportToCalendar,
    }),
    [
      schedule,
      courses,
      loading,
      error,
      currentSemester,
      view,
      filter,
      selectedDate,
      setCurrentSemester,
      setView,
      setFilter,
      setSelectedDate,
      addCourse,
      removeCourse,
      addPersonalEvent,
      removeEvent,
      getDaySchedule,
      getWeekSchedule,
      hasConflict,
      refreshSchedule,
      exportToCalendar,
    ],
  );

  return <ScheduleContext.Provider value={contextValue}>{children}</ScheduleContext.Provider>;
}

/** Public export: remounts scoped state on canonical school + Firebase account change. */
export function ScheduleProvider({ children }: ScheduleProviderProps) {
  const { user, profile } = useAuth();
  const { school, schoolId } = useSchool();
  const canonicalSchoolId = toPublicSchoolId(school?.id ?? schoolId) ?? null;
  const accountId = user?.uid ?? null;
  const scopeKey = `${canonicalSchoolId ?? 'default'}:${accountId ?? 'anonymous'}`;

  return (
    <ScheduleScopeProvider
      key={scopeKey}
      userId={accountId}
      schoolId={canonicalSchoolId}
      profileSchoolId={profile?.uid === user?.uid ? profile?.schoolId ?? null : null}
    >
      {children}
    </ScheduleScopeProvider>
  );
}
