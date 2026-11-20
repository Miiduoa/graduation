import { BaseApiAdapter } from './BaseAdapter';
import type { AdapterCapabilities, AuthCredentials } from './types';
import type { Announcement, ClubEvent, MenuItem, Poi, Course, Grade } from '../types';
import { getAuthInstance } from '../../firebase';

type NchuGradeItem = {
  courseId: string;
  courseName: string;
  credits: number;
  grade: number | string;
  gradePoint?: number;
  semester: string;
};

/**
 * 將中興校務成績列綁定 adapter 權威 schoolId 與來源語意。
 * 不捏造 publishedAt；userId 沿用呼叫端傳入的 studentId。
 */
export function mapNchuOfficialGrades(
  items: NchuGradeItem[],
  args: {
    studentId: string;
    schoolId: string;
    gradeSource?: 'school-official' | 'school-official-offline';
  },
): Grade[] {
  const gradeSource = args.gradeSource ?? 'school-official';
  return items.map((item): Grade => {
    const rawGrade = typeof item.grade === 'string' ? item.grade.trim() : item.grade;
    const parsedGrade =
      typeof rawGrade === 'number'
        ? rawGrade
        : typeof rawGrade === 'string' && rawGrade !== ''
          ? Number(rawGrade)
          : NaN;
    const numericGrade = Number.isFinite(parsedGrade) ? parsedGrade : undefined;
    return {
      id: `nchu-grade-${item.courseId}-${item.semester}`,
      courseId: item.courseId,
      courseName: item.courseName,
      credits: item.credits,
      grade: numericGrade,
      letterGrade:
        numericGrade === undefined && typeof rawGrade === 'string' ? rawGrade : undefined,
      gradePoint: item.gradePoint,
      semester: item.semester,
      userId: args.studentId,
      schoolId: args.schoolId,
      gradeSource,
    };
  });
}

export class NCHUAdapter extends BaseApiAdapter {
  readonly schoolId = 'tw-nchu';
  readonly schoolName = '國立中興大學';
  readonly apiVersion = '1.0';

  private studentId: string | null = null;

  async authenticate(username: string, password: string): Promise<AuthCredentials> {
    const response = await this.request<{
      token: string;
      refreshToken: string;
      expiresIn: number;
      userId: string;
      studentId: string;
    }>('/auth/login', {
      method: 'POST',
      body: { username, password },
    });

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || '登入失敗');
    }

    this.credentials = {
      accessToken: response.data.token,
      refreshToken: response.data.refreshToken,
      expiresAt: Date.now() + response.data.expiresIn * 1000,
      userId: response.data.userId,
      studentId: response.data.studentId,
    };

    this.studentId = response.data.studentId;

    return this.credentials;
  }

  async refreshAuth(refreshToken: string): Promise<AuthCredentials> {
    const response = await this.request<{
      token: string;
      refreshToken: string;
      expiresIn: number;
    }>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });

    if (!response.success || !response.data) {
      throw new Error(response.error?.message || '刷新憑證失敗');
    }

    this.credentials = {
      ...this.credentials,
      accessToken: response.data.token,
      refreshToken: response.data.refreshToken,
      expiresAt: Date.now() + response.data.expiresIn * 1000,
    };

    return this.credentials;
  }

  async logout(): Promise<void> {
    if (this.credentials?.accessToken) {
      await this.request('/auth/logout', { method: 'POST' }).catch(() => {});
    }
    this.credentials = null;
    this.studentId = null;
  }

  async listAnnouncements(): Promise<Announcement[]> {
    const response = await this.request<{
      announcements: Array<{
        id: string;
        title: string;
        content: string;
        publishDate: string;
        department: string;
        category: string;
        attachments?: string[];
        isImportant?: boolean;
      }>;
    }>('/api/announcements');

    if (!response.success || !response.data) {
      console.warn('[NCHUAdapter] Failed to fetch announcements:', response.error);
      return [];
    }

    return response.data.announcements.map(
      (item): Announcement => ({
        id: `nchu-ann-${item.id}`,
        title: item.title,
        body: item.content,
        publishedAt: new Date(item.publishDate).toISOString(),
        source: item.department || item.category,
      }),
    );
  }

  async getAnnouncement(id: string): Promise<Announcement | null> {
    const realId = id.replace('nchu-ann-', '');
    const response = await this.request<{
      id: string;
      title: string;
      content: string;
      publishDate: string;
      department: string;
    }>(`/api/announcements/${realId}`);

    if (!response.success || !response.data) {
      return null;
    }

    const item = response.data;
    return {
      id: `nchu-ann-${item.id}`,
      title: item.title,
      body: item.content,
      publishedAt: new Date(item.publishDate).toISOString(),
      source: item.department,
    };
  }

  async listEvents(): Promise<ClubEvent[]> {
    const response = await this.request<{
      events: Array<{
        id: string;
        name: string;
        description: string;
        location: string;
        startTime: string;
        endTime: string;
        organizer: string;
        maxParticipants?: number;
        currentParticipants?: number;
        registrationDeadline?: string;
      }>;
    }>('/api/events');

    if (!response.success || !response.data) {
      console.warn('[NCHUAdapter] Failed to fetch events:', response.error);
      return [];
    }

    return response.data.events.map(
      (item): ClubEvent => ({
        id: `nchu-evt-${item.id}`,
        title: item.name,
        description: item.description,
        location: item.location,
        startsAt: new Date(item.startTime).toISOString(),
        endsAt: item.endTime
          ? new Date(item.endTime).toISOString()
          : new Date(item.startTime).toISOString(),
        capacity: item.maxParticipants,
        registeredCount: item.currentParticipants || 0,
      }),
    );
  }

  async listCourses(studentId?: string, semester?: string): Promise<Course[]> {
    const sid = studentId || this.studentId;
    if (!sid) {
      console.warn('[NCHUAdapter] No student ID available for courses');
      return [];
    }

    const params = new URLSearchParams();
    params.append('studentId', sid);
    if (semester) {
      params.append('semester', semester);
    }

    const response = await this.request<{
      courses: Array<{
        courseId: string;
        courseName: string;
        instructor: string;
        credits: number;
        schedule: Array<{
          day: number;
          startPeriod: number;
          endPeriod: number;
          classroom: string;
        }>;
      }>;
    }>(`/api/courses?${params.toString()}`);

    if (!response.success || !response.data) {
      console.warn('[NCHUAdapter] Failed to fetch courses:', response.error);
      return [];
    }

    const courses: Course[] = [];

    for (const course of response.data.courses) {
      for (const schedule of course.schedule) {
        const startTime = this.periodToTime(schedule.startPeriod);
        const endTime = this.periodToTime(schedule.endPeriod + 1);

        courses.push({
          id: `nchu-crs-${course.courseId}-${schedule.day}`,
          code: course.courseId,
          name: course.courseName,
          instructor: course.instructor,
          teacher: course.instructor,
          credits: course.credits,
          semester: semester ?? '未指定',
          schedule: [
            {
              dayOfWeek: schedule.day as 1 | 2 | 3 | 4 | 5 | 6 | 7,
              startTime,
              endTime,
              location: schedule.classroom,
            },
          ],
          dayOfWeek: schedule.day as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          startTime,
          endTime,
          location: schedule.classroom,
        });
      }
    }

    return courses;
  }

  private periodToTime(period: number): string {
    const periodTimes: Record<number, string> = {
      1: '08:10',
      2: '09:10',
      3: '10:10',
      4: '11:10',
      5: '13:10',
      6: '14:10',
      7: '15:10',
      8: '16:10',
      9: '17:10',
      10: '18:30',
      11: '19:25',
      12: '20:20',
      13: '21:15',
    };
    return periodTimes[period] || '08:00';
  }

  async listGrades(studentId: string, semester?: string): Promise<Grade[]> {
    const requester = getAuthInstance().currentUser;
    const credentials = this.credentials;
    if (
      !requester ||
      requester.uid !== studentId ||
      !credentials?.accessToken ||
      credentials.userId !== studentId
    ) {
      throw new Error('請重新連線學校帳號後再讀取成績。');
    }
    const params = new URLSearchParams();
    params.append('studentId', studentId);
    if (semester) {
      params.append('semester', semester);
    }

    const response = await this.request<{
      grades: NchuGradeItem[];
    }>(`/api/grades?${params.toString()}`);

    if (getAuthInstance().currentUser !== requester || this.credentials !== credentials) {
      throw new Error('帳號已變更，請重新讀取成績。');
    }
    if (!response.success || !Array.isArray(response.data?.grades)) {
      console.warn('[NCHUAdapter] Failed to fetch grades:', response.error);
      throw new Error(response.error?.message || '無法讀取校務成績，請稍後再試。');
    }

    // 成功但無列：空陣列（與讀取失敗區分）
    return mapNchuOfficialGrades(response.data.grades, {
      studentId,
      schoolId: this.schoolId,
      gradeSource: 'school-official',
    });
  }

  async listMenu(): Promise<MenuItem[]> {
    const response = await this.request<{
      menus: Array<{
        id: string;
        name: string;
        price: number;
        cafeteria: string;
        date: string;
        category?: string;
        calories?: number;
      }>;
    }>('/api/cafeteria/menu');

    if (!response.success || !response.data) {
      console.warn('[NCHUAdapter] Failed to fetch menu:', response.error);
      return [];
    }

    return response.data.menus.map(
      (item): MenuItem => ({
        id: `nchu-menu-${item.id}`,
        name: item.name,
        price: item.price,
        cafeteria: item.cafeteria,
        availableOn: item.date.split('T')[0],
      }),
    );
  }

  async listPois(): Promise<Poi[]> {
    const response = await this.request<{
      locations: Array<{
        id: string;
        name: string;
        type: string;
        latitude: number;
        longitude: number;
        description?: string;
        floor?: string;
        building?: string;
        openingHours?: string;
      }>;
    }>('/api/locations');

    if (!response.success || !response.data) {
      console.warn('[NCHUAdapter] Failed to fetch POIs:', response.error);
      return [];
    }

    return response.data.locations.map((item): Poi => {
      let category: 'building' | 'food' | 'office' | 'other' = 'other';
      const type = item.type.toLowerCase();
      if (type.includes('building') || type.includes('教學') || type.includes('大樓')) {
        category = 'building';
      } else if (type.includes('food') || type.includes('餐') || type.includes('食')) {
        category = 'food';
      } else if (type.includes('office') || type.includes('辦公') || type.includes('行政')) {
        category = 'office';
      }

      return {
        id: `nchu-poi-${item.id}`,
        name: item.name,
        category,
        lat: item.latitude,
        lng: item.longitude,
        description: item.description || '',
      };
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.request('/health', { timeout: 5000, retry: 1 });
      return response.success;
    } catch {
      return false;
    }
  }

  getCapabilities(): AdapterCapabilities {
    return {
      announcements: true,
      events: true,
      courses: true,
      grades: true,
      menu: true,
      pois: true,
      library: false,
      bus: false,
      sso: true,
      realtime: false,
    };
  }
}

export function createNCHUAdapter(): NCHUAdapter {
  return new NCHUAdapter();
}
