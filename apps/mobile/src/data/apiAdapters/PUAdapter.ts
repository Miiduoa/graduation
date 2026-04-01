import { PROVIDENCE_UNIVERSITY_SCHOOL_ID } from "@campus/shared/src";
import { BaseApiAdapter } from "./BaseAdapter";
import type {
  AdapterCapabilities,
  AuthCredentials,
} from "./types";
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
} from "../types";
import {
  puLogin,
  type PUSession,
} from "../../services/puDirectScraper";
import {
  getCachedCourses,
  getCachedGrades,
  getCachedAnnouncements,
  getAnyCachedCourses,
  getAnyCachedGrades,
  getAnyCachedAnnouncements,
  refreshCourses,
  refreshGrades,
  refreshAnnouncements,
  seedCachedCourses,
  seedCachedGrades as persistCachedGrades,
  seedCachedAnnouncements,
  getCachedTCCourses,
  getCachedTCActivities,
  getCachedTCModules,
  getCachedTCAttendance,
  getCachedTCTodos,
  getAnyCachedTCCourses,
  getAnyCachedTCActivities,
  refreshTCCourses,
  refreshTCActivitiesForCourses,
  refreshTCModulesForCourses,
  refreshTCAttendance,
  refreshTCTodos,
} from "../../services/puDataCache";
import type {
  TCCourse,
  TCActivity,
  TCModule,
  TCAttendance,
} from "../../services/tronClassClient";
import { getCloudFunctionUrl } from "../../services/cloudFunctions";

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
  readonly schoolId = "tw-pu";
  readonly schoolName = "靜宜大學";
  readonly apiVersion = "1.0";

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
        throw new Error(result.error ?? "靜宜大學登入失敗");
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
      const response = await fetch(getCloudFunctionUrl("puAuthenticate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        throw new Error(data.error || "登入失敗");
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
      throw new Error(
        error instanceof Error ? error.message : "靜宜大學登入失敗"
      );
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

  private async ensureTCCourses(): Promise<TCCourse[]> {
    const cached = await getCachedTCCourses();
    if (cached) return cached;

    const stale = await getAnyCachedTCCourses();
    try {
      return (await refreshTCCourses()) ?? stale ?? [];
    } catch (error) {
      if (stale) {
        console.warn("[PUAdapter] Falling back to stale TronClass courses:", error);
        return stale;
      }
      throw error;
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
        console.warn("[PUAdapter] Falling back to stale TronClass activities:", error);
        return stale;
      }
      throw error;
    }
  }

  private async ensureTCModulesMap(courseIds: number[]): Promise<Record<number, TCModule[]>> {
    const cached = await getCachedTCModules();
    if (cached) return cached;
    return refreshTCModulesForCourses(courseIds);
  }

  private async ensureTCTodos(): Promise<TCActivity[]> {
    const cached = await getCachedTCTodos();
    if (cached) return cached;
    return (await refreshTCTodos()) ?? [];
  }

  private async ensureTCAttendance(): Promise<TCAttendance[]> {
    const cached = await getCachedTCAttendance();
    if (cached) return cached;
    return (await refreshTCAttendance()) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Data fetching helper (Cloud Functions mode only)
  // ---------------------------------------------------------------------------

  private async fetchData<T>(dataType: string, extra: Record<string, unknown> = {}): Promise<T | null> {
    if (!this.sessionId) {
      console.warn(`[PUAdapter] No session for ${dataType}`);
      return null;
    }

    try {
      const response = await fetch(getCloudFunctionUrl("puFetchCampusData"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  private mapAnnouncements(items: Array<{ title: string; url: string; date: string }>): Announcement[] {
    return items.map((item, i): Announcement => ({
      id: `pu-ann-${i}-${item.title.slice(0, 10)}`,
      title: item.title,
      body: item.url,
      publishedAt: new Date(item.date).toISOString(),
      source: "靜宜大學 e校園",
    }));
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
        type AnnouncementResponse = {
          success: boolean;
          announcements: Array<{ title: string; url: string; date: string }>;
        };
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

    return [];
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

  private mapCourses(data: import("../../services/puDirectScraper").PUCourseResult, semester?: string): Course[] {
    if (data.studentInfo?.studentId) this.studentId = data.studentInfo.studentId;
    if (data.studentInfo?.name) this.studentName = data.studentInfo.name;

    return data.courses
      .filter((c) => c.dayOfWeek !== null)
      .map((course): Course => ({
        id: `pu-crs-${course.code}-${course.dayOfWeek}`,
        code: course.code,
        name: course.name,
        instructor: course.teacherEmail.split("@")[0] || "未知教師",
        teacher: course.teacherEmail.split("@")[0] || "未知教師",
        credits: course.credits,
        semester: data.semester ?? semester ?? "未指定",
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
        type CourseResponse = {
          success: boolean;
          courses: Array<{
            code: string;
            classOffered: string;
            name: string;
            nameEn: string;
            courseType: string;
            credits: number;
            dayOfWeek: number | null;
            periods: number[];
            startTime: string | null;
            endTime: string | null;
            location: string;
            timePlaceRaw: string;
            teacherEmail: string;
          }>;
          studentInfo: {
            class: string | null;
            studentId: string | null;
            name: string | null;
          };
          semester: string | null;
          totalCredits: number;
        };

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

    return [];
  }

  async getCourse(id: string): Promise<Course | null> {
    const courses = await this.listCourses();
    return (
      courses.find((course) =>
        course.id === id ||
        course.code === id ||
        id.includes(course.code) ||
        id.includes(course.id)
      ) ?? null
    );
  }

  // ---------------------------------------------------------------------------
  // Grades
  // ---------------------------------------------------------------------------

  private mapGrades(data: import("../../services/puDirectScraper").PUGradeResult, studentId: string, semester?: string): Grade[] {
    const grades = semester ? data.grades.filter((g) => g.semester === semester) : data.grades;
    return grades.map((item, i): Grade => {
      const score = typeof item.score === "number" ? item.score : parseFloat(String(item.score)) || 0;
      return {
        id: `pu-grade-${item.semester}-${i}`,
        courseId: `pu-crs-${item.semester}-${i}`,
        courseName: item.courseName,
        credits: item.credits,
        grade: score,
        gradePoint: this.scoreToGradePoint(score),
        score,
        semester: item.semester,
        userId: studentId || this.studentId || "",
      };
    });
  }

  async listGrades(studentId: string, semester?: string): Promise<Grade[]> {
    console.log(`[PUAdapter] listGrades called — mode=${this.useDirectMode ? "direct" : "backend"}, sessionId=${!!this.sessionId}`);
    // ── 1. 快取優先（所有模式都先讀快取） ──
    const cached = await getCachedGrades();
    if (cached && cached.grades.length > 0) {
      console.log(`[PUAdapter] listGrades → PU cache hit: ${cached.grades.length} grades`);
      return this.mapGrades(cached, studentId, semester);
    }
    console.log(`[PUAdapter] listGrades → PU cache miss`);

    // ── 2. 快取過期或空 → 嘗試遠端抓取 ──
    try {
      if (this.useDirectMode && this.directSession) {
        const fresh = await refreshGrades(this.directSession);
        if (fresh && fresh.grades.length > 0) return this.mapGrades(fresh, studentId, semester);
      } else if (!this.useDirectMode) {
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
        if (data?.success && data.grades?.length > 0) {
          // 同步寫入快取
          await persistCachedGrades({
            grades: data.grades.map((g) => ({
              semester: g.semester,
              courseName: g.courseName,
              courseNameEn: g.courseNameEn ?? "",
              className: g.class ?? "",
              courseType: g.courseType ?? "",
              credits: g.credits,
              score: typeof g.score === "number" ? g.score : parseFloat(String(g.score)) || 0,
            })),
            allSemesters: data.allSemesters ?? [],
            summary: data.summary ?? {},
          }).catch(() => {});

          return data.grades.map((item, i): Grade => {
            const score = typeof item.score === "number" ? item.score : parseFloat(String(item.score)) || 0;
            return {
              id: `pu-grade-${item.semester}-${i}`,
              courseId: `pu-crs-${item.semester}-${i}`,
              courseName: item.courseName,
              credits: item.credits,
              grade: score,
              gradePoint: this.scoreToGradePoint(score),
              score,
              semester: item.semester,
              userId: studentId || this.studentId || "",
            };
          });
        }
      }
    } catch (err) {
      console.warn("[PUAdapter] listGrades remote fetch failed:", err);
    }

    // ── 3. 遠端失敗 → 讀任何快取（離線模式） ──
    const stale = await getAnyCachedGrades();
    if (stale && stale.grades.length > 0) return this.mapGrades(stale, studentId, semester);

    return [];
  }

  // ---------------------------------------------------------------------------
  // Menu (not available via scraping)
  // ---------------------------------------------------------------------------

  async listMenu(): Promise<MenuItem[]> {
    return [];
  }

  // ---------------------------------------------------------------------------
  // POIs (hardcoded campus landmarks with real coordinates)
  // ---------------------------------------------------------------------------

  async listPois(): Promise<Poi[]> {
    const pois: Array<{ name: string; code: string; cat: Poi["category"]; lat: number; lng: number; desc: string }> = [
      { name: "主顧樓 Providence Hall", code: "PH", cat: "building", lat: 24.22712, lng: 120.56517, desc: "主要教學大樓" },
      { name: "任垣樓 Anthony Kuo Hall", code: "AK", cat: "building", lat: 24.22765, lng: 120.56453, desc: "教學大樓・計算機中心(AK-3C)" },
      { name: "伯鐸樓 St. Peter Hall", code: "SP", cat: "building", lat: 24.22695, lng: 120.56398, desc: "教學大樓" },
      { name: "靜安樓 Jing An Hall", code: "JA", cat: "building", lat: 24.22630, lng: 120.56490, desc: "教學大樓" },
      { name: "格倫樓 Theodore Guerin Hall", code: "TG", cat: "building", lat: 24.22680, lng: 120.56570, desc: "教學大樓" },
      { name: "方濟樓 St. Francis Hall", code: "SF", cat: "building", lat: 24.22740, lng: 120.56600, desc: "教學大樓" },
      { name: "思源樓 Si Yuan Hall", code: "SY", cat: "building", lat: 24.22810, lng: 120.56530, desc: "教學大樓" },
      { name: "第一研究大樓", code: "1R", cat: "building", lat: 24.22850, lng: 120.56480, desc: "研究大樓" },
      { name: "第二研究大樓", code: "2R", cat: "building", lat: 24.22870, lng: 120.56420, desc: "研究大樓" },
      { name: "體育館 John Paul II Sports Hall", code: "ST", cat: "building", lat: 24.22580, lng: 120.56350, desc: "體育設施" },
      { name: "田徑場", code: "SD", cat: "building", lat: 24.22520, lng: 120.56400, desc: "運動場" },
      { name: "蓋夏圖書館", code: "LIB", cat: "building", lat: 24.22750, lng: 120.56350, desc: "圖書館" },
      { name: "主顧聖母堂", code: "CH", cat: "building", lat: 24.22660, lng: 120.56320, desc: "校園聖殿" },
      { name: "學生餐廳", code: "CAFE", cat: "food", lat: 24.22620, lng: 120.56450, desc: "學生餐飲" },
      { name: "行政中心", code: "ADMIN", cat: "office", lat: 24.22720, lng: 120.56380, desc: "校務行政" },
    ];

    return pois.map((p): Poi => ({
      id: `pu-poi-${p.code}`,
      name: p.name,
      category: p.cat,
      lat: p.lat,
      lng: p.lng,
      description: p.desc,
    }));
  }

  // ---------------------------------------------------------------------------
  // TronClass → CourseSpace mapping
  // ---------------------------------------------------------------------------

  private mapTCCourseToCourseSpace(tc: TCCourse, activities?: TCActivity[]): CourseSpace {
    const homeworkActivities = (activities ?? []).filter(
      (a) => a.type === "homework" || a.type === "exam" || a.type === "quiz"
    );
    const now = Date.now();
    const dueSoon = homeworkActivities.filter((a) => {
      if (!a.end_date) return false;
      const due = new Date(a.end_date).getTime();
      return due > now && due - now < 7 * 24 * 60 * 60 * 1000; // 7 天內
    });
    const quizzes = (activities ?? []).filter(
      (a) => a.type === "quiz" || a.type === "exam"
    );

    return {
      id: `tc-${tc.id}`,
      groupId: `tc-${tc.id}`,
      courseId: `tc-${tc.id}`,
      name: tc.name,
      description: tc.course_code || undefined,
      role: tc.role === "teacher" ? "instructor" : "student",
      unreadCount: 0,
      assignmentCount: homeworkActivities.length,
      dueSoonCount: dueSoon.length,
      quizCount: quizzes.length,
      moduleCount: 0,
      activeSessionId: null,
      latestDueAt: dueSoon.length > 0
        ? new Date(dueSoon.sort((a, b) =>
            new Date(a.end_date!).getTime() - new Date(b.end_date!).getTime()
          )[0].end_date!)
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

    let activitiesMap: Record<number, TCActivity[]>;
    try {
      activitiesMap = await this.ensureTCActivitiesMap(courses.map((course) => course.id));
    } catch (err) {
      console.warn(`[PUAdapter] listCourseSpaces → ensureTCActivitiesMap failed:`, err);
      activitiesMap = {};
    }

    return courses.map((tc) =>
      this.mapTCCourseToCourseSpace(tc, activitiesMap[tc.id] ?? [])
    );
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
    const courseIds = courseSpaceId
      ? [parseInt(courseSpaceId.replace("tc-", ""), 10)].filter((id) => !isNaN(id))
      : tcCourses.map((course) => course.id);
    const modulesMap =
      courseIds.length > 0
        ? await this.ensureTCModulesMap(courseIds)
        : await getCachedTCModules() ?? {};
    const results: CourseModule[] = [];

    const processModules = (courseId: number, modules: TCModule[]) => {
      const groupId = `tc-${courseId}`;
      const courseName = modules[0]?.title ?? `Course ${courseId}`;

      for (const mod of modules) {
        const materials: CourseMaterial[] = mod.activities
          .filter((a) => a.type === "material" || a.type === "discussion")
          .map((a): CourseMaterial => ({
            id: `tc-mat-${a.id}`,
            moduleId: `tc-mod-${mod.id}`,
            groupId,
            type: a.type === "discussion" ? "link" : "document",
            label: a.title,
            description: a.description ?? undefined,
          }));

        results.push({
          id: `tc-mod-${mod.id}`,
          groupId,
          groupName: courseName,
          title: mod.title,
          description: mod.description ?? undefined,
          week: mod.position,
          order: mod.position,
          resourceCount: mod.activities.length,
          published: mod.published,
          materials,
        });
      }
    };

    if (courseSpaceId) {
      const courseId = parseInt(courseSpaceId.replace("tc-", ""), 10);
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
    const isQuiz = activity.type === "quiz" || activity.type === "exam";
    const kind: InboxTask["kind"] = isQuiz ? "quiz" : "assignment";

    let priority = 50;
    if (activity.end_date) {
      const hoursUntilDue = (new Date(activity.end_date).getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilDue < 0) priority = 10;        // 已過期
      else if (hoursUntilDue < 24) priority = 90;   // 24 小時內
      else if (hoursUntilDue < 72) priority = 70;   // 3 天內
    }

    return {
      id: `tc-task-${activity.id}`,
      kind,
      groupId: `tc-${activity.course_id}`,
      groupName: courseName,
      title: activity.title,
      subtitle: activity.end_date
        ? `截止：${new Date(activity.end_date).toLocaleDateString("zh-TW")}`
        : activity.type,
      assignmentId: `tc-activity-${activity.id}`,
      priority,
      dueAt: activity.end_date ? new Date(activity.end_date) : null,
      preferredIntent: isQuiz ? "submit" : "submit",
      actionLabel: isQuiz ? "開始測驗" : "繳交作業",
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
      .filter((t) => t.status !== "graded" && t.status !== "submitted")
      .map((t) => this.mapTCActivityToInboxTask(t, courseMap.get(t.course_id) ?? "未知課程"))
      .sort((a, b) => b.priority - a.priority);
  }

  // ---------------------------------------------------------------------------
  // TronClass → Quiz mapping
  // ---------------------------------------------------------------------------

  async listQuizzes(_userId?: string, courseSpaceId?: string): Promise<Quiz[]> {
    const courses = await this.ensureTCCourses();
    const courseIds = courseSpaceId
      ? [parseInt(courseSpaceId.replace("tc-", ""), 10)].filter((id) => !isNaN(id))
      : courses.map((course) => course.id);
    const activitiesMap =
      courseIds.length > 0
        ? await this.ensureTCActivitiesMap(courseIds)
        : await getCachedTCActivities() ?? await getAnyCachedTCActivities() ?? {};
    const courseMap = new Map(courses.map((c) => [c.id, c.name]));
    const results: Quiz[] = [];

    const processActivities = (courseId: number, activities: TCActivity[]) => {
      const quizActivities = activities.filter(
        (a) => a.type === "quiz" || a.type === "exam"
      );
      for (const a of quizActivities) {
        results.push({
          id: `tc-quiz-${a.id}`,
          assignmentId: `tc-activity-${a.id}`,
          groupId: `tc-${courseId}`,
          groupName: courseMap.get(courseId) ?? "未知課程",
          title: a.title,
          description: a.description ?? undefined,
          dueAt: a.end_date ? new Date(a.end_date) : null,
          type: a.type === "exam" ? "exam" : "quiz",
          gradesPublished: a.status === "graded",
          points: a.total_score ?? undefined,
          weight: a.weight ?? undefined,
          source: "quiz",
        });
      }
    };

    if (courseSpaceId) {
      const courseId = parseInt(courseSpaceId.replace("tc-", ""), 10);
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

  async listAttendanceSessions(_userId?: string, courseSpaceId?: string): Promise<AttendanceSession[]> {
    const attendance = await this.ensureTCAttendance();

    const filtered = courseSpaceId
      ? attendance.filter((a) => `tc-${a.course_id}` === courseSpaceId)
      : attendance;

    return filtered.map((a): AttendanceSession => ({
      id: `tc-att-${a.course_id}`,
      groupId: `tc-${a.course_id}`,
      groupName: a.course_name,
      active: false,
      attendeeCount: a.attended,
      totalSessions: a.total_sessions,
      presentCount: a.attended,
      absentCount: a.absent,
      lateCount: a.late,
      leaveCount: a.leave,
      attendanceRate: a.rate,
      startedAt: null,
      endedAt: null,
      source: "attendance",
      attendanceMode: "TronClass",
      sourceSystem: "tronclass",
    }));
  }

  async getAttendanceSummary(courseSpaceId: string): Promise<AttendanceSummary> {
    const attendance = await this.ensureTCAttendance();
    const courseId = parseInt(courseSpaceId.replace("tc-", ""), 10);
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
    // 靜宜大學成績對照表（四分制）
    if (score >= 90) return 4.0;
    if (score >= 85) return 3.7;
    if (score >= 80) return 3.3;
    if (score >= 77) return 3.0;
    if (score >= 73) return 2.7;
    if (score >= 70) return 2.3;
    if (score >= 67) return 2.0;
    if (score >= 63) return 1.7;
    if (score >= 60) return 1.0;
    return 0.0;
  }

  async getGPA(_userId?: string): Promise<{ gpa: number; totalCredits: number; totalPoints: number }> {
    const cached = await getCachedGrades() ?? await getAnyCachedGrades();
    if (!cached || cached.grades.length === 0) {
      return { gpa: 0, totalCredits: 0, totalPoints: 0 };
    }

    let totalCredits = 0;
    let totalPoints = 0;

    for (const grade of cached.grades) {
      const score = typeof grade.score === "number"
        ? grade.score
        : parseFloat(String(grade.score));

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
        const r = await fetch("https://alcat.pu.edu.tw", { method: "HEAD" });
        return r.ok || r.status === 302;
      } catch {
        return false;
      }
    }
    try {
      const response = await fetch(getCloudFunctionUrl("puHealthCheck"), { method: "GET" });
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
