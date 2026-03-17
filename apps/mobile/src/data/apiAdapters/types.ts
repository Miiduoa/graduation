import type { 
  Announcement, 
  ClubEvent, 
  Course, 
  MenuItem, 
  Poi,
  Grade,
  LibraryBook,
  LibraryLoan,
  BusRoute,
  BusArrival,
} from "../types";

export type ApiConfig = {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  headers?: Record<string, string>;
};

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    timestamp?: string;
  };
};

export type AuthCredentials = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  userId?: string;
  studentId?: string;
};

export interface SchoolApiAdapter {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly apiVersion: string;
  
  initialize(config: ApiConfig): Promise<void>;
  
  authenticate?(username: string, password: string): Promise<AuthCredentials>;
  refreshAuth?(refreshToken: string): Promise<AuthCredentials>;
  logout?(): Promise<void>;
  
  listAnnouncements(): Promise<Announcement[]>;
  getAnnouncement?(id: string): Promise<Announcement | null>;
  
  listEvents(): Promise<ClubEvent[]>;
  getEvent?(id: string): Promise<ClubEvent | null>;
  
  listCourses?(studentId?: string, semester?: string): Promise<Course[]>;
  getCourse?(id: string): Promise<Course | null>;
  
  listGrades?(studentId: string, semester?: string): Promise<Grade[]>;
  
  listMenu(): Promise<MenuItem[]>;
  
  listPois(): Promise<Poi[]>;
  
  searchLibraryBooks?(query: string): Promise<LibraryBook[]>;
  listLibraryLoans?(studentId: string): Promise<LibraryLoan[]>;
  
  listBusRoutes?(): Promise<BusRoute[]>;
  getBusArrivals?(stopId: string): Promise<BusArrival[]>;
  
  isHealthy(): Promise<boolean>;
  
  getCapabilities(): AdapterCapabilities;
}

export type AdapterCapabilities = {
  announcements: boolean;
  events: boolean;
  courses: boolean;
  grades: boolean;
  menu: boolean;
  pois: boolean;
  library: boolean;
  bus: boolean;
  sso: boolean;
  realtime: boolean;
};

export type RawAnnouncementData = {
  id?: string;
  title?: string;
  content?: string;
  body?: string;
  text?: string;
  date?: string;
  publishedAt?: string;
  created_at?: string;
  timestamp?: number;
  source?: string;
  category?: string;
  department?: string;
  author?: string;
  attachments?: string[];
  [key: string]: unknown;
};

export type RawEventData = {
  id?: string;
  title?: string;
  name?: string;
  description?: string;
  content?: string;
  location?: string;
  venue?: string;
  place?: string;
  startTime?: string;
  endTime?: string;
  startsAt?: string;
  endsAt?: string;
  start_date?: string;
  end_date?: string;
  capacity?: number;
  maxParticipants?: number;
  registeredCount?: number;
  currentParticipants?: number;
  organizer?: string;
  club?: string;
  [key: string]: unknown;
};

export type RawCourseData = {
  id?: string;
  code?: string;
  courseId?: string;
  name?: string;
  title?: string;
  semester?: string;
  teacher?: string;
  instructor?: string;
  professor?: string;
  dayOfWeek?: number | string;
  day?: number | string;
  weekday?: string;
  startTime?: string;
  endTime?: string;
  time?: string;
  period?: string;
  location?: string;
  room?: string;
  classroom?: string;
  credits?: number;
  [key: string]: unknown;
};

export type RawMenuData = {
  id?: string;
  name?: string;
  title?: string;
  price?: number | string;
  cost?: number | string;
  cafeteria?: string;
  restaurant?: string;
  location?: string;
  date?: string;
  availableOn?: string;
  available_date?: string;
  category?: string;
  type?: string;
  description?: string;
  nutrition?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  [key: string]: unknown;
};

export type RawPoiData = {
  id?: string;
  name?: string;
  title?: string;
  category?: string;
  type?: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  location?: { lat: number; lng: number };
  coordinates?: [number, number];
  description?: string;
  info?: string;
  address?: string;
  floor?: string;
  building?: string;
  openingHours?: string;
  hours?: string;
  phone?: string;
  [key: string]: unknown;
};

export function normalizeAnnouncement(raw: RawAnnouncementData, schoolId: string): Announcement {
  const id = raw.id || `${schoolId}-ann-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const title = raw.title || "無標題";
  const body = raw.body || raw.content || raw.text || "";
  
  let publishedAt: string;
  if (raw.publishedAt) {
    publishedAt = raw.publishedAt;
  } else if (raw.date) {
    publishedAt = new Date(raw.date).toISOString();
  } else if (raw.created_at) {
    publishedAt = new Date(raw.created_at).toISOString();
  } else if (raw.timestamp) {
    publishedAt = new Date(raw.timestamp).toISOString();
  } else {
    publishedAt = new Date().toISOString();
  }
  
  const source = raw.source || raw.department || raw.category;
  
  return {
    id,
    title,
    body,
    publishedAt,
    source,
  };
}

export function normalizeEvent(raw: RawEventData, schoolId: string): ClubEvent {
  const id = raw.id || `${schoolId}-evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const title = raw.title || raw.name || "無標題";
  const description = raw.description || raw.content || "";
  const location = raw.location || raw.venue || raw.place;
  
  let startsAt: string;
  if (raw.startsAt) {
    startsAt = raw.startsAt;
  } else if (raw.startTime) {
    startsAt = new Date(raw.startTime).toISOString();
  } else if (raw.start_date) {
    startsAt = new Date(raw.start_date).toISOString();
  } else {
    startsAt = new Date().toISOString();
  }
  
  let endsAt: string | undefined;
  if (raw.endsAt) {
    endsAt = raw.endsAt;
  } else if (raw.endTime) {
    endsAt = new Date(raw.endTime).toISOString();
  } else if (raw.end_date) {
    endsAt = new Date(raw.end_date).toISOString();
  }
  
  const capacity = raw.capacity || raw.maxParticipants;
  const registeredCount = raw.registeredCount || raw.currentParticipants || 0;
  
  return {
    id,
    title,
    description,
    location,
    startsAt,
    endsAt,
    capacity,
    registeredCount,
  };
}

export function normalizeCourse(raw: RawCourseData, schoolId: string): Course {
  const id = raw.id || raw.courseId || raw.code || `${schoolId}-crs-${Date.now()}`;
  const code = raw.code || raw.courseId || id;
  const name = raw.name || raw.title || "未知課程";
  const teacher = raw.teacher || raw.instructor || raw.professor || "未知教師";
  const location = String(raw.location || raw.room || raw.classroom || "未指定地點");
  
  let dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7 = 1;
  if (typeof raw.dayOfWeek === "number") {
    dayOfWeek = Math.max(1, Math.min(7, raw.dayOfWeek)) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  } else if (typeof raw.day === "number") {
    dayOfWeek = Math.max(1, Math.min(7, raw.day)) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  } else if (raw.weekday) {
    const weekdayMap: Record<string, number> = {
      "monday": 1, "mon": 1, "一": 1, "週一": 1,
      "tuesday": 2, "tue": 2, "二": 2, "週二": 2,
      "wednesday": 3, "wed": 3, "三": 3, "週三": 3,
      "thursday": 4, "thu": 4, "四": 4, "週四": 4,
      "friday": 5, "fri": 5, "五": 5, "週五": 5,
      "saturday": 6, "sat": 6, "六": 6, "週六": 6,
      "sunday": 7, "sun": 7, "日": 7, "週日": 7,
    };
    dayOfWeek = (weekdayMap[raw.weekday.toLowerCase()] || 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
  }
  
  const startTime = raw.startTime || "08:00";
  const endTime = raw.endTime || "09:00";
  
  return {
    id,
    code,
    name,
    instructor: teacher,
    teacher,
    credits: raw.credits ?? 0,
    semester: typeof raw.semester === "string" ? raw.semester : "未指定",
    schedule: [
      {
        dayOfWeek,
        startTime,
        endTime,
        location,
      },
    ],
    dayOfWeek,
    startTime,
    endTime,
    location,
  };
}

export function normalizeMenuItem(raw: RawMenuData, schoolId: string): MenuItem {
  const id = raw.id || `${schoolId}-menu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const name = raw.name || raw.title || "未知餐點";
  const cafeteria = raw.cafeteria || raw.restaurant || raw.location || "未知餐廳";
  
  let price: number | undefined;
  if (typeof raw.price === "number") {
    price = raw.price;
  } else if (typeof raw.cost === "number") {
    price = raw.cost;
  } else if (typeof raw.price === "string") {
    price = parseFloat(raw.price) || undefined;
  }
  
  let availableOn: string;
  if (raw.availableOn) {
    availableOn = raw.availableOn;
  } else if (raw.date) {
    availableOn = raw.date.split("T")[0];
  } else if (raw.available_date) {
    availableOn = raw.available_date;
  } else {
    availableOn = new Date().toISOString().split("T")[0];
  }
  
  return {
    id,
    name,
    cafeteria,
    price,
    availableOn,
  };
}

export function normalizePoi(raw: RawPoiData, schoolId: string): Poi {
  const id = raw.id || `${schoolId}-poi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const name = raw.name || raw.title || "未知地點";
  
  let category: "building" | "food" | "office" | "other" = "other";
  const rawCategory = (raw.category || raw.type || "").toLowerCase();
  if (rawCategory.includes("building") || rawCategory.includes("教學") || rawCategory.includes("大樓")) {
    category = "building";
  } else if (rawCategory.includes("food") || rawCategory.includes("餐") || rawCategory.includes("食")) {
    category = "food";
  } else if (rawCategory.includes("office") || rawCategory.includes("辦公") || rawCategory.includes("行政")) {
    category = "office";
  }
  
  let lat = 0, lng = 0;
  if (raw.lat !== undefined && raw.lng !== undefined) {
    lat = raw.lat;
    lng = raw.lng;
  } else if (raw.latitude !== undefined && raw.longitude !== undefined) {
    lat = raw.latitude;
    lng = raw.longitude;
  } else if (raw.location) {
    lat = raw.location.lat;
    lng = raw.location.lng;
  } else if (raw.coordinates && raw.coordinates.length === 2) {
    [lat, lng] = raw.coordinates;
  }
  
  const description = raw.description || raw.info || raw.address;
  
  return {
    id,
    name,
    category,
    lat,
    lng,
    description: description || "",
  };
}
