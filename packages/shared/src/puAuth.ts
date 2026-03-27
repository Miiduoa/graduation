export const PROVIDENCE_UNIVERSITY_SCHOOL_ID = "pu";
export const PROVIDENCE_UNIVERSITY_SCHOOL_CODE = "PU";

export type PuStudentInfoPayload = {
  studentId: string | null;
  name: string | null;
  className?: string | null;
  class?: string | null;
  currentSemester: string | null;
};

export type PuCoursePayload = {
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
};

export type PuCourseResultPayload = {
  courses: PuCoursePayload[];
  studentInfo: {
    class?: string | null;
    className?: string | null;
    studentId: string | null;
    name: string | null;
    currentSemester?: string | null;
  };
  semester: string | null;
  totalCredits: number;
};

export type PuGradePayload = {
  semester: string;
  courseName: string;
  courseNameEn: string;
  class?: string;
  className?: string;
  courseType: string;
  credits: number;
  score: number | string;
};

export type PuGradeResultPayload = {
  grades: PuGradePayload[];
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

export type PuAnnouncementPayload = {
  title: string;
  url: string;
  date: string;
};

export type PuStudentLoginRequest = {
  studentId: string;
  password: string;
};

export type PuStudentLoginResponse = {
  success: boolean;
  customToken?: string;
  uid: string;
  studentId: string;
  displayName: string;
  department: string;
  isNewUser: boolean;
  puSessionId?: string;
  tronClassSessionId?: string;
  tronClassUserId?: number | null;
  studentInfo?: PuStudentInfoPayload | null;
  courses?: PuCourseResultPayload | null;
  grades?: PuGradeResultPayload | null;
  announcements?: PuAnnouncementPayload[] | null;
};
