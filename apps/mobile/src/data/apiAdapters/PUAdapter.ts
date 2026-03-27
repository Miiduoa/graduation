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
import Constants from "expo-constants";
import { hasUsableFirebaseConfig } from "../../firebase";
import {
  puLogin,
  puFetchCourses,
  puFetchGrades,
  puFetchAnnouncements,
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
  getCachedTCCourses,
  getCachedTCActivities,
  getCachedTCModules,
  getCachedTCAttendance,
  getCachedTCTodos,
  getAnyCachedTCCourses,
  getAnyCachedTCActivities,
  refreshTCCourses,
  refreshTCTodos,
} from "../../services/puDataCache";
import type {
  TCCourse,
  TCActivity,
  TCModule,
  TCAttendance,
} from "../../services/tronClassClient";

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
    // Prefer Cloud Functions when Firebase is usable AND we have a sessionId,
    // because it is more reliable across domains (alcat + mypu). Fall back to
    // direct scraping when Firebase is not configured or sessionId is missing.
    return !hasUsableFirebaseConfig() || (this.directSession != null && !this.sessionId);
  }

  private getCloudFunctionUrl(functionName: string): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extra = (Constants.expoConfig as any)?.extra ?? {};
    const projectId = extra.firebase?.projectId;
    const region = extra.cloudFunctionRegion ?? "asia-east1";

    if (!projectId) {
      throw new Error(
        "Firebase projectId not configured. Set EXPO_PUBLIC_FIREBASE_PROJECT_ID in env."
      );
    }

    return `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;
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
      const response = await fetch(this.getCloudFunctionUrl("puAuthenticate"), {
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

  // ---------------------------------------------------------------------------
  // Data fetching helper (Cloud Functions mode only)
  // ---------------------------------------------------------------------------

  private async fetchData<T>(dataType: string, extra: Record<string, unknown> = {}): Promise<T | null> {
    if (!this.sessionId) {
      console.warn(`[PUAdapter] No session for ${dataType}`);
      return null;
    }

    try {
      const response = await fetch(this.getCloudFunctionUrl("puFetchData"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { sessionId: this.sessionId, dataType, ...extra },
        }),
      });

      if (!response.ok) {
        console.warn(`[PUAdapter] puFetchData(${dataType}) HTTP ${response.status}`);
        return null;
      }

      const result = (await response.json()) as { result: T };
      return result.result;
    } catch (error) {
      console.warn(`[PUAdapter] puFetchData(${dataType}) error:`, error);
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
    // ── Direct mode: 快取優先 ──
    if (this.useDirectMode) {
      // 1. 試讀未過期快取
      const cached = await getCachedAnnouncements();
      if (cached) return this.mapAnnouncements(cached);

      // 2. 快取過期 → 重新抓取
      if (this.directSession) {
        const fresh = await refreshAnnouncements(this.directSession);
        if (fresh) return this.mapAnnouncements(fresh);
      }

      // 3. 抓取失敗 → 讀任何快取（離線模式）
      const stale = await getAnyCachedAnnouncements();
      if (stale) return this.mapAnnouncements(stale);

      return [];
    }

    // ── Cloud Functions mode ──
    type AnnouncementResponse = {
      success: boolean;
      announcements: Array<{ title: string; url: string; date: string }>;
    };

    const data = await this.fetchData<AnnouncementResponse>("announcements");
    if (!data?.success) return [];

    return data.announcements.map((item, i): Announcement => ({
      id: `pu-ann-${i}-${Date.now()}`,
      title: item.title,
      body: item.url,
      publishedAt: new Date(item.date).toISOString(),
      source: "靜宜大學 e校園",
    }));
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
    // ── Direct mode: 快取優先 ──
    if (this.useDirectMode) {
      // 1. 試讀未過期快取
      const cached = await getCachedCourses();
      if (cached) return this.mapCourses(cached, semester);

      // 2. 快取過期 → 重新抓取
      if (this.directSession) {
        const fresh = await refreshCourses(this.directSession);
        if (fresh) return this.mapCourses(fresh, semester);
      }

      // 3. 抓取失敗 → 讀任何快取（離線模式）
      const stale = await getAnyCachedCourses();
      if (stale) return this.mapCourses(stale, semester);

      return [];
    }

    // ── Cloud Functions mode ──
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
    if (!data?.success || !data.courses) return [];

    if (data.studentInfo?.studentId) this.studentId = data.studentInfo.studentId;
    if (data.studentInfo?.name) this.studentName = data.studentInfo.name;

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
    // ── Direct mode: 快取優先 ──
    if (this.useDirectMode) {
      // 1. 試讀未過期快取
      const cached = await getCachedGrades();
      if (cached) return this.mapGrades(cached, studentId, semester);

      // 2. 快取過期 → 重新抓取
      if (this.directSession) {
        const fresh = await refreshGrades(this.directSession);
        if (fresh) return this.mapGrades(fresh, studentId, semester);
      }

      // 3. 抓取失敗 → 讀任何快取（離線模式）
      const stale = await getAnyCachedGrades();
      if (stale) return this.mapGrades(stale, studentId, semester);

      return [];
    }

    // ── Cloud Functions mode ──
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
    if (!data?.success || !data.grades) return [];

    return data.grades.map((item, i): Grade => ({
      id: `pu-grade-${item.semester}-${i}`,
      courseId: `pu-crs-${item.semester}-${i}`,
      courseName: item.courseName,
      credits: item.credits,
      grade: typeof item.score === "number" ? item.score : parseFloat(String(item.score)) || 0,
      gradePoint: 0,
      semester: item.semester,
      userId: studentId || this.studentId || "",
    }));
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
      schoolId: "tw-pu",
    };
  }

  async listCourseSpaces(_userId?: string, _schoolId?: string): Promise<CourseSpace[]> {
    // 1. 讀快取的 TC 課程
    const courses = await getCachedTCCourses() ?? await getAnyCachedTCCourses() ?? [];
    if (courses.length === 0) return [];

    // 2. 讀快取的活動資料（可能為 null）
    const activitiesMap = await getCachedTCActivities() ?? await getAnyCachedTCActivities() ?? {};

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
    const modulesMap = await getCachedTCModules() ?? {};
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
    const todos = await getCachedTCTodos() ?? [];
    const courses = await getCachedTCCourses() ?? await getAnyCachedTCCourses() ?? [];
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
    const activitiesMap = await getCachedTCActivities() ?? await getAnyCachedTCActivities() ?? {};
    const courses = await getCachedTCCourses() ?? [];
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
    const attendance = await getCachedTCAttendance() ?? [];

    const filtered = courseSpaceId
      ? attendance.filter((a) => `tc-${a.course_id}` === courseSpaceId)
      : attendance;

    return filtered.map((a): AttendanceSession => ({
      id: `tc-att-${a.course_id}`,
      groupId: `tc-${a.course_id}`,
      groupName: a.course_name,
      active: false,
      attendeeCount: a.attended,
      startedAt: null,
      endedAt: null,
      source: "attendance",
    }));
  }

  async getAttendanceSummary(courseSpaceId: string): Promise<AttendanceSummary> {
    const attendance = await getCachedTCAttendance() ?? [];
    const courseId = parseInt(courseSpaceId.replace("tc-", ""), 10);
    const match = attendance.find((a) => a.course_id === courseId);

    return {
      groupId: courseSpaceId,
      totalSessions: match?.total_sessions ?? 0,
      activeSessions: 0,
      totalAttendees: match?.attended ?? 0,
      latestSession: null,
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
      const response = await fetch(this.getCloudFunctionUrl("puHealthCheck"), { method: "GET" });
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
