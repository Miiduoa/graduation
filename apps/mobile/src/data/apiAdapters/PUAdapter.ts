import { BaseApiAdapter } from "./BaseAdapter";
import type {
  AdapterCapabilities,
  AuthCredentials,
} from "./types";
import type { Announcement, ClubEvent, MenuItem, Poi, Course, Grade } from "../types";
import Constants from "expo-constants";

/**
 * Providence University (靜宜大學) adapter
 *
 * Calls Cloud Functions that act as scraping proxy for:
 *   - alcat.pu.edu.tw  (login, courses)
 *   - mypu.pu.edu.tw   (grades)
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

  private getCloudFunctionUrl(functionName: string): string {
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
  }

  // ---------------------------------------------------------------------------
  // Data fetching helper
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

  async listAnnouncements(): Promise<Announcement[]> {
    type AnnouncementResponse = {
      success: boolean;
      announcements: Array<{ title: string; url: string; date: string }>;
    };

    const data = await this.fetchData<AnnouncementResponse>("announcements");
    if (!data?.success) return [];

    return data.announcements.map((item, i): Announcement => ({
      id: `pu-ann-${i}-${Date.now()}`,
      title: item.title,
      body: item.url, // The URL acts as body since we only have link text
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

  async listCourses(studentId?: string, semester?: string): Promise<Course[]> {
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

    // Update student info if available
    if (data.studentInfo?.studentId) {
      this.studentId = data.studentInfo.studentId;
    }
    if (data.studentInfo?.name) {
      this.studentName = data.studentInfo.name;
    }

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

  async listGrades(studentId: string, semester?: string): Promise<Grade[]> {
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
      gradePoint: 0, // PU system doesn't use GPA points directly
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
    // Real approximate coordinates for Providence University campus
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
  // Health check
  // ---------------------------------------------------------------------------

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(this.getCloudFunctionUrl("puHealthCheck"), {
        method: "GET",
      });
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
