import { PROVIDENCE_UNIVERSITY_SCHOOL_ID, type PuCreditAuditPayload } from '@campus/shared/src';
import { BaseApiAdapter } from './BaseAdapter';
import type { AdapterCapabilities, AuthCredentials } from './types';
import type {
  Announcement,
  ClubEvent,
  MenuItem,
  Poi,
  Course,
  Grade,
  CourseSpace,
  CourseModule,
  CourseMaterial,
  InboxTask,
  Quiz,
  AttendanceSession,
  AttendanceSummary,
} from '../types';
import { CAMPUS_POIS, getCampusPoi, type CampusPoi, type CampusPoiCategory } from '../puCampusData';
import { puLogin, type PUSession, type PUCourseResult } from '../../services/puDirectScraper';
import {
  getCachedCourses,
  getCachedGrades,
  getCachedAnnouncements,
  getAnyCachedCourses,
  getAnyCachedGrades,
  getAnyCachedAnnouncements,
  refreshCourses,
  refreshCreditAudit,
  refreshAnnouncements,
  seedCachedCourses,
  seedCachedAnnouncements,
  getCachedTCCourses,
  getCachedTCActivities,
  getCachedTCModules,
  getCachedTCAttendance,
  getCachedTCTodos,
  getAnyCachedTCCourses,
  getAnyCachedTCActivities,
  getAnyCachedTCModules,
  getAnyCachedTCTodos,
  getAnyCachedTCAttendance,
  refreshTCCourses,
  refreshTCActivitiesForCourses,
  refreshTCModulesForCourses,
  refreshTCAttendance,
  refreshTCTodos,
} from '../../services/puDataCache';
import type { TCCourse, TCActivity, TCModule, TCAttendance } from '../../services/tronClassClient';
import { getCloudFunctionUrl, getFirebaseAuthHeaders } from '../../services/cloudFunctions';
import { getAuthInstance } from '../../firebase';
import { loadOwnedSchoolGrades } from '../../services/ownedSchoolAcademicRecords';
import {
  PU_GRADE_POINT_POLICY,
  convertPuPercentScoreToGradePoint,
} from './puGradePointPolicy';

export { PU_GRADE_POINT_POLICY, convertPuPercentScoreToGradePoint };

type AnnouncementResponse = {
  success: boolean;
  announcements: Array<{ title: string; url: string; date: string }>;
};

type CourseResponse = Omit<PUCourseResult, 'studentInfo'> & {
  success: boolean;
  studentInfo: {
    class: string | null;
    studentId: string | null;
    name: string | null;
    department?: string | null;
    grade?: string | null;
    enrollmentStatus?: string | null;
  };
};

function toValidDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isExpectedWebBackendSessionMiss(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Web 版需要後端 TronClass session');
}

/**
 * 靜宜百分制 → 4.3 制績點（相容既有匯出；無效分數回傳 0，mapper 請改用 convertPuPercentScoreToGradePoint）。
 * 對照表見 puGradePointPolicy（學則 PU-101B0-B-0101-2026020901）。
 */
export function puScoreToGradePoint(score: number): number {
  return convertPuPercentScoreToGradePoint(score) ?? 0;
}

type PuGradeItem = {
  semester: string;
  courseName: string;
  courseNameEn?: string;
  className?: string;
  class?: string;
  courseType?: string;
  credits: number;
  score: number | string;
};

/**
 * 將校務成績列綁定 adapter 權威 schoolId 與來源語意。
 * 不捏造 publishedAt；userId 沿用呼叫端傳入的學號／uid。
 */
export function mapPuOfficialGrades(
  items: PuGradeItem[],
  args: {
    studentId: string;
    schoolId: string;
    gradeSource: 'school-official' | 'school-official-offline';
    semester?: string;
  },
): Grade[] {
  const rows = args.semester ? items.filter((g) => g.semester === args.semester) : items;
  return rows.map((item, i): Grade => {
    const rawScore = typeof item.score === 'string' ? item.score.trim() : item.score;
    const parsedScore = typeof rawScore === 'number' ? rawScore
      : typeof rawScore === 'string' && rawScore !== '' ? Number(rawScore) : NaN;
    const score = Number.isFinite(parsedScore) ? parsedScore : undefined;
    const converted =
      score === undefined ? null : convertPuPercentScoreToGradePoint(score);
    return {
      id: `pu-grade-${item.semester}-${i}`,
      courseId: `pu-crs-${item.semester}-${i}`,
      courseName: item.courseName,
      credits: item.credits,
      grade: score,
      gradePoint: converted ?? undefined,
      gradePointScale:
        converted === null ? undefined : PU_GRADE_POINT_POLICY.gradePointScale,
      gradePointProvenance: converted === null ? undefined : 'local-reference',
      score,
      letterGrade: score === undefined && typeof rawScore === 'string' ? rawScore : undefined,
      semester: item.semester,
      userId: args.studentId,
      schoolId: args.schoolId,
      gradeSource: args.gradeSource,
      courseType: item.courseType || undefined,
      courseClass: item.className || item.class || undefined,
      courseNameEn: item.courseNameEn || undefined,
    };
  });
}

/**
 * Providence University (靜宜大學) adapter
 *
 * 雙模式：
 *   1. 有 Firebase → 透過 Cloud Functions proxy 抓資料
 *   2. 無 Firebase → 直接從 app 連 alcat.pu.edu.tw / mypu.pu.edu.tw
 *
 * Verified against live pages on 2026-03-24.
 */
export class PUAdapter extends BaseApiAdapter {
  readonly schoolId = 'tw-pu';
  readonly schoolName = '靜宜大學';
  readonly apiVersion = '1.0';

  private sessionId: string | null = null;
  private studentId: string | null = null;
  private studentName: string | null = null;

  /** Direct scraping session (no-Firebase mode) */
  private directSession: PUSession | null = null;

  private get useDirectMode(): boolean {
    // Prefer backend campus proxy whenever a server-side session is available.
    // Direct mode is only for local fallback when no backend campus session exists.
    return !this.sessionId;
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async authenticate(username: string, password: string): Promise<AuthCredentials> {
    // ── Direct mode: 直接連靜宜伺服器 ──
    if (this.useDirectMode) {
      const result = await puLogin(username, password);
      if (!result.success || !result.session) {
        throw new Error(result.error ?? '靜宜大學登入失敗');
      }

      this.directSession = result.session;
      this.studentId = username;
      this.studentName = result.session.studentName;

      this.credentials = {
        accessToken: `pu-direct-${Date.now()}`,
        userId: username,
        studentId: username,
      };
      return this.credentials;
    }

    // ── Cloud Functions mode ──
    try {
      const response = await fetch(getCloudFunctionUrl('puAuthenticate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: { uid: username, upassword: password },
        }),
      });

      if (!response.ok) {
        throw new Error(`Authentication failed: ${response.statusText}`);
      }

      const result = (await response.json()) as {
        result: {
          success: boolean;
          sessionId?: string;
          studentName?: string;
          error?: string;
        };
      };

      const data = result.result;

      if (!data.success) {
        throw new Error(data.error || '登入失敗');
      }

      this.sessionId = data.sessionId || null;
      this.studentId = username;
      this.studentName = data.studentName || null;

      this.credentials = {
        accessToken: this.sessionId || `pu-session-${Date.now()}`,
        userId: username,
        studentId: username,
      };

      return this.credentials;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '靜宜大學登入失敗');
    }
  }

  async logout(): Promise<void> {
    this.credentials = null;
    this.sessionId = null;
    this.studentId = null;
    this.studentName = null;
    this.directSession = null;
  }

  /** 取得直接 scraping session（供外部存取） */
  getDirectSession(): PUSession | null {
    return this.directSession;
  }

  /** 設定直接 scraping session（登入後注入） */
  setDirectSession(session: PUSession, studentId: string): void {
    this.directSession = session;
    this.studentId = studentId;
    this.studentName = session.studentName;
    this.credentials = {
      accessToken: `pu-direct-${Date.now()}`,
      userId: studentId,
      studentId,
    };
  }

  setBackendSession(
    sessionId: string,
    studentId?: string | null,
    studentName?: string | null,
  ): void {
    this.sessionId = sessionId.trim() || null;
    if (studentId) {
      this.studentId = studentId;
    }
    if (studentName) {
      this.studentName = studentName;
    }
    this.directSession = null;
    this.credentials = {
      accessToken: this.sessionId || `pu-backend-${Date.now()}`,
      userId: this.studentId ?? undefined,
      studentId: this.studentId ?? undefined,
    };
  }

  /**
   * E校園課程 → TCCourse 格式轉換（TronClass 不可用時的 fallback）
   */
  private convertPUCoursesToTC(
    puCourses: import('../../services/puDirectScraper').PUCourse[],
  ): TCCourse[] {
    return puCourses.map((c, index) => ({
      id: -(index + 1), // 負數 ID 表示來自 E校園
      name: c.name || c.nameEn || c.code,
      course_code: c.code,
      department: null,
      instructors: c.teacherName ? [{ id: 0, name: c.teacherName }] : [],
      credit: c.credits,
      semester: null,
      klass: null,
      grade: null,
      course_outline: null,
      start_date: null,
      end_date: null,
      status: 'ongoing',
      role: 'student',
      student_count: 0,
      classroom_schedule: c.timePlaceRaw || null,
    }));
  }

  private async ensureTCCourses(): Promise<TCCourse[]> {
    const cached = await getCachedTCCourses();
    if (cached) return cached;

    const stale = await getAnyCachedTCCourses();
    try {
      return (await refreshTCCourses()) ?? stale ?? [];
    } catch (error) {
      if (stale) {
        const logger = isExpectedWebBackendSessionMiss(error) ? console.debug : console.warn;
        logger('[PUAdapter] Falling back to stale TronClass courses:', error);
        return stale;
      }
      // TronClass 完全不可用 → 嘗試用 E校園 課表資料
      const logger = isExpectedWebBackendSessionMiss(error) ? console.debug : console.warn;
      logger('[PUAdapter] TronClass unavailable, trying E-campus courses fallback:', error);
      try {
        const puData = (await getCachedCourses()) ?? (await getAnyCachedCourses());
        if (puData?.courses?.length) {
          console.log(
            '[PUAdapter] Using E-campus courses as fallback:',
            puData.courses.length,
            'courses',
          );
          return this.convertPUCoursesToTC(puData.courses);
        }
      } catch {
        /* ignore */
      }
      return []; // 不 throw，讓畫面顯示空狀態而非錯誤
    }
  }

  private async ensureTCActivitiesMap(courseIds: number[]): Promise<Record<number, TCActivity[]>> {
    const cached = await getCachedTCActivities();
    if (cached) return cached;

    const stale = await getAnyCachedTCActivities();
    try {
      return await refreshTCActivitiesForCourses(courseIds);
    } catch (error) {
      if (stale) {
        console.warn('[PUAdapter] Falling back to stale TronClass activities:', error);
        return stale;
      }
      throw error;
    }
  }

  private async ensureTCModulesMap(courseIds: number[]): Promise<Record<number, TCModule[]>> {
    const cached = await getCachedTCModules();
    if (cached) return cached;

    const stale = await getAnyCachedTCModules();
    try {
      return await refreshTCModulesForCourses(courseIds);
    } catch (error) {
      if (stale) {
        console.warn('[PUAdapter] Falling back to stale TronClass modules:', error);
        return stale;
      }
      throw error;
    }
  }

  private async ensureTCTodos(): Promise<TCActivity[]> {
    const cached = await getCachedTCTodos();
    if (cached) return cached;

    const stale = await getAnyCachedTCTodos();
    try {
      return (await refreshTCTodos()) ?? stale ?? [];
    } catch (error) {
      if (stale) {
        console.warn('[PUAdapter] Falling back to stale TronClass todos:', error);
        return stale;
      }
      throw error;
    }
  }

  private async ensureTCAttendance(): Promise<TCAttendance[]> {
    const cached = await getCachedTCAttendance();
    if (cached) return cached;

    const stale = await getAnyCachedTCAttendance();
    try {
      return (await refreshTCAttendance()) ?? stale ?? [];
    } catch (error) {
      if (stale) {
        console.warn('[PUAdapter] Falling back to stale TronClass attendance:', error);
        return stale;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Data fetching helper (Cloud Functions mode only)
  // ---------------------------------------------------------------------------

  private async fetchData<T>(
    dataType: string,
    extra: Record<string, unknown> = {},
  ): Promise<T | null> {
    if (!this.sessionId) {
      console.warn(`[PUAdapter] No session for ${dataType}`);
      return null;
    }

    try {
      const response = await fetch(getCloudFunctionUrl('puFetchCampusData'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getFirebaseAuthHeaders()) },
        body: JSON.stringify({
          sessionId: this.sessionId,
          dataType,
          ...extra,
        }),
      });

      if (!response.ok) {
        console.warn(`[PUAdapter] puFetchCampusData(${dataType}) HTTP ${response.status}`);
        return null;
      }

      const result = (await response.json()) as { success?: boolean; result?: T };
      return result.result ?? null;
    } catch (error) {
      console.warn(`[PUAdapter] puFetchCampusData(${dataType}) error:`, error);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Announcements
  // ---------------------------------------------------------------------------

  private mapAnnouncements(
    items: Array<{ title: string; url: string; date: string }>,
  ): Announcement[] {
    return items.map(
      (item, i): Announcement => ({
        id: `pu-ann-${i}-${item.title.slice(0, 10)}`,
        title: item.title,
        body: item.url,
        publishedAt: new Date(item.date).toISOString(),
        source: '靜宜大學 e校園',
      }),
    );
  }

  async listAnnouncements(): Promise<Announcement[]> {
    console.log(`[PUAdapter] listAnnouncements called — mode=${this.useDirectMode ? "direct" : "backend"}, sessionId=${!!this.sessionId}`);
    // ── 1. 快取優先（所有模式都先讀快取） ──
    const cached = await getCachedAnnouncements();
    if (cached && cached.length > 0) {
      console.log(`[PUAdapter] listAnnouncements → PU cache hit: ${cached.length} items`);
      return this.mapAnnouncements(cached);
    }
    console.log(`[PUAdapter] listAnnouncements → PU cache miss`);

    // ── 2. 快取過期或空 → 嘗試遠端抓取 ──
    try {
      if (this.useDirectMode && this.directSession) {
        const fresh = await refreshAnnouncements(this.directSession);
        if (fresh && fresh.length > 0) return this.mapAnnouncements(fresh);
      } else if (!this.useDirectMode) {
        const data = await this.fetchData<AnnouncementResponse>("announcements");
        if (data?.success && data.announcements?.length > 0) {
          const items = data.announcements.map((a) => ({ title: a.title, url: a.url, date: a.date }));
          await seedCachedAnnouncements(items).catch(() => {});
          return this.mapAnnouncements(items);
        }
      }
    } catch (err) {
      console.warn("[PUAdapter] listAnnouncements remote fetch failed:", err);
    }

    // ── 3. 遠端失敗 → 讀任何快取（離線模式） ──
    const stale = await getAnyCachedAnnouncements();
    if (stale && stale.length > 0) return this.mapAnnouncements(stale);

    const data = await this.fetchData<AnnouncementResponse>('announcements');
    if (!data?.success) return [];

    return data.announcements.map(
      (item, i): Announcement => ({
        id: `pu-ann-${i}-${Date.now()}`,
        title: item.title,
        body: item.url,
        publishedAt: new Date(item.date).toISOString(),
        source: '靜宜大學 e校園',
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Events (not available via scraping)
  // ---------------------------------------------------------------------------

  async listEvents(): Promise<ClubEvent[]> {
    return [];
  }

  // ---------------------------------------------------------------------------
  // Courses
  // ---------------------------------------------------------------------------

  private mapCourses(
    data: import('../../services/puDirectScraper').PUCourseResult,
    semester?: string,
  ): Course[] {
    if (data.studentInfo?.studentId) this.studentId = data.studentInfo.studentId;
    if (data.studentInfo?.name) this.studentName = data.studentInfo.name;

    return data.courses
      .filter((c) => c.dayOfWeek !== null)
      .map(
        (course): Course => ({
          id: `pu-crs-${course.code}-${course.dayOfWeek}`,
          code: course.code,
          name: course.name,
          instructor: course.teacherEmail.split('@')[0] || '未知教師',
          teacher: course.teacherEmail.split('@')[0] || '未知教師',
          credits: course.credits,
          semester: data.semester ?? semester ?? '未指定',
          schedule: [
            {
              dayOfWeek: (course.dayOfWeek || 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
              startTime: course.startTime || '08:10',
              endTime: course.endTime || '09:00',
              location: course.location,
            },
          ],
          dayOfWeek: (course.dayOfWeek || 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          startTime: course.startTime || '08:10',
          endTime: course.endTime || '09:00',
          location: course.location,
        }),
      );
  }

  async listCourses(_studentId?: string, semester?: string): Promise<Course[]> {
    console.log(`[PUAdapter] listCourses called — mode=${this.useDirectMode ? "direct" : "backend"}, sessionId=${!!this.sessionId}, directSession=${!!this.directSession}`);
    // ── 1. 快取優先（所有模式都先讀快取） ──
    const cached = await getCachedCourses();
    if (cached && cached.courses.length > 0) {
      console.log(`[PUAdapter] listCourses → PU cache hit: ${cached.courses.length} courses`);
      return this.mapCourses(cached, semester);
    }
    console.log(`[PUAdapter] listCourses → PU cache miss (cached=${cached ? 'empty' : 'null'})`);

    // ── 2. 快取過期或空 → 嘗試遠端抓取 ──
    try {
      if (this.useDirectMode && this.directSession) {
        const fresh = await refreshCourses(this.directSession);
        if (fresh && fresh.courses.length > 0) return this.mapCourses(fresh, semester);
      } else if (!this.useDirectMode) {
        const data = await this.fetchData<CourseResponse>("courses", { semester });
        if (data?.success && data.courses?.length > 0) {
          if (data.studentInfo?.studentId) this.studentId = data.studentInfo.studentId;
          if (data.studentInfo?.name) this.studentName = data.studentInfo.name;

          // 同步寫入快取
          await seedCachedCourses({
            courses: data.courses.map((c) => ({
              code: c.code,
              classOffered: c.classOffered ?? "",
              name: c.name,
              nameEn: c.nameEn ?? "",
              courseType: c.courseType ?? "",
              credits: c.credits,
              dayOfWeek: c.dayOfWeek,
              periods: c.periods ?? [],
              startTime: c.startTime,
              endTime: c.endTime,
              location: c.location ?? "",
              timePlaceRaw: c.timePlaceRaw ?? "",
              teacherEmail: c.teacherEmail ?? "",
            })),
            studentInfo: {
              studentId: data.studentInfo?.studentId ?? this.studentId,
              name: data.studentInfo?.name ?? this.studentName,
              className: data.studentInfo?.class ?? null,
              currentSemester: data.semester ?? null,
              department: data.studentInfo?.department ?? null,
              grade: data.studentInfo?.grade ?? null,
              enrollmentStatus: data.studentInfo?.enrollmentStatus ?? null,
            },
            semester: data.semester ?? null,
            totalCredits: data.totalCredits ?? 0,
          }).catch(() => {});

          const detectedSemester = data.semester || semester || "未指定";
          return data.courses
            .filter((c) => c.dayOfWeek !== null)
            .map((course): Course => ({
              id: `pu-crs-${course.code}-${course.dayOfWeek}`,
              code: course.code,
              name: course.name,
              instructor: course.teacherEmail.split("@")[0] || "未知教師",
              teacher: course.teacherEmail.split("@")[0] || "未知教師",
              credits: course.credits,
              semester: detectedSemester,
              schedule: [
                {
                  dayOfWeek: (course.dayOfWeek || 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
                  startTime: course.startTime || "08:10",
                  endTime: course.endTime || "09:00",
                  location: course.location,
                },
              ],
              dayOfWeek: (course.dayOfWeek || 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
              startTime: course.startTime || "08:10",
              endTime: course.endTime || "09:00",
              location: course.location,
            }));
        }
      }
    } catch (err) {
      console.warn("[PUAdapter] listCourses remote fetch failed:", err);
    }

    // ── 3. 遠端失敗 → 讀任何快取（離線模式） ──
    const stale = await getAnyCachedCourses();
    if (stale && stale.courses.length > 0) return this.mapCourses(stale, semester);

    const data = await this.fetchData<CourseResponse>('courses', { semester });
    if (!data?.success || !data.courses) return [];

    if (data.studentInfo?.studentId) this.studentId = data.studentInfo.studentId;
    if (data.studentInfo?.name) this.studentName = data.studentInfo.name;

    const detectedSemester = data.semester || semester || '未指定';

    return data.courses
      .filter((c) => c.dayOfWeek !== null)
      .map(
        (course): Course => ({
          id: `pu-crs-${course.code}-${course.dayOfWeek}`,
          code: course.code,
          name: course.name,
          instructor: course.teacherEmail.split('@')[0] || '未知教師',
          teacher: course.teacherEmail.split('@')[0] || '未知教師',
          credits: course.credits,
          semester: detectedSemester,
          schedule: [
            {
              dayOfWeek: (course.dayOfWeek || 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
              startTime: course.startTime || '08:10',
              endTime: course.endTime || '09:00',
              location: course.location,
            },
          ],
          dayOfWeek: (course.dayOfWeek || 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          startTime: course.startTime || '08:10',
          endTime: course.endTime || '09:00',
          location: course.location,
        }),
      );
  }

  async getCourse(id: string): Promise<Course | null> {
    const courses = await this.listCourses();
    return (
      courses.find(
        (course) =>
          course.id === id ||
          course.code === id ||
          id.includes(course.code) ||
          id.includes(course.id),
      ) ?? null
    );
  }

  // ---------------------------------------------------------------------------
  // Grades
  // ---------------------------------------------------------------------------

  async listGrades(studentId: string, semester?: string): Promise<Grade[]> {
    // 原生 cookie jar 和舊快取都沒有帳號歸屬證明。成績只走伺服器驗證 owner 的 session。
    const requester = getAuthInstance().currentUser;
    const sessionId = this.sessionId;
    if (!requester || requester.uid !== studentId || (!sessionId && this.directSession)) {
      throw new Error('請重新連線學校帳號後再讀取成績。');
    }
    if (!sessionId) {
      const result = await loadOwnedSchoolGrades(requester.uid);
      if (getAuthInstance().currentUser !== requester || this.sessionId !== sessionId) {
        throw new Error('帳號已變更，請重新讀取成績。');
      }
      return mapPuOfficialGrades(result.grades, {
        studentId: requester.uid, schoolId: this.schoolId,
        gradeSource: 'school-official', semester,
      });
    }
    const isCurrent = () =>
      getAuthInstance().currentUser === requester && this.sessionId === sessionId;

    let remoteFailed = false;
    let remoteEmptySuccess = false;

    try {
      if (!this.useDirectMode) {
        type GradeResponse = {
          success: boolean;
          grades: Array<{
            semester: string;
            courseName: string;
            courseNameEn: string;
            class: string;
            courseType: string;
            credits: number;
            score: number | string;
          }>;
          allSemesters: string[];
          summary: Record<
            string,
            {
              departmentRanking?: string;
              classRanking?: string;
              behaviorScore?: number | string;
              semesterAverage?: number | string;
            }
          >;
        };

        const data = await this.fetchData<GradeResponse>("grades", { semester });
        if (!isCurrent()) throw new Error('帳號已變更，請重新讀取成績。');
        if (data?.success && Array.isArray(data.grades)) {
          if (data.grades?.length > 0) {
            return mapPuOfficialGrades(data.grades, {
              studentId: requester.uid,
              schoolId: this.schoolId,
              gradeSource: 'school-official',
              semester,
            });
          }
          remoteEmptySuccess = true;
        } else {
          remoteFailed = true;
        }
      } else {
        // 直連模式但無 session：無法確認空結果，視為讀取失敗
        remoteFailed = true;
      }
    } catch (err) {
      console.warn("[PUAdapter] listGrades remote fetch failed:", err);
      remoteFailed = true;
    }

    if (!isCurrent()) throw new Error('帳號已變更，請重新讀取成績。');
    if (remoteEmptySuccess) {
      return [];
    }

    if (remoteFailed) {
      throw new Error('無法讀取校務成績，請稍後再試。');
    }

    return [];
  }

  async getCreditAudit(): Promise<PuCreditAuditPayload | null> {
    // 歷年成績和完整學分試算表是不同契約。後端的成績摘要不能冒充校方畢業審核。
    if (!this.directSession || this.sessionId) return null;
    const session = this.directSession;
    const result = await refreshCreditAudit(session);
    if (this.directSession !== session) return null;
    return result;
  }

  // ---------------------------------------------------------------------------
  // Menu (not available via scraping)
  // ---------------------------------------------------------------------------

  async listMenu(): Promise<MenuItem[]> {
    return [];
  }

  // ---------------------------------------------------------------------------
  // POIs — 使用 puCampusData.ts 完整校園 POI 資料庫（50+ 地點 / 精準 GPS）
  // ---------------------------------------------------------------------------

  private mapCampusPoiToPoi(p: CampusPoi): Poi {
    const categoryMap: Record<CampusPoiCategory, Poi['category']> = {
      academic: 'building',
      admin: 'office',
      library: 'library',
      cafeteria: 'cafeteria',
      dormitory: 'dormitory',
      sports: 'sports',
      parking: 'parking',
      convenience: 'convenience',
      medical: 'medical',
      religious: 'other',
      gate: 'other',
      research: 'building',
      other: 'other',
    };

    return {
      id: p.id,
      name: `${p.name} ${p.nameEn}`,
      category: categoryMap[p.category] ?? 'other',
      lat: p.lat,
      lng: p.lng,
      description: p.description,
      building: p.code,
      facilities: p.facilities,
      accessible: p.accessible,
      imageUrl: p.imageUrl ?? undefined,
    };
  }

  async listPois(): Promise<Poi[]> {
    return CAMPUS_POIS.map((p) => this.mapCampusPoiToPoi(p));
  }

  async getPoi(id: string): Promise<Poi | null> {
    const row = getCampusPoi(id);
    return row ? this.mapCampusPoiToPoi(row) : null;
  }

  // ---------------------------------------------------------------------------
  // TronClass → CourseSpace mapping
  // ---------------------------------------------------------------------------

  private mapTCCourseToCourseSpace(tc: TCCourse, activities?: TCActivity[]): CourseSpace {
    const homeworkActivities = (activities ?? []).filter(
      (a) => a.type === 'homework' || a.type === 'exam' || a.type === 'quiz',
    );
    const now = Date.now();
    const dueSoon = homeworkActivities.filter((a) => {
      const due = toValidDate(a.end_time)?.getTime();
      if (!due) return false;
      return due > now && due - now < 7 * 24 * 60 * 60 * 1000; // 7 天內
    });
    const quizzes = (activities ?? []).filter((a) => a.type === 'quiz' || a.type === 'exam');

    return {
      id: `tc-${tc.id}`,
      groupId: `tc-${tc.id}`,
      courseId: `tc-${tc.id}`,
      name: tc.name,
      description: tc.course_code || undefined,
      role: tc.role === 'teacher' ? 'instructor' : 'student',
      unreadCount: 0,
      assignmentCount: homeworkActivities.length,
      dueSoonCount: dueSoon.length,
      quizCount: quizzes.length,
      moduleCount: 0,
      activeSessionId: null,
      latestDueAt:
        dueSoon.length > 0
          ? new Date(
              dueSoon.sort(
                (a, b) =>
                  (toValidDate(a.end_time)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
                  (toValidDate(b.end_time)?.getTime() ?? Number.MAX_SAFE_INTEGER),
              )[0].end_time!,
            )
          : null,
      memberCount: tc.student_count,
      schoolId: PROVIDENCE_UNIVERSITY_SCHOOL_ID,
    };
  }

  async listCourseSpaces(_userId?: string, _schoolId?: string): Promise<CourseSpace[]> {
    console.log(`[PUAdapter] listCourseSpaces called`);
    let courses: TCCourse[];
    try {
      courses = await this.ensureTCCourses();
    } catch (err) {
      console.warn(`[PUAdapter] listCourseSpaces → ensureTCCourses failed:`, err);
      return [];
    }
    console.log(`[PUAdapter] listCourseSpaces → TC courses: ${courses.length}`);
    if (courses.length === 0) return [];

    let activitiesMap: Record<number, TCActivity[]> = {};
    try {
      activitiesMap = await this.ensureTCActivitiesMap(courses.map((course) => course.id));
    } catch (error) {
      console.warn('[PUAdapter] Failed to load activities, continuing with courses only:', error);
    }

    return courses.map((tc) => this.mapTCCourseToCourseSpace(tc, activitiesMap[tc.id] ?? []));
  }

  async getCourseSpace(courseSpaceId: string, _userId?: string): Promise<CourseSpace | null> {
    const spaces = await this.listCourseSpaces();
    return spaces.find((s) => s.groupId === courseSpaceId) ?? null;
  }

  // ---------------------------------------------------------------------------
  // TronClass → CourseModule mapping
  // ---------------------------------------------------------------------------

  async listCourseModules(_userId?: string, courseSpaceId?: string): Promise<CourseModule[]> {
    const tcCourses = await this.ensureTCCourses();
    const courseMap = new Map(tcCourses.map((course) => [course.id, course.name]));
    const courseIds = courseSpaceId
      ? [parseInt(courseSpaceId.replace('tc-', ''), 10)].filter((id) => !isNaN(id))
      : tcCourses.map((course) => course.id);
    const modulesMap =
      courseIds.length > 0
        ? await this.ensureTCModulesMap(courseIds)
        : ((await getCachedTCModules()) ?? {});
    const results: CourseModule[] = [];

    const processModules = (courseId: number, modules: TCModule[]) => {
      const groupId = `tc-${courseId}`;
      const courseName = courseMap.get(courseId) ?? `Course ${courseId}`;

      for (const mod of modules) {
        const materials: CourseMaterial[] = (mod.syllabuses ?? []).map(
          (syllabus): CourseMaterial => ({
            id: `tc-mat-${syllabus.id}`,
            moduleId: `tc-mod-${mod.id}`,
            groupId,
            type: 'document',
            label: syllabus.name?.trim() || `教材 ${syllabus.id}`,
          }),
        );

        results.push({
          id: `tc-mod-${mod.id}`,
          groupId,
          groupName: courseName,
          title: mod.name,
          week: mod.sort || undefined,
          order: mod.sort,
          resourceCount: materials.length,
          published: !mod.is_hidden,
          materials,
        });
      }
    };

    if (courseSpaceId) {
      const courseId = parseInt(courseSpaceId.replace('tc-', ''), 10);
      if (!isNaN(courseId) && modulesMap[courseId]) {
        processModules(courseId, modulesMap[courseId]);
      }
    } else {
      for (const [courseIdStr, modules] of Object.entries(modulesMap)) {
        processModules(parseInt(courseIdStr, 10), modules);
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // TronClass → InboxTask (待辦事項)
  // ---------------------------------------------------------------------------

  private mapTCActivityToInboxTask(activity: TCActivity, courseName: string): InboxTask {
    const isQuiz = activity.type === 'quiz' || activity.type === 'exam';
    const kind: InboxTask['kind'] = isQuiz ? 'quiz' : 'assignment';
    const dueAt = toValidDate(activity.end_time);

    let priority = 50;
    if (dueAt) {
      const hoursUntilDue = (dueAt.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilDue < 0)
        priority = 10; // 已過期
      else if (hoursUntilDue < 24)
        priority = 90; // 24 小時內
      else if (hoursUntilDue < 72) priority = 70; // 3 天內
    }

    return {
      id: `tc-task-${activity.id}`,
      kind,
      groupId: `tc-${activity.course_id}`,
      groupName: courseName,
      title: activity.title,
      subtitle: dueAt ? `截止：${dueAt.toLocaleDateString('zh-TW')}` : activity.type,
      assignmentId: `tc-activity-${activity.id}`,
      priority,
      dueAt,
      preferredIntent: isQuiz ? 'submit' : 'submit',
      actionLabel: isQuiz ? '開始測驗' : '繳交作業',
    };
  }

  async listInboxTasks(_userId?: string): Promise<InboxTask[]> {
    console.log(`[PUAdapter] listInboxTasks called`);
    let todos: TCActivity[];
    try {
      todos = await this.ensureTCTodos();
    } catch (err) {
      console.warn(`[PUAdapter] listInboxTasks → ensureTCTodos failed:`, err);
      todos = [];
    }
    let courses: TCCourse[];
    try {
      courses = await this.ensureTCCourses();
    } catch (err) {
      console.warn(`[PUAdapter] listInboxTasks → ensureTCCourses failed:`, err);
      courses = [];
    }
    console.log(`[PUAdapter] listInboxTasks → todos=${todos.length}, courses=${courses.length}`);
    const courseMap = new Map(courses.map((c) => [c.id, c.name]));

    return todos
      .filter((t) => t.status !== 'graded' && t.status !== 'submitted')
      .map((t) => this.mapTCActivityToInboxTask(t, courseMap.get(t.course_id) ?? '未知課程'))
      .sort((a, b) => b.priority - a.priority);
  }

  // ---------------------------------------------------------------------------
  // TronClass → Quiz mapping
  // ---------------------------------------------------------------------------

  async listQuizzes(_userId?: string, courseSpaceId?: string): Promise<Quiz[]> {
    const courses = await this.ensureTCCourses();
    const courseIds = courseSpaceId
      ? [parseInt(courseSpaceId.replace('tc-', ''), 10)].filter((id) => !isNaN(id))
      : courses.map((course) => course.id);
    const activitiesMap =
      courseIds.length > 0
        ? await this.ensureTCActivitiesMap(courseIds)
        : ((await getCachedTCActivities()) ?? (await getAnyCachedTCActivities()) ?? {});
    const courseMap = new Map(courses.map((c) => [c.id, c.name]));
    const results: Quiz[] = [];

    const processActivities = (courseId: number, activities: TCActivity[]) => {
      const quizActivities = activities.filter((a) => a.type === 'quiz' || a.type === 'exam');
      for (const a of quizActivities) {
        results.push({
          id: `tc-quiz-${a.id}`,
          assignmentId: `tc-activity-${a.id}`,
          groupId: `tc-${courseId}`,
          groupName: courseMap.get(courseId) ?? '未知課程',
          title: a.title,
          description: a.description ?? undefined,
          dueAt: toValidDate(a.end_time),
          type: a.type === 'exam' ? 'exam' : 'quiz',
          gradesPublished: a.status === 'graded',
          points: a.total_score ?? undefined,
          weight: a.weight ?? undefined,
          source: 'quiz',
        });
      }
    };

    if (courseSpaceId) {
      const courseId = parseInt(courseSpaceId.replace('tc-', ''), 10);
      if (!isNaN(courseId) && activitiesMap[courseId]) {
        processActivities(courseId, activitiesMap[courseId]);
      }
    } else {
      for (const [courseIdStr, activities] of Object.entries(activitiesMap)) {
        processActivities(parseInt(courseIdStr, 10), activities);
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // TronClass → Attendance mapping
  // ---------------------------------------------------------------------------

  async listAttendanceSessions(
    _userId?: string,
    courseSpaceId?: string,
  ): Promise<AttendanceSession[]> {
    const attendance = await this.ensureTCAttendance();

    const filtered = courseSpaceId
      ? attendance.filter((a) => `tc-${a.course_id}` === courseSpaceId)
      : attendance;

    return filtered.map(
      (a): AttendanceSession => ({
        id: `tc-att-${a.course_id}`,
        groupId: `tc-${a.course_id}`,
        groupName: a.course_name,
        active: false,
        attendeeCount: a.attended,
        startedAt: null,
        endedAt: null,
        source: 'attendance',
      }),
    );
  }

  async getAttendanceSummary(courseSpaceId: string): Promise<AttendanceSummary> {
    const attendance = await this.ensureTCAttendance();
    const courseId = parseInt(courseSpaceId.replace('tc-', ''), 10);
    const match = attendance.find((a) => a.course_id === courseId);

    const latestSession = match
      ? {
          id: `tc-att-${match.course_id}`,
          groupId: `tc-${match.course_id}`,
          groupName: match.course_name,
          active: false,
          attendeeCount: match.attended,
          totalSessions: match.total_sessions,
          presentCount: match.attended,
          absentCount: match.absent,
          lateCount: match.late,
          leaveCount: match.leave,
          attendanceRate: match.rate,
          startedAt: null,
          endedAt: null,
          source: "attendance" as const,
          attendanceMode: "TronClass",
          sourceSystem: "tronclass" as const,
        }
      : null;

    return {
      groupId: courseSpaceId,
      totalSessions: match?.total_sessions ?? 0,
      activeSessions: 0,
      totalAttendees: match?.attended ?? 0,
      latestSession,
    };
  }

  // ---------------------------------------------------------------------------
  // GPA Calculation (from real grade data)
  // ---------------------------------------------------------------------------

  private scoreToGradePoint(score: number): number {
    return puScoreToGradePoint(score);
  }

  async getGPA(
    _userId?: string,
  ): Promise<{ gpa: number; totalCredits: number; totalPoints: number }> {
    const cached = (await getCachedGrades()) ?? (await getAnyCachedGrades());
    if (!cached || cached.grades.length === 0) {
      return { gpa: 0, totalCredits: 0, totalPoints: 0 };
    }

    let totalCredits = 0;
    let totalPoints = 0;

    for (const grade of cached.grades) {
      const score = typeof grade.score === 'number' ? grade.score : parseFloat(String(grade.score));

      if (isNaN(score) || grade.credits <= 0) continue;

      const gp = this.scoreToGradePoint(score);
      totalCredits += grade.credits;
      totalPoints += gp * grade.credits;
    }

    const gpa = totalCredits > 0 ? Math.round((totalPoints / totalCredits) * 100) / 100 : 0;
    return { gpa, totalCredits, totalPoints: Math.round(totalPoints * 100) / 100 };
  }

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  async isHealthy(): Promise<boolean> {
    if (this.useDirectMode) {
      // Direct mode: test connection to alcat.pu.edu.tw
      try {
        const r = await fetch('https://alcat.pu.edu.tw', { method: 'HEAD' });
        return r.ok || r.status === 302;
      } catch {
        return false;
      }
    }
    try {
      const response = await fetch(getCloudFunctionUrl('puHealthCheck'), { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Capabilities
  // ---------------------------------------------------------------------------

  getCapabilities(): AdapterCapabilities {
    return {
      announcements: true,
      events: false,
      courses: true,
      grades: true,
      menu: false,
      pois: true,
      library: false,
      bus: false,
      sso: false,
      realtime: false,
    };
  }
}

export function createPUAdapter(): PUAdapter {
  return new PUAdapter();
}
