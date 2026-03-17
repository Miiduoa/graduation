import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Course, CourseSchedule, CalendarEvent } from "../data/types";
import { useAuth } from "./auth";
import { getDataSource, hasDataSource } from "../data";
import { useSchool } from "./school";

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
  type: "class" | "event" | "personal";
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

export type ScheduleView = "week" | "day" | "list";

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
  addPersonalEvent: (event: Omit<ScheduleEvent, "id" | "type">) => Promise<void>;
  removeEvent: (eventId: string) => Promise<void>;
  
  getDaySchedule: (date: Date) => ScheduleEvent[];
  getWeekSchedule: () => WeekSchedule;
  hasConflict: (event: ScheduleEvent) => boolean;
  
  refreshSchedule: () => Promise<void>;
  exportToCalendar: () => Promise<CalendarEvent[]>;
};

// ===== Storage Keys =====

const STORAGE_KEYS = {
  COURSES: "@schedule_courses",
  EVENTS: "@schedule_events",
  SEMESTER: "@schedule_semester",
  VIEW: "@schedule_view",
  FILTER: "@schedule_filter",
};

// ===== Context =====

const ScheduleContext = createContext<ScheduleContextType | null>(null);

export function useSchedule(): ScheduleContextType {
  const context = useContext(ScheduleContext);
  if (!context) {
    throw new Error("useSchedule must be used within a ScheduleProvider");
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
  return course.schedule.map((schedule, index) => ({
    id: `${course.id}_${index}`,
    courseId: course.id,
    title: course.name,
    location: schedule.location,
    dayOfWeek: schedule.dayOfWeek,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    color: getRandomColor(course.id),
    type: "class" as const,
    instructor: course.instructor,
    courseCode: course.code,
  }));
}

function getRandomColor(seed: string): string {
  const colors = [
    "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#3B82F6",
    "#6366F1", "#F97316", "#14B8A6", "#A855F7", "#EF4444",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function isTimeOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  
  return s1 < e2 && s2 < e1;
}

// ===== Provider =====

type ScheduleProviderProps = {
  children: ReactNode;
};

export function ScheduleProvider({ children }: ScheduleProviderProps) {
  const { user } = useAuth();
  const { schoolId } = useSchool();
  
  const [courses, setCourses] = useState<Course[]>([]);
  const [personalEvents, setPersonalEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSemester, setCurrentSemesterState] = useState(getCurrentSemester());
  const [view, setViewState] = useState<ScheduleView>("week");
  const [filter, setFilterState] = useState<ScheduleFilter>({
    showClasses: true,
    showEvents: true,
    showPersonal: true,
  });
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  // 追蹤元件是否已卸載
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 修復：使用 useMemo 避免每次 render 都重建 schedule 物件
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

    // Sort each day by start time
    Object.keys(result).forEach((day) => {
      result[parseInt(day)].sort((a, b) => 
        timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
      );
    });
    
    return result;
  }, [courses, personalEvents, filter.showClasses, filter.showPersonal]);

  // Load saved data
  useEffect(() => {
    async function loadData() {
      try {
        const [
          storedCourses,
          storedEvents,
          storedSemester,
          storedView,
          storedFilter,
        ] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.COURSES),
          AsyncStorage.getItem(STORAGE_KEYS.EVENTS),
          AsyncStorage.getItem(STORAGE_KEYS.SEMESTER),
          AsyncStorage.getItem(STORAGE_KEYS.VIEW),
          AsyncStorage.getItem(STORAGE_KEYS.FILTER),
        ]);

        if (storedCourses) setCourses(JSON.parse(storedCourses));
        if (storedEvents) setPersonalEvents(JSON.parse(storedEvents));
        if (storedSemester) setCurrentSemesterState(storedSemester);
        if (storedView) setViewState(storedView as ScheduleView);
        if (storedFilter) setFilterState(JSON.parse(storedFilter));
      } catch (e) {
        console.error("[Schedule] Failed to load data:", e);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // Auto-fetch courses from server when user logs in
  // 使用 ref 追蹤是否已經嘗試過獲取，避免重複請求
  const hasFetchedRef = useRef(false);
  const previousUserRef = useRef<string | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const refreshScheduleRef = useRef<() => Promise<void>>(async () => {});
  
  useEffect(() => {
    const currentUserId = user?.uid ?? null;
    const userChanged = previousUserRef.current !== currentUserId;
    previousUserRef.current = currentUserId;
    
    // 用戶改變時重置
    if (userChanged && !currentUserId) {
      hasFetchedRef.current = false;
      // 中止任何正在進行的請求
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
        fetchAbortRef.current = null;
      }
      return;
    }
    
    // 只有在用戶登入、載入完成、沒有課程且未獲取過時才獲取
    if (currentUserId && !loading && courses.length === 0 && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      
      // 創建新的 AbortController 用於追蹤請求
      fetchAbortRef.current = new AbortController();
      
      // 使用 IIFE 處理非同步操作並正確捕獲錯誤
      (async () => {
        try {
          await refreshScheduleRef.current();
        } catch (error) {
          // refreshSchedule 內部已經處理了錯誤，這裡只需要記錄
          if (isMountedRef.current) {
            console.warn("[Schedule] Auto-fetch failed:", error);
          }
        } finally {
          fetchAbortRef.current = null;
        }
      })();
    }
    
    // 清理函數：元件卸載或依賴變化時中止請求
    return () => {
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort();
        fetchAbortRef.current = null;
      }
    };
  }, [user?.uid, loading, courses.length]);

  // Save courses when changed
  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(courses)).catch(
        (e) => console.error("[Schedule] Failed to save courses:", e)
      );
    }
  }, [courses, loading]);

  // Save personal events when changed
  useEffect(() => {
    if (!loading) {
      AsyncStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(personalEvents)).catch(
        (e) => console.error("[Schedule] Failed to save events:", e)
      );
    }
  }, [personalEvents, loading]);

  const setCurrentSemester = useCallback(async (semester: string) => {
    setCurrentSemesterState(semester);
    await AsyncStorage.setItem(STORAGE_KEYS.SEMESTER, semester);
  }, []);

  const setView = useCallback(async (newView: ScheduleView) => {
    setViewState(newView);
    await AsyncStorage.setItem(STORAGE_KEYS.VIEW, newView);
  }, []);

  const setFilter = useCallback(async (newFilter: Partial<ScheduleFilter>) => {
    setFilterState((prev) => {
      const updated = { ...prev, ...newFilter };
      AsyncStorage.setItem(STORAGE_KEYS.FILTER, JSON.stringify(updated)).catch(
        (e) => console.error("[Schedule] Failed to save filter:", e)
      );
      return updated;
    });
  }, []);

  const addCourse = useCallback(async (course: Course) => {
    const events = courseToScheduleEvents(course);
    const hasConflict = events.some((event) => {
      const dayEvents = schedule[event.dayOfWeek] || [];
      return dayEvents.some(
        (existing) =>
          existing.id !== event.id &&
          isTimeOverlap(
            event.startTime,
            event.endTime,
            existing.startTime,
            existing.endTime
          )
      );
    });

    if (hasConflict) {
      throw new Error("課程時間有衝突");
    }

    setCourses((prev) => [...prev.filter((c) => c.id !== course.id), course]);
  }, [schedule]);

  const removeCourse = useCallback(async (courseId: string) => {
    setCourses((prev) => prev.filter((c) => c.id !== courseId));
  }, []);

  const addPersonalEvent = useCallback(
    async (event: Omit<ScheduleEvent, "id" | "type">) => {
      const newEvent: ScheduleEvent = {
        ...event,
        id: `personal_${Date.now()}`,
        type: "personal",
      };

      const dayEvents = schedule[event.dayOfWeek] || [];
      const hasConflict = dayEvents.some((existing) =>
        isTimeOverlap(
          event.startTime,
          event.endTime,
          existing.startTime,
          existing.endTime
        )
      );

      if (hasConflict) {
        throw new Error("時間有衝突");
      }

      setPersonalEvents((prev) => [...prev, newEvent]);
    },
    [schedule]
  );

  const removeEvent = useCallback(async (eventId: string) => {
    setPersonalEvents((prev) => prev.filter((e) => e.id !== eventId));
  }, []);

  const getDaySchedule = useCallback(
    (date: Date): ScheduleEvent[] => {
      const dayOfWeek = date.getDay();
      return schedule[dayOfWeek] || [];
    },
    [schedule]
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
          isTimeOverlap(
            event.startTime,
            event.endTime,
            existing.startTime,
            existing.endTime
          )
      );
    },
    [schedule]
  );

  const refreshSchedule = useCallback(async () => {
    if (!user?.uid) return;
    
    setLoading(true);
    setError(null);
    
    try {
      if (!hasDataSource()) {
        console.warn("[Schedule] DataSource not set, skipping server fetch");
        return;
      }
      
      const ds = getDataSource();
      
      const enrollments = await ds.listEnrollments(user.uid, currentSemester);
      const enrolledCourses: Course[] = [];
      
      for (const enrollment of enrollments) {
        if (enrollment.status === "enrolled") {
          const course = await ds.getCourse(enrollment.courseId);
          if (course) {
            enrolledCourses.push(course);
          }
        }
      }
      
      // 檢查元件是否仍然掛載
      if (!isMountedRef.current) return;
      
      if (enrolledCourses.length > 0) {
        setCourses(enrolledCourses);
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      console.error("[Schedule] Failed to fetch courses:", e);
      setError(e instanceof Error ? e.message : "刷新失敗");
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user?.uid, currentSemester]);

  useEffect(() => {
    refreshScheduleRef.current = refreshSchedule;
  }, [refreshSchedule]);

  const exportToCalendar = useCallback(async (): Promise<CalendarEvent[]> => {
    const calendarEvents: CalendarEvent[] = [];
    
    Object.values(schedule).flat().forEach((event) => {
      calendarEvents.push({
        id: event.id,
        userId: user?.uid || "",
        title: event.title,
        description: event.courseCode ? `${event.courseCode} - ${event.instructor}` : undefined,
        startAt: event.startTime,
        endAt: event.endTime,
        location: event.location,
        color: event.color,
        type: event.type === "class" ? "class" : "personal",
        sourceId: event.courseId,
        sourceType: event.courseId ? "course" : "custom",
        recurrence: {
          frequency: "weekly",
          byDays: [event.dayOfWeek],
        },
      });
    });

    return calendarEvents;
  }, [schedule, user]);

  // 使用 useMemo 確保 context value 穩定
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
    ]
  );

  return (
    <ScheduleContext.Provider value={contextValue}>
      {children}
    </ScheduleContext.Provider>
  );
}
