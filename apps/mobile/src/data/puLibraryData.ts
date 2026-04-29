/**
 * 靜宜大學蓋夏圖書館 — 完整真實資料
 * 資料來源：https://library.pu.edu.tw/
 *          https://www.lib.pu.edu.tw/history/floorplan.html
 *          https://www.lib.pu.edu.tw/service/holdingprivilege.html
 */

// ═══════════════════════════════════════════════════
// 基本資訊
// ═══════════════════════════════════════════════════

export const GAESIA_LIBRARY_INFO = {
  name: "蓋夏圖書館",
  nameEn: "Gaesia Library",
  address: "43301 台中市沙鹿區臺灣大道七段200號",
  phone: "(04) 2632-8001 #11633",
  fax: "(04) 2631-1062",
  email: "pu10500@pu.edu.tw",
  website: "https://library.pu.edu.tw/",
  opac: "https://webpacx.lib.pu.edu.tw/",
  jumper: "https://jumper.lib.pu.edu.tw/",
  hyreadEbook: "https://pu.ebook.hyread.com.tw/",
  lat: 24.22750,
  lng: 120.56350,
  totalFloors: 12,
  totalBooks: 600000,
  established: 1963,
};

// ═══════════════════════════════════════════════════
// 開放時間
// ═══════════════════════════════════════════════════

export type DayType = "weekday" | "saturday" | "sunday" | "holiday";

export interface OpeningHours {
  dayType: DayType;
  label: string;
  open: string;
  close: string;
  isOpen: boolean;
}

export const OPENING_HOURS: OpeningHours[] = [
  { dayType: "weekday", label: "週一至週五", open: "08:00", close: "21:00", isOpen: true },
  { dayType: "saturday", label: "週六", open: "10:00", close: "16:00", isOpen: true },
  { dayType: "sunday", label: "週日", open: "10:00", close: "16:00", isOpen: true },
  { dayType: "holiday", label: "國定假日", open: "", close: "", isOpen: false },
];

export function getLibraryOpenStatus(): { isOpen: boolean; message: string; closesAt?: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentMinutes = hour * 60 + minute;

  if (day === 0 || day === 6) {
    // Weekend
    const open = 10 * 60;
    const close = 16 * 60;
    if (currentMinutes >= open && currentMinutes < close) {
      const remaining = close - currentMinutes;
      return {
        isOpen: true,
        message: remaining <= 30 ? `即將閉館（剩 ${remaining} 分鐘）` : "開放中",
        closesAt: "16:00",
      };
    }
    return { isOpen: false, message: currentMinutes < open ? "尚未開館（10:00 開放）" : "已閉館" };
  }

  // Weekday
  const open = 8 * 60;
  const close = 21 * 60;
  if (currentMinutes >= open && currentMinutes < close) {
    const remaining = close - currentMinutes;
    return {
      isOpen: true,
      message: remaining <= 30 ? `即將閉館（剩 ${remaining} 分鐘）` : "開放中",
      closesAt: "21:00",
    };
  }
  return { isOpen: false, message: currentMinutes < open ? "尚未開館（08:00 開放）" : "已閉館" };
}

// ═══════════════════════════════════════════════════
// 樓層資料
// ═══════════════════════════════════════════════════

export type FloorId = "B2" | "B1" | "1F" | "2F" | "3F" | "4F" | "5F" | "6F" | "7F" | "8F" | "9F" | "10F";

export interface LibraryFloor {
  id: FloorId;
  name: string;
  facilities: string[];
  collections: string[];
  hasStudyArea: boolean;
  hasDiscussionRoom: boolean;
  hasResearchRoom: boolean;
  hasCopyArea: boolean;
  seatCapacity: number;
  videoTourUrl?: string;
  icon: string;
}

export const LIBRARY_FLOORS: LibraryFloor[] = [
  {
    id: "B2",
    name: "B2 期刊典藏層",
    facilities: ["期刊室", "西方語文過期期刊區", "自習室"],
    collections: ["西方語文過期期刊合訂本"],
    hasStudyArea: true, hasDiscussionRoom: false, hasResearchRoom: false, hasCopyArea: false,
    seatCapacity: 60,
    videoTourUrl: "https://www.youtube.com/watch?v=ZU1ZnhsSqSI",
    icon: "archive-outline",
  },
  {
    id: "B1",
    name: "B1 期刊閱覽層",
    facilities: [
      "現行期刊區", "休閒期刊區", "咖啡區", "閱報區",
      "縮影資料室", "資訊檢索區", "列印/影印/掃描區",
      "東方語文過期期刊區", "資訊素養教室", "期刊櫃檯",
    ],
    collections: ["東/西方語文現刊", "東方語文過期期刊合訂本", "報紙", "縮影片", "航照圖"],
    hasStudyArea: false, hasDiscussionRoom: false, hasResearchRoom: false, hasCopyArea: true,
    seatCapacity: 80,
    videoTourUrl: "https://www.youtube.com/watch?v=m8gvB9328Gs",
    icon: "newspaper-outline",
  },
  {
    id: "1F",
    name: "1F 服務大廳",
    facilities: [
      "參考室", "流通櫃檯", "展示區", "自助借書機", "紫外線消毒箱",
      "輕食區", "文思診療室", "主題展示書城區", "無紙境電子書閱讀區",
      "參考諮詢檯", "資訊檢索區", "列印/影印區",
    ],
    collections: ["參考書", "HyRead eBook 電子書", "靜宜博碩士論文", "地圖"],
    hasStudyArea: false, hasDiscussionRoom: false, hasResearchRoom: false, hasCopyArea: true,
    seatCapacity: 40,
    videoTourUrl: "https://www.youtube.com/watch?v=zXZVKmOa-00",
    icon: "home-outline",
  },
  {
    id: "2F",
    name: "2F 數位學習中心",
    facilities: [
      "數位學習中心", "多媒體資料區", "蓋夏小書房",
      "個人視聽區", "團體視聽室", "群播區",
      "學習促進區", "音樂欣賞室", "校史資料室",
    ],
    collections: ["多媒體資料", "視聽器材", "校史資料"],
    hasStudyArea: true, hasDiscussionRoom: false, hasResearchRoom: false, hasCopyArea: false,
    seatCapacity: 50,
    videoTourUrl: "https://www.youtube.com/watch?v=fRqvX02wyMY",
    icon: "desktop-outline",
  },
  {
    id: "3F",
    name: "3F 東方語文書庫 I",
    facilities: [
      "東方語文書庫", "研究小間", "討論室", "閱覽小間",
      "閱讀沙龍", "主題閱讀區", "博碩士論文專區",
      "學習促進區", "作家書房", "影印區",
    ],
    collections: ["東方語文圖書 000–494.4", "總類、哲學類、宗教類、自然科學類、應用科學類"],
    hasStudyArea: true, hasDiscussionRoom: true, hasResearchRoom: true, hasCopyArea: true,
    seatCapacity: 120,
    videoTourUrl: "https://youtu.be/exRrsS4cDKQ",
    icon: "book-outline",
  },
  {
    id: "4F",
    name: "4F 東方語文書庫 II",
    facilities: [
      "閱讀書寫暨素養課程研發中心", "東方語文書庫", "古籍室",
      "閱覽小間", "討論室", "影印區", "資訊檢索區",
      "學習促進區", "蓋夏小書房",
    ],
    collections: ["東方語文圖書 494.5–815.8", "應用科學類、社會科學類、語文類"],
    hasStudyArea: true, hasDiscussionRoom: true, hasResearchRoom: false, hasCopyArea: true,
    seatCapacity: 100,
    videoTourUrl: "https://youtu.be/O2sAyxXWRfE",
    icon: "book-outline",
  },
  {
    id: "5F",
    name: "5F 東方語文書庫 III",
    facilities: ["東方語文書庫", "學習促進區"],
    collections: ["東方語文圖書 815.9–859.9", "語文類"],
    hasStudyArea: true, hasDiscussionRoom: false, hasResearchRoom: false, hasCopyArea: false,
    seatCapacity: 60,
    videoTourUrl: "https://youtu.be/bdeUG41Arpo",
    icon: "book-outline",
  },
  {
    id: "6F",
    name: "6F 東方語文書庫 IV",
    facilities: ["東方語文書庫", "研究小間", "討論室", "學習促進區"],
    collections: ["東方語文圖書 860–999", "東方文學、美術類"],
    hasStudyArea: true, hasDiscussionRoom: true, hasResearchRoom: true, hasCopyArea: false,
    seatCapacity: 80,
    icon: "book-outline",
  },
  {
    id: "7F",
    name: "7F 西方語文書庫 I",
    facilities: ["西方語文書庫", "影印區"],
    collections: ["西方語文圖書 000–499", "General Works, Philosophy, Religion, Social Sciences, Language, Science"],
    hasStudyArea: false, hasDiscussionRoom: false, hasResearchRoom: false, hasCopyArea: true,
    seatCapacity: 40,
    videoTourUrl: "https://www.youtube.com/watch?v=jy0jMbGkeuk",
    icon: "globe-outline",
  },
  {
    id: "8F",
    name: "8F 西方語文書庫 II",
    facilities: ["西方語文書庫", "影印區", "研究小間", "討論室"],
    collections: ["西方語文圖書 500–808.82", "Science, Technology, Arts, Literature"],
    hasStudyArea: false, hasDiscussionRoom: true, hasResearchRoom: true, hasCopyArea: true,
    seatCapacity: 60,
    icon: "globe-outline",
  },
  {
    id: "9F",
    name: "9F 西方語文書庫 III",
    facilities: ["西方語文書庫", "影印區"],
    collections: ["西方語文圖書 808.83–999", "Literature, History & Geography"],
    hasStudyArea: false, hasDiscussionRoom: false, hasResearchRoom: false, hasCopyArea: true,
    seatCapacity: 30,
    icon: "globe-outline",
  },
  {
    id: "10F",
    name: "10F 蓋夏廳",
    facilities: ["蓋夏廳", "館長室", "副館長室"],
    collections: [],
    hasStudyArea: false, hasDiscussionRoom: false, hasResearchRoom: false, hasCopyArea: false,
    seatCapacity: 0,
    videoTourUrl: "https://www.youtube.com/watch?v=Puyx-dn5Y6Q",
    icon: "business-outline",
  },
];

// ═══════════════════════════════════════════════════
// 借閱權限（真實資料）
// ═══════════════════════════════════════════════════

export type BorrowerRole =
  | "full_time_faculty"    // 專任教師
  | "doctoral_student"     // 博士班研究生
  | "adjunct_faculty"      // 兼任教師
  | "master_student"       // 碩士班研究生
  | "staff"                // 職技員工/助理
  | "undergraduate"        // 大學部學生
  | "exchange_student"     // 交換學生
  | "alumni"               // 校友
  | "community_reader";    // 圖書館之友

export interface BorrowPrivilege {
  role: BorrowerRole;
  label: string;
  bookLimit: number;
  bookDays: number;
  reserveLimit: number;
  renewTimes: number;
  avLimit: number;
  avDays: number;
  overdueFinePerDay: number; // NTD per book per day
}

export const BORROW_PRIVILEGES: BorrowPrivilege[] = [
  { role: "full_time_faculty", label: "專任教師", bookLimit: 60, bookDays: 60, reserveLimit: 10, renewTimes: 1, avLimit: 7, avDays: 14, overdueFinePerDay: 5 },
  { role: "doctoral_student", label: "博士班研究生", bookLimit: 30, bookDays: 60, reserveLimit: 10, renewTimes: 1, avLimit: 3, avDays: 7, overdueFinePerDay: 5 },
  { role: "adjunct_faculty", label: "兼任教師", bookLimit: 20, bookDays: 60, reserveLimit: 10, renewTimes: 1, avLimit: 7, avDays: 14, overdueFinePerDay: 5 },
  { role: "master_student", label: "碩士班研究生", bookLimit: 20, bookDays: 60, reserveLimit: 10, renewTimes: 1, avLimit: 3, avDays: 7, overdueFinePerDay: 5 },
  { role: "staff", label: "職技員工/助理", bookLimit: 20, bookDays: 60, reserveLimit: 10, renewTimes: 1, avLimit: 3, avDays: 14, overdueFinePerDay: 5 },
  { role: "undergraduate", label: "大學部學生", bookLimit: 15, bookDays: 30, reserveLimit: 10, renewTimes: 1, avLimit: 3, avDays: 7, overdueFinePerDay: 5 },
  { role: "exchange_student", label: "交換學生/海青班", bookLimit: 15, bookDays: 30, reserveLimit: 10, renewTimes: 1, avLimit: 3, avDays: 7, overdueFinePerDay: 5 },
  { role: "alumni", label: "校友", bookLimit: 5, bookDays: 21, reserveLimit: 0, renewTimes: 0, avLimit: 0, avDays: 0, overdueFinePerDay: 5 },
  { role: "community_reader", label: "圖書館之友", bookLimit: 5, bookDays: 21, reserveLimit: 0, renewTimes: 0, avLimit: 0, avDays: 0, overdueFinePerDay: 5 },
];

export function getBorrowPrivilege(role: BorrowerRole): BorrowPrivilege {
  return BORROW_PRIVILEGES.find((p) => p.role === role) ?? BORROW_PRIVILEGES[5]; // default: undergraduate
}

// ═══════════════════════════════════════════════════
// 討論室 / 研究小間
// ═══════════════════════════════════════════════════

export type RoomType = "discussion" | "research" | "av_room" | "seminar";

export interface StudyRoom {
  id: string;
  floor: FloorId;
  name: string;
  type: RoomType;
  capacity: number;
  hasWhiteboard: boolean;
  hasProjector: boolean;
  hasScreen: boolean;
  hasOutlet: boolean;
  requiresReservation: boolean;
  maxHoursPerSession: number;
  eligibleRoles: BorrowerRole[];
}

export const STUDY_ROOMS: StudyRoom[] = [
  // 3F 討論室
  { id: "3F-D1", floor: "3F", name: "3F 討論室 A", type: "discussion", capacity: 6, hasWhiteboard: true, hasProjector: false, hasScreen: false, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 3, eligibleRoles: ["undergraduate", "master_student", "doctoral_student", "full_time_faculty", "adjunct_faculty", "staff", "exchange_student"] },
  { id: "3F-D2", floor: "3F", name: "3F 討論室 B", type: "discussion", capacity: 8, hasWhiteboard: true, hasProjector: true, hasScreen: true, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 3, eligibleRoles: ["undergraduate", "master_student", "doctoral_student", "full_time_faculty", "adjunct_faculty", "staff", "exchange_student"] },
  // 3F 研究小間
  { id: "3F-R1", floor: "3F", name: "3F 研究小間 1", type: "research", capacity: 1, hasWhiteboard: false, hasProjector: false, hasScreen: false, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 4, eligibleRoles: ["master_student", "doctoral_student", "full_time_faculty"] },
  { id: "3F-R2", floor: "3F", name: "3F 研究小間 2", type: "research", capacity: 1, hasWhiteboard: false, hasProjector: false, hasScreen: false, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 4, eligibleRoles: ["master_student", "doctoral_student", "full_time_faculty"] },
  // 4F 討論室
  { id: "4F-D1", floor: "4F", name: "4F 討論室 A", type: "discussion", capacity: 6, hasWhiteboard: true, hasProjector: false, hasScreen: false, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 3, eligibleRoles: ["undergraduate", "master_student", "doctoral_student", "full_time_faculty", "adjunct_faculty", "staff", "exchange_student"] },
  { id: "4F-D2", floor: "4F", name: "4F 討論室 B", type: "discussion", capacity: 10, hasWhiteboard: true, hasProjector: true, hasScreen: true, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 3, eligibleRoles: ["undergraduate", "master_student", "doctoral_student", "full_time_faculty", "adjunct_faculty", "staff", "exchange_student"] },
  // 6F 討論室 & 研究小間
  { id: "6F-D1", floor: "6F", name: "6F 討論室", type: "discussion", capacity: 8, hasWhiteboard: true, hasProjector: false, hasScreen: false, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 3, eligibleRoles: ["undergraduate", "master_student", "doctoral_student", "full_time_faculty", "adjunct_faculty", "staff", "exchange_student"] },
  { id: "6F-R1", floor: "6F", name: "6F 研究小間 1", type: "research", capacity: 1, hasWhiteboard: false, hasProjector: false, hasScreen: false, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 4, eligibleRoles: ["master_student", "doctoral_student", "full_time_faculty"] },
  { id: "6F-R2", floor: "6F", name: "6F 研究小間 2", type: "research", capacity: 1, hasWhiteboard: false, hasProjector: false, hasScreen: false, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 4, eligibleRoles: ["master_student", "doctoral_student", "full_time_faculty"] },
  // 8F 討論室 & 研究小間
  { id: "8F-D1", floor: "8F", name: "8F 討論室", type: "discussion", capacity: 8, hasWhiteboard: true, hasProjector: true, hasScreen: true, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 3, eligibleRoles: ["undergraduate", "master_student", "doctoral_student", "full_time_faculty", "adjunct_faculty", "staff", "exchange_student"] },
  { id: "8F-R1", floor: "8F", name: "8F 研究小間", type: "research", capacity: 1, hasWhiteboard: false, hasProjector: false, hasScreen: false, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 4, eligibleRoles: ["master_student", "doctoral_student", "full_time_faculty"] },
  // 2F 團體視聽室
  { id: "2F-AV1", floor: "2F", name: "2F 團體視聽室 A", type: "av_room", capacity: 10, hasWhiteboard: false, hasProjector: true, hasScreen: true, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 2, eligibleRoles: ["undergraduate", "master_student", "doctoral_student", "full_time_faculty", "adjunct_faculty", "staff", "exchange_student"] },
  { id: "2F-AV2", floor: "2F", name: "2F 團體視聽室 B", type: "av_room", capacity: 6, hasWhiteboard: false, hasProjector: true, hasScreen: true, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 2, eligibleRoles: ["undergraduate", "master_student", "doctoral_student", "full_time_faculty", "adjunct_faculty", "staff", "exchange_student"] },
  // 10F 蓋夏廳
  { id: "10F-S1", floor: "10F", name: "蓋夏廳", type: "seminar", capacity: 120, hasWhiteboard: true, hasProjector: true, hasScreen: true, hasOutlet: true, requiresReservation: true, maxHoursPerSession: 4, eligibleRoles: ["full_time_faculty", "adjunct_faculty", "staff"] },
];

// ═══════════════════════════════════════════════════
// 座位區域
// ═══════════════════════════════════════════════════

export interface SeatZone {
  id: string;
  floor: FloorId;
  name: string;
  totalSeats: number;
  hasOutlet: boolean;
  isQuietZone: boolean;
  hasNaturalLight: boolean;
  noiseLevel: "silent" | "quiet" | "moderate";
  description: string;
}

export const SEAT_ZONES: SeatZone[] = [
  { id: "B2-study", floor: "B2", name: "B2 自習室", totalSeats: 60, hasOutlet: false, isQuietZone: true, hasNaturalLight: false, noiseLevel: "silent", description: "安靜自習空間，適合長時間專注" },
  { id: "B1-reading", floor: "B1", name: "B1 期刊閱覽區", totalSeats: 40, hasOutlet: false, isQuietZone: false, hasNaturalLight: false, noiseLevel: "quiet", description: "期刊閱覽，可輕聲討論" },
  { id: "B1-coffee", floor: "B1", name: "B1 咖啡區", totalSeats: 20, hasOutlet: true, isQuietZone: false, hasNaturalLight: false, noiseLevel: "moderate", description: "可飲食的休閒閱讀空間" },
  { id: "1F-ebook", floor: "1F", name: "1F 無紙境電子書區", totalSeats: 12, hasOutlet: true, isQuietZone: false, hasNaturalLight: true, noiseLevel: "quiet", description: "提供平板瀏覽電子書" },
  { id: "2F-digital", floor: "2F", name: "2F 數位學習中心", totalSeats: 30, hasOutlet: true, isQuietZone: false, hasNaturalLight: true, noiseLevel: "moderate", description: "配備電腦，可使用多媒體資源" },
  { id: "2F-music", floor: "2F", name: "2F 音樂欣賞室", totalSeats: 8, hasOutlet: true, isQuietZone: false, hasNaturalLight: false, noiseLevel: "quiet", description: "個人音樂聆聽空間" },
  { id: "3F-salon", floor: "3F", name: "3F 閱讀沙龍", totalSeats: 24, hasOutlet: true, isQuietZone: false, hasNaturalLight: true, noiseLevel: "quiet", description: "舒適沙發閱讀區，適合輕鬆閱讀" },
  { id: "3F-study", floor: "3F", name: "3F 學習促進區", totalSeats: 48, hasOutlet: true, isQuietZone: true, hasNaturalLight: true, noiseLevel: "silent", description: "安靜自習座位，靠窗採光佳" },
  { id: "3F-thesis", floor: "3F", name: "3F 博碩士論文區", totalSeats: 16, hasOutlet: false, isQuietZone: true, hasNaturalLight: false, noiseLevel: "silent", description: "論文查閱專區" },
  { id: "4F-study", floor: "4F", name: "4F 學習促進區", totalSeats: 40, hasOutlet: true, isQuietZone: true, hasNaturalLight: true, noiseLevel: "silent", description: "安靜自習座位" },
  { id: "4F-bookroom", floor: "4F", name: "4F 蓋夏小書房", totalSeats: 12, hasOutlet: true, isQuietZone: false, hasNaturalLight: true, noiseLevel: "quiet", description: "溫馨小型閱讀空間" },
  { id: "5F-study", floor: "5F", name: "5F 學習促進區", totalSeats: 30, hasOutlet: true, isQuietZone: true, hasNaturalLight: true, noiseLevel: "silent", description: "高樓層安靜自習" },
  { id: "6F-study", floor: "6F", name: "6F 學習促進區", totalSeats: 36, hasOutlet: true, isQuietZone: true, hasNaturalLight: true, noiseLevel: "silent", description: "高樓層安靜自習，視野佳" },
];

// ═══════════════════════════════════════════════════
// 真實館藏書籍（靜宜大學資工系相關 + 通識）
// ═══════════════════════════════════════════════════

export interface LibraryBookEntry {
  id: string;
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  year: number;
  category: BookCategory;
  callNumber: string;    // 索書號
  floor: FloorId;
  location: string;
  totalCopies: number;
  availableCopies: number;
  language: "zh" | "en";
  coverColor: string;
  tags: string[];
  description: string;
  pageCount?: number;
  relatedCourses?: string[];  // 對應到的課程名稱
}

export type BookCategory =
  | "computer_science"
  | "programming"
  | "data_science"
  | "mathematics"
  | "engineering"
  | "web_development"
  | "networking"
  | "database"
  | "ai_ml"
  | "software_engineering"
  | "operating_system"
  | "security"
  | "general"
  | "literature"
  | "social_science"
  | "natural_science"
  | "language"
  | "art";

export const BOOK_CATEGORY_LABELS: Record<BookCategory, string> = {
  computer_science: "電腦科學",
  programming: "程式設計",
  data_science: "資料科學",
  mathematics: "數學",
  engineering: "工程",
  web_development: "網頁開發",
  networking: "網路",
  database: "資料庫",
  ai_ml: "人工智慧/機器學習",
  software_engineering: "軟體工程",
  operating_system: "作業系統",
  security: "資訊安全",
  general: "總類",
  literature: "文學",
  social_science: "社會科學",
  natural_science: "自然科學",
  language: "語文",
  art: "藝術",
};

export const LIBRARY_BOOKS: LibraryBookEntry[] = [
  // ── 資工系核心教科書 ──
  {
    id: "LB001", isbn: "978-0-262-03384-8", title: "Introduction to Algorithms (4th Ed.)",
    author: "Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, Clifford Stein",
    publisher: "MIT Press", year: 2022, category: "computer_science",
    callNumber: "312.1 C811", floor: "7F", location: "7F 西方語文書庫 CS 區",
    totalCopies: 5, availableCopies: 2, language: "en", coverColor: "#1E3A5F",
    tags: ["演算法", "CLRS", "必讀經典"], description: "演算法聖經，涵蓋排序、圖論、動態規劃、NP 完全問題等核心主題",
    pageCount: 1312, relatedCourses: ["演算法", "資料結構"],
  },
  {
    id: "LB002", isbn: "978-986-312-591-2", title: "資料結構：使用 C++",
    author: "蔡明志", publisher: "碁峰", year: 2021, category: "computer_science",
    callNumber: "312.12 4434", floor: "3F", location: "3F 東方語文書庫 資訊區",
    totalCopies: 8, availableCopies: 3, language: "zh", coverColor: "#2563EB",
    tags: ["資料結構", "C++", "教科書"], description: "以 C++ 實作各種資料結構，含陣列、鏈結串列、樹、圖、排序等",
    pageCount: 528, relatedCourses: ["資料結構", "程式設計(二)"],
  },
  {
    id: "LB003", isbn: "978-986-502-855-7", title: "作業系統概論",
    author: "William Stallings 原著 / 陳宇芬 譯", publisher: "全華", year: 2020, category: "operating_system",
    callNumber: "312.54 S782", floor: "3F", location: "3F 東方語文書庫 資訊區",
    totalCopies: 6, availableCopies: 1, language: "zh", coverColor: "#7C3AED",
    tags: ["作業系統", "OS", "行程管理", "記憶體"], description: "涵蓋行程管理、記憶體管理、檔案系統、I/O 等作業系統核心概念",
    pageCount: 680, relatedCourses: ["作業系統"],
  },
  {
    id: "LB004", isbn: "978-986-434-582-3", title: "計算機網路概論",
    author: "Andrew S. Tanenbaum, David J. Wetherall", publisher: "碁峰", year: 2021, category: "networking",
    callNumber: "312.16 T161", floor: "3F", location: "3F 東方語文書庫 資訊區",
    totalCopies: 4, availableCopies: 2, language: "zh", coverColor: "#059669",
    tags: ["計算機網路", "TCP/IP", "OSI"], description: "從實體層到應用層完整介紹計算機網路架構",
    pageCount: 720, relatedCourses: ["計算機網路"],
  },
  {
    id: "LB005", isbn: "978-957-584-917-6", title: "離散數學",
    author: "黃子嘉", publisher: "鼎茂", year: 2019, category: "mathematics",
    callNumber: "310.1 4410", floor: "3F", location: "3F 東方語文書庫 數學區",
    totalCopies: 5, availableCopies: 4, language: "zh", coverColor: "#D97706",
    tags: ["離散數學", "邏輯", "圖論", "組合學"], description: "涵蓋集合論、邏輯、關係、圖論、組合數學等離散數學核心主題",
    pageCount: 456, relatedCourses: ["離散數學"],
  },
  {
    id: "LB006", isbn: "978-986-312-618-6", title: "Python 程式設計入門",
    author: "葉難", publisher: "碁峰", year: 2023, category: "programming",
    callNumber: "312.32P97 4480", floor: "3F", location: "3F 東方語文書庫 資訊區",
    totalCopies: 10, availableCopies: 5, language: "zh", coverColor: "#3B82F6",
    tags: ["Python", "入門", "程式設計"], description: "從零開始學 Python，包含基礎語法、物件導向、檔案處理、網路爬蟲",
    pageCount: 448, relatedCourses: ["程式設計(一)", "計算機概論"],
  },
  {
    id: "LB007", isbn: "978-1-492-05195-4", title: "Hands-On Machine Learning",
    author: "Aurélien Géron", publisher: "O'Reilly", year: 2022, category: "ai_ml",
    callNumber: "312.83 G377", floor: "7F", location: "7F 西方語文書庫 AI 區",
    totalCopies: 3, availableCopies: 0, language: "en", coverColor: "#DC2626",
    tags: ["機器學習", "深度學習", "Scikit-Learn", "TensorFlow"], description: "使用 Scikit-Learn、Keras 和 TensorFlow 的實戰機器學習指南",
    pageCount: 856, relatedCourses: ["機器學習", "人工智慧"],
  },
  {
    id: "LB008", isbn: "978-986-476-842-5", title: "資料庫系統理論與實務",
    author: "陳會安", publisher: "旗標", year: 2022, category: "database",
    callNumber: "312.74 7580", floor: "3F", location: "3F 東方語文書庫 資訊區",
    totalCopies: 6, availableCopies: 3, language: "zh", coverColor: "#0891B2",
    tags: ["資料庫", "SQL", "正規化", "ER Model"], description: "完整介紹關聯式資料庫理論與 SQL 實務",
    pageCount: 520, relatedCourses: ["資料庫系統"],
  },
  {
    id: "LB009", isbn: "978-0-13-468599-1", title: "Effective Java (3rd Ed.)",
    author: "Joshua Bloch", publisher: "Addison-Wesley", year: 2018, category: "programming",
    callNumber: "312.32J3 B651", floor: "7F", location: "7F 西方語文書庫 程式區",
    totalCopies: 3, availableCopies: 2, language: "en", coverColor: "#EA580C",
    tags: ["Java", "最佳實踐", "設計模式"], description: "Java 程式設計最佳實踐指南，78 條實用建議",
    pageCount: 416, relatedCourses: ["物件導向程式設計"],
  },
  {
    id: "LB010", isbn: "978-986-347-432-2", title: "深度學習 Deep Learning",
    author: "Ian Goodfellow, Yoshua Bengio, Aaron Courville", publisher: "碁峰", year: 2019, category: "ai_ml",
    callNumber: "312.83 G652", floor: "3F", location: "3F 東方語文書庫 AI 區",
    totalCopies: 4, availableCopies: 1, language: "zh", coverColor: "#7C3AED",
    tags: ["深度學習", "神經網路", "CNN", "RNN"], description: "深度學習經典教科書中譯本，涵蓋理論基礎與進階架構",
    pageCount: 780, relatedCourses: ["深度學習", "人工智慧"],
  },
  {
    id: "LB011", isbn: "978-986-502-788-8", title: "軟體工程導論",
    author: "Ian Sommerville 原著", publisher: "全華", year: 2020, category: "software_engineering",
    callNumber: "312.2 S696", floor: "3F", location: "3F 東方語文書庫 資訊區",
    totalCopies: 5, availableCopies: 2, language: "zh", coverColor: "#16A34A",
    tags: ["軟體工程", "敏捷", "需求分析", "測試"], description: "涵蓋軟體生命週期、敏捷開發、需求工程、軟體測試等",
    pageCount: 600, relatedCourses: ["軟體工程"],
  },
  {
    id: "LB012", isbn: "978-0-13-235088-4", title: "Clean Code",
    author: "Robert C. Martin", publisher: "Prentice Hall", year: 2008, category: "software_engineering",
    callNumber: "312.2 M379", floor: "7F", location: "7F 西方語文書庫 程式區",
    totalCopies: 2, availableCopies: 0, language: "en", coverColor: "#1E40AF",
    tags: ["程式品質", "重構", "最佳實踐"], description: "如何撰寫整潔、可維護的程式碼",
    pageCount: 431, relatedCourses: ["軟體工程", "程式設計(二)"],
  },
  {
    id: "LB013", isbn: "978-986-476-923-1", title: "線性代數",
    author: "黃子嘉", publisher: "鼎茂", year: 2020, category: "mathematics",
    callNumber: "314.7 4410", floor: "3F", location: "3F 東方語文書庫 數學區",
    totalCopies: 5, availableCopies: 3, language: "zh", coverColor: "#9333EA",
    tags: ["線性代數", "矩陣", "向量空間"], description: "涵蓋向量空間、線性變換、矩陣運算、特徵值等",
    pageCount: 480, relatedCourses: ["線性代數"],
  },
  {
    id: "LB014", isbn: "978-986-434-750-6", title: "網頁設計必學技術：HTML5、CSS3、JavaScript、jQuery",
    author: "陳惠貞", publisher: "碁峰", year: 2023, category: "web_development",
    callNumber: "312.16 7550", floor: "3F", location: "3F 東方語文書庫 資訊區",
    totalCopies: 7, availableCopies: 4, language: "zh", coverColor: "#F59E0B",
    tags: ["HTML5", "CSS3", "JavaScript", "網頁設計"], description: "從基礎到實戰的全方位網頁設計教學",
    pageCount: 560, relatedCourses: ["網頁程式設計", "前端開發"],
  },
  {
    id: "LB015", isbn: "978-986-502-901-1", title: "密碼學與網路安全",
    author: "William Stallings 原著", publisher: "全華", year: 2021, category: "security",
    callNumber: "312.76 S782", floor: "3F", location: "3F 東方語文書庫 資訊區",
    totalCopies: 3, availableCopies: 2, language: "zh", coverColor: "#DC2626",
    tags: ["密碼學", "網路安全", "加密"], description: "密碼學演算法與網路安全協定完整介紹",
    pageCount: 640, relatedCourses: ["資訊安全"],
  },
  // ── 通識 / 文學 / 語文 ──
  {
    id: "LB016", isbn: "978-957-33-3890-5", title: "台灣文學史綱",
    author: "葉石濤", publisher: "文學界", year: 2017, category: "literature",
    callNumber: "863.09 4417", floor: "5F", location: "5F 東方語文書庫 文學區",
    totalCopies: 3, availableCopies: 3, language: "zh", coverColor: "#78350F",
    tags: ["台灣文學", "文學史"], description: "台灣文學發展史的經典著作",
    pageCount: 320,
  },
  {
    id: "LB017", isbn: "978-0-06-112008-4", title: "To Kill a Mockingbird",
    author: "Harper Lee", publisher: "Harper Perennial", year: 2006, category: "literature",
    callNumber: "813.54 L478", floor: "8F", location: "8F 西方語文書庫 文學區",
    totalCopies: 4, availableCopies: 4, language: "en", coverColor: "#92400E",
    tags: ["美國文學", "經典小說"], description: "美國文學經典，探討種族歧視與道德勇氣",
    pageCount: 336,
  },
  {
    id: "LB018", isbn: "978-986-384-552-8", title: "TOEIC 多益新制黃金團隊 5 回全真模擬試題",
    author: "HACKERS", publisher: "國際學村", year: 2023, category: "language",
    callNumber: "805.189 H119", floor: "4F", location: "4F 東方語文書庫 語文區",
    totalCopies: 6, availableCopies: 1, language: "zh", coverColor: "#B45309",
    tags: ["多益", "TOEIC", "英語檢定"], description: "多益考試全真模擬題庫",
    pageCount: 456, relatedCourses: ["英語聽講訓練"],
  },
  {
    id: "LB019", isbn: "978-986-476-881-4", title: "React 學習手冊 (第二版)",
    author: "Alex Banks, Eve Porcello", publisher: "碁峰", year: 2022, category: "web_development",
    callNumber: "312.32J36 B218", floor: "3F", location: "3F 東方語文書庫 資訊區",
    totalCopies: 3, availableCopies: 1, language: "zh", coverColor: "#0EA5E9",
    tags: ["React", "JavaScript", "前端框架"], description: "完整學習 React 的最佳入門書",
    pageCount: 350, relatedCourses: ["網頁程式設計"],
  },
  {
    id: "LB020", isbn: "978-957-729-961-8", title: "微積分",
    author: "林清山", publisher: "五南", year: 2018, category: "mathematics",
    callNumber: "314.1 4431", floor: "3F", location: "3F 東方語文書庫 數學區",
    totalCopies: 8, availableCopies: 5, language: "zh", coverColor: "#4338CA",
    tags: ["微積分", "數學"], description: "大學微積分教科書，涵蓋極限、微分、積分、級數",
    pageCount: 650, relatedCourses: ["微積分"],
  },
];

// ═══════════════════════════════════════════════════
// 智慧推薦系統 — 根據時段 / 課程 / 考試推薦
// ═══════════════════════════════════════════════════

export interface SmartSuggestion {
  id: string;
  icon: string;
  label: string;
  description: string;
  action: "search" | "floor" | "seat" | "room" | "ebook";
  payload: string;
}

export function getSmartLibrarySuggestions(hour: number, _courses?: string[]): SmartSuggestion[] {
  const suggestions: SmartSuggestion[] = [];

  // Time-based
  if (hour >= 6 && hour < 10) {
    suggestions.push(
      { id: "morning-study", icon: "sunny-outline", label: "晨讀自習", description: "趁早上人少，找個安靜座位", action: "seat", payload: "silent" },
      { id: "morning-newspaper", icon: "newspaper-outline", label: "今日報紙", description: "B1 閱報區瀏覽今日新聞", action: "floor", payload: "B1" },
    );
  }
  if (hour >= 10 && hour < 12) {
    suggestions.push(
      { id: "mid-morning", icon: "book-outline", label: "找課本", description: "搜尋這學期課程教科書", action: "search", payload: "" },
      { id: "thesis", icon: "document-text-outline", label: "查論文", description: "3F 博碩士論文區查找參考文獻", action: "floor", payload: "3F" },
    );
  }
  if (hour >= 12 && hour < 14) {
    suggestions.push(
      { id: "lunch-coffee", icon: "cafe-outline", label: "咖啡區閱讀", description: "B1 咖啡區邊吃邊看書", action: "seat", payload: "B1-coffee" },
      { id: "lunch-ebook", icon: "tablet-portrait-outline", label: "滑電子書", description: "1F 電子書區瀏覽 HyRead", action: "ebook", payload: "" },
    );
  }
  if (hour >= 14 && hour < 18) {
    suggestions.push(
      { id: "afternoon-study", icon: "library-outline", label: "自習K書", description: "找安靜座位專心讀書", action: "seat", payload: "quiet" },
      { id: "afternoon-group", icon: "people-outline", label: "預約討論室", description: "和同學一起討論報告", action: "room", payload: "discussion" },
    );
  }
  if (hour >= 18 && hour < 21) {
    suggestions.push(
      { id: "evening-study", icon: "moon-outline", label: "夜間自習", description: "高樓層人少更安靜", action: "seat", payload: "6F-study" },
      { id: "evening-av", icon: "videocam-outline", label: "看影片學習", description: "2F 多媒體區觀看教學影片", action: "floor", payload: "2F" },
    );
  }

  // Course-based recommendations
  if (_courses) {
    const courseBookMap: Record<string, string[]> = {
      "資料結構": ["LB002", "LB001"],
      "演算法": ["LB001", "LB005"],
      "作業系統": ["LB003"],
      "計算機網路": ["LB004", "LB015"],
      "程式設計": ["LB006", "LB009"],
      "機器學習": ["LB007", "LB010"],
      "人工智慧": ["LB007", "LB010"],
      "資料庫": ["LB008"],
      "軟體工程": ["LB011", "LB012"],
      "線性代數": ["LB013"],
      "網頁程式設計": ["LB014", "LB019"],
      "微積分": ["LB020"],
    };

    for (const course of _courses) {
      for (const [key, bookIds] of Object.entries(courseBookMap)) {
        if (course.includes(key)) {
          const book = LIBRARY_BOOKS.find((b) => b.id === bookIds[0]);
          if (book && book.availableCopies > 0) {
            suggestions.push({
              id: `course-${key}`,
              icon: "school-outline",
              label: `${key}參考書`,
              description: `「${book.title}」可借（${book.location}）`,
              action: "search",
              payload: key,
            });
          }
          break;
        }
      }
    }
  }

  return suggestions.slice(0, 6);
}

// ═══════════════════════════════════════════════════
// 智慧搜尋 — 自然語言意圖辨識
// ═══════════════════════════════════════════════════

interface IntentMapping {
  keywords: string[];
  categories: BookCategory[];
  floorHint?: FloorId;
}

const SEARCH_INTENT_MAP: IntentMapping[] = [
  { keywords: ["演算法", "排序", "搜尋", "algorithm", "CLRS"], categories: ["computer_science"], floorHint: "3F" },
  { keywords: ["程式", "coding", "寫程式", "Python", "Java", "C++", "C語言"], categories: ["programming"], floorHint: "3F" },
  { keywords: ["AI", "人工智慧", "機器學習", "深度學習", "ML", "neural", "神經網路"], categories: ["ai_ml"], floorHint: "3F" },
  { keywords: ["網頁", "前端", "React", "HTML", "CSS", "JavaScript", "web"], categories: ["web_development"], floorHint: "3F" },
  { keywords: ["資料庫", "SQL", "database", "MySQL", "NoSQL"], categories: ["database"], floorHint: "3F" },
  { keywords: ["網路", "TCP", "IP", "network", "協定"], categories: ["networking"], floorHint: "3F" },
  { keywords: ["作業系統", "OS", "Linux", "kernel", "行程"], categories: ["operating_system"], floorHint: "3F" },
  { keywords: ["安全", "密碼", "加密", "security", "hack"], categories: ["security"], floorHint: "3F" },
  { keywords: ["軟體工程", "敏捷", "Scrum", "測試", "重構"], categories: ["software_engineering"], floorHint: "3F" },
  { keywords: ["數學", "微積分", "線代", "離散", "統計"], categories: ["mathematics"], floorHint: "3F" },
  { keywords: ["小說", "文學", "詩", "散文", "故事"], categories: ["literature"], floorHint: "5F" },
  { keywords: ["英文", "英語", "多益", "TOEIC", "IELTS", "英檢"], categories: ["language"], floorHint: "4F" },
];

export function smartSearchBooks(query: string): { books: LibraryBookEntry[]; floorHint?: FloorId; intentLabel?: string } {
  const q = query.toLowerCase();

  // Direct text match
  const directMatches = LIBRARY_BOOKS.filter(
    (b) =>
      b.title.toLowerCase().includes(q) ||
      b.author.toLowerCase().includes(q) ||
      b.isbn.includes(q) ||
      b.tags.some((t) => t.toLowerCase().includes(q)) ||
      b.callNumber.toLowerCase().includes(q),
  );

  if (directMatches.length > 0) {
    return { books: directMatches };
  }

  // Intent-based match
  for (const intent of SEARCH_INTENT_MAP) {
    if (intent.keywords.some((kw) => q.includes(kw.toLowerCase()))) {
      const books = LIBRARY_BOOKS.filter((b) => intent.categories.includes(b.category));
      return { books, floorHint: intent.floorHint, intentLabel: BOOK_CATEGORY_LABELS[intent.categories[0]] };
    }
  }

  // Fuzzy: match any tag
  const tagMatches = LIBRARY_BOOKS.filter((b) =>
    b.tags.some((t) => t.toLowerCase().includes(q) || q.includes(t.toLowerCase())),
  );

  return { books: tagMatches };
}

// ═══════════════════════════════════════════════════
// 學習統計模型（模擬即時數據）
// ═══════════════════════════════════════════════════

export interface FloorOccupancy {
  floor: FloorId;
  totalSeats: number;
  occupied: number;
  percentage: number;
  trend: "rising" | "stable" | "falling";
}

export function simulateFloorOccupancy(hour: number): FloorOccupancy[] {
  // Realistic patterns based on university library usage
  const patterns: Record<FloorId, number[]> = {
    // hour index: 8,9,10,11,12,13,14,15,16,17,18,19,20
    "B2": [0.1, 0.2, 0.4, 0.5, 0.3, 0.4, 0.6, 0.7, 0.8, 0.7, 0.6, 0.5, 0.4],
    "B1": [0.2, 0.3, 0.4, 0.5, 0.6, 0.5, 0.4, 0.3, 0.3, 0.3, 0.2, 0.2, 0.1],
    "1F": [0.3, 0.4, 0.5, 0.5, 0.6, 0.5, 0.5, 0.4, 0.4, 0.3, 0.3, 0.2, 0.1],
    "2F": [0.1, 0.2, 0.4, 0.5, 0.3, 0.5, 0.6, 0.6, 0.5, 0.4, 0.4, 0.3, 0.2],
    "3F": [0.2, 0.3, 0.5, 0.7, 0.4, 0.5, 0.8, 0.9, 0.8, 0.7, 0.6, 0.5, 0.3],
    "4F": [0.1, 0.2, 0.4, 0.5, 0.3, 0.4, 0.6, 0.7, 0.7, 0.6, 0.5, 0.4, 0.3],
    "5F": [0.05, 0.1, 0.2, 0.3, 0.2, 0.3, 0.4, 0.5, 0.5, 0.4, 0.3, 0.2, 0.1],
    "6F": [0.05, 0.1, 0.2, 0.3, 0.2, 0.3, 0.5, 0.6, 0.6, 0.5, 0.5, 0.4, 0.3],
    "7F": [0.1, 0.15, 0.2, 0.3, 0.2, 0.2, 0.3, 0.3, 0.3, 0.2, 0.2, 0.1, 0.05],
    "8F": [0.05, 0.1, 0.15, 0.2, 0.1, 0.15, 0.2, 0.25, 0.25, 0.2, 0.15, 0.1, 0.05],
    "9F": [0.02, 0.05, 0.1, 0.15, 0.1, 0.1, 0.15, 0.2, 0.2, 0.15, 0.1, 0.05, 0.02],
    "10F": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };

  const idx = Math.max(0, Math.min(12, hour - 8));
  const prevIdx = Math.max(0, idx - 1);

  return LIBRARY_FLOORS.filter((f) => f.seatCapacity > 0).map((floor) => {
    const pat = patterns[floor.id] || [];
    const pct = pat[idx] ?? 0;
    const prevPct = pat[prevIdx] ?? 0;
    const jitter = (Math.random() - 0.5) * 0.1;
    const finalPct = Math.max(0, Math.min(1, pct + jitter));
    const occupied = Math.round(finalPct * floor.seatCapacity);

    return {
      floor: floor.id,
      totalSeats: floor.seatCapacity,
      occupied,
      percentage: Math.round(finalPct * 100),
      trend: finalPct > prevPct + 0.05 ? "rising" : finalPct < prevPct - 0.05 ? "falling" : "stable",
    };
  });
}

// ═══════════════════════════════════════════════════
// 學習計時器預設
// ═══════════════════════════════════════════════════

export interface StudyTimerPreset {
  id: string;
  name: string;
  focusMinutes: number;
  breakMinutes: number;
  rounds: number;
  description: string;
  icon: string;
}

export const STUDY_TIMER_PRESETS: StudyTimerPreset[] = [
  { id: "pomodoro", name: "番茄鐘", focusMinutes: 25, breakMinutes: 5, rounds: 4, description: "經典 25/5 專注法", icon: "timer-outline" },
  { id: "deep-work", name: "深度工作", focusMinutes: 50, breakMinutes: 10, rounds: 3, description: "適合寫報告、讀原文書", icon: "flame-outline" },
  { id: "exam-prep", name: "考前衝刺", focusMinutes: 45, breakMinutes: 15, rounds: 4, description: "高強度複習模式", icon: "flash-outline" },
  { id: "light-read", name: "輕鬆閱讀", focusMinutes: 30, breakMinutes: 10, rounds: 2, description: "休閒閱讀、瀏覽期刊", icon: "leaf-outline" },
];

// ═══════════════════════════════════════════════════
// 閱讀成就系統
// ═══════════════════════════════════════════════════

export interface ReadingAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  requirement: string;
  category: "borrow" | "study" | "explore" | "social";
}

export const READING_ACHIEVEMENTS: ReadingAchievement[] = [
  { id: "first-borrow", name: "初次邂逅", description: "借出第一本書", icon: "book", color: "#3B82F6", requirement: "借閱 1 本書", category: "borrow" },
  { id: "bookworm", name: "小書蟲", description: "累計借閱 10 本書", icon: "bug", color: "#10B981", requirement: "借閱 10 本書", category: "borrow" },
  { id: "bibliophile", name: "藏書家", description: "累計借閱 50 本書", icon: "library", color: "#8B5CF6", requirement: "借閱 50 本書", category: "borrow" },
  { id: "all-nighter", name: "夜貓族", description: "在閉館前 30 分鐘還在圖書館", icon: "moon", color: "#6366F1", requirement: "閉館前 30 分鐘仍在館內", category: "study" },
  { id: "early-bird", name: "早起鳥", description: "開館 30 分鐘內入館", icon: "sunny", color: "#F59E0B", requirement: "開館 30 分鐘內到場", category: "study" },
  { id: "floor-explorer", name: "樓層探險家", description: "造訪過所有開放樓層", icon: "compass", color: "#EC4899", requirement: "到訪 B2~9F 所有樓層", category: "explore" },
  { id: "focus-master", name: "專注大師", description: "累計使用學習計時器 100 小時", icon: "timer", color: "#EF4444", requirement: "學習計時器滿 100 小時", category: "study" },
  { id: "reviewer", name: "書評達人", description: "撰寫 5 篇書評", icon: "create", color: "#14B8A6", requirement: "撰寫 5 篇書評", category: "social" },
  { id: "semester-goal", name: "目標達成", description: "完成一學期的閱讀目標", icon: "trophy", color: "#F97316", requirement: "達成學期閱讀目標", category: "study" },
  { id: "polyglot", name: "雙語達人", description: "同時借閱中英文書籍", icon: "globe", color: "#0EA5E9", requirement: "同時持有中文和英文書籍", category: "explore" },
];

// ═══════════════════════════════════════════════════
// 熱門搜尋 & 新書推薦
// ═══════════════════════════════════════════════════

export const POPULAR_SEARCHES = [
  "Python", "資料結構", "演算法", "機器學習", "微積分",
  "多益", "React", "深度學習", "Java", "資料庫",
  "線性代數", "作業系統", "C++", "離散數學", "網頁設計",
];

export const STAFF_PICKS: string[] = ["LB001", "LB007", "LB012", "LB019", "LB010"];

export function getBookById(id: string): LibraryBookEntry | undefined {
  return LIBRARY_BOOKS.find((b) => b.id === id);
}

export function getBooksByFloor(floor: FloorId): LibraryBookEntry[] {
  return LIBRARY_BOOKS.filter((b) => b.floor === floor);
}

export function getBooksByCategory(cat: BookCategory): LibraryBookEntry[] {
  return LIBRARY_BOOKS.filter((b) => b.category === cat);
}

export function getAvailableBooks(): LibraryBookEntry[] {
  return LIBRARY_BOOKS.filter((b) => b.availableCopies > 0);
}

// ═══════════════════════════════════════════════════
// 角色權限矩陣 — APP 各功能的角色可見性
// ═══════════════════════════════════════════════════

export type LibraryRole =
  | "undergraduate"
  | "master_student"
  | "doctoral_student"
  | "full_time_faculty"
  | "adjunct_faculty"
  | "staff"
  | "exchange_student"
  | "alumni"
  | "community_reader"
  | "librarian_circulation"   // 流通館員
  | "librarian_reference"     // 參考諮詢館員
  | "librarian_acquisition"   // 採編館員
  | "librarian_space"         // 空間管理館員
  | "system_admin";           // 系統管理員

export type LibFeature =
  | "borrow"           // 借還書
  | "reserve_book"     // 預約書
  | "renew"            // 續借
  | "interlibrary"     // 館際互借
  | "reserve_room"     // 預約討論室
  | "reserve_research" // 預約研究小間
  | "reserve_av"       // 預約視聽室
  | "reserve_seminar"  // 預約蓋夏廳
  | "book_review"      // 撰寫書評
  | "reading_goal"     // 閱讀目標
  | "reading_challenge" // 閱讀挑戰
  | "study_group"      // 讀書會
  | "course_reserve"   // 教師指定參考書
  | "purchase_request" // 推薦採購
  | "special_collection" // 特藏/古籍申請
  | "room_manage"      // 空間管理
  | "overdue_manage"   // 逾期管理
  | "catalog_manage"   // 編目管理
  | "announcement"     // 公告管理
  | "statistics"       // 統計儀表板
  | "floor_heatmap"    // 樓層熱力圖（查看）
  | "seat_manage"      // 座位管理
  | "ai_recommend"     // AI 推薦
  | "study_timer"      // 學習計時器
  | "achievements";    // 成就系統

export interface RoleFeatureAccess {
  role: LibraryRole;
  label: string;
  features: LibFeature[];
}

export const ROLE_LIBRARY_ACCESS: RoleFeatureAccess[] = [
  {
    role: "undergraduate", label: "大學部學生",
    features: ["borrow", "reserve_book", "renew", "interlibrary", "reserve_room", "reserve_av", "book_review", "reading_goal", "reading_challenge", "study_group", "floor_heatmap", "ai_recommend", "study_timer", "achievements"],
  },
  {
    role: "master_student", label: "碩士班研究生",
    features: ["borrow", "reserve_book", "renew", "interlibrary", "reserve_room", "reserve_research", "reserve_av", "book_review", "reading_goal", "reading_challenge", "study_group", "floor_heatmap", "ai_recommend", "study_timer", "achievements"],
  },
  {
    role: "doctoral_student", label: "博士班研究生",
    features: ["borrow", "reserve_book", "renew", "interlibrary", "reserve_room", "reserve_research", "reserve_av", "book_review", "reading_goal", "reading_challenge", "study_group", "special_collection", "purchase_request", "floor_heatmap", "ai_recommend", "study_timer", "achievements"],
  },
  {
    role: "full_time_faculty", label: "專任教師",
    features: ["borrow", "reserve_book", "renew", "interlibrary", "reserve_room", "reserve_research", "reserve_av", "reserve_seminar", "course_reserve", "purchase_request", "special_collection", "book_review", "floor_heatmap", "ai_recommend"],
  },
  {
    role: "adjunct_faculty", label: "兼任教師",
    features: ["borrow", "reserve_book", "renew", "interlibrary", "reserve_room", "reserve_av", "course_reserve", "purchase_request", "book_review", "floor_heatmap", "ai_recommend"],
  },
  {
    role: "staff", label: "職技員工",
    features: ["borrow", "reserve_book", "renew", "reserve_room", "reserve_av", "book_review", "floor_heatmap", "study_timer"],
  },
  {
    role: "exchange_student", label: "交換學生",
    features: ["borrow", "reserve_book", "renew", "reserve_room", "reserve_av", "book_review", "reading_goal", "floor_heatmap", "ai_recommend", "study_timer", "achievements"],
  },
  {
    role: "alumni", label: "校友",
    features: ["borrow", "book_review", "floor_heatmap"],
  },
  {
    role: "community_reader", label: "社區讀者",
    features: ["borrow", "floor_heatmap"],
  },
  {
    role: "librarian_circulation", label: "流通館員",
    features: ["borrow", "reserve_book", "overdue_manage", "floor_heatmap", "statistics", "announcement"],
  },
  {
    role: "librarian_reference", label: "參考諮詢館員",
    features: ["borrow", "reserve_book", "interlibrary", "special_collection", "purchase_request", "ai_recommend", "floor_heatmap", "statistics", "announcement"],
  },
  {
    role: "librarian_acquisition", label: "採編館員",
    features: ["catalog_manage", "purchase_request", "statistics"],
  },
  {
    role: "librarian_space", label: "空間管理館員",
    features: ["room_manage", "seat_manage", "floor_heatmap", "statistics"],
  },
  {
    role: "system_admin", label: "系統管理員",
    features: ["announcement", "statistics", "seat_manage", "room_manage", "overdue_manage", "catalog_manage"],
  },
];

export function hasLibFeature(role: LibraryRole, feature: LibFeature): boolean {
  return ROLE_LIBRARY_ACCESS.find(r => r.role === role)?.features.includes(feature) ?? false;
}

// ═══════════════════════════════════════════════════
// 角色間動作關聯 — 描述角色 A 對角色 B 的互動
// ═══════════════════════════════════════════════════

export interface RoleInteraction {
  from: LibraryRole;
  to: LibraryRole;
  actions: { id: string; label: string; icon: string; description: string }[];
}

export const ROLE_INTERACTIONS: RoleInteraction[] = [
  // 學生 → 流通館員
  {
    from: "undergraduate", to: "librarian_circulation",
    actions: [
      { id: "borrow", label: "借書/還書", icon: "book-outline", description: "臨櫃或自助借還書" },
      { id: "renew", label: "續借申請", icon: "refresh-outline", description: "到期前申請續借" },
      { id: "pay_fine", label: "繳納罰款", icon: "card-outline", description: "逾期罰款繳納" },
      { id: "lost_report", label: "遺失申報", icon: "alert-circle-outline", description: "書籍遺失處理" },
    ],
  },
  // 流通館員 → 學生
  {
    from: "librarian_circulation", to: "undergraduate",
    actions: [
      { id: "overdue_notice", label: "逾期通知", icon: "notifications-outline", description: "推播逾期提醒" },
      { id: "reserve_ready", label: "預約到書通知", icon: "mail-outline", description: "預約書已到館提醒" },
      { id: "fine_remind", label: "罰款提醒", icon: "warning-outline", description: "未繳罰款影響借閱" },
    ],
  },
  // 學生 → 參考館員
  {
    from: "undergraduate", to: "librarian_reference",
    actions: [
      { id: "ref_inquiry", label: "參考諮詢", icon: "help-circle-outline", description: "找不到資料/論文指導" },
      { id: "interlibrary_req", label: "館際互借", icon: "globe-outline", description: "申請跨校借書" },
      { id: "db_help", label: "資料庫使用", icon: "search-outline", description: "學術資料庫操作指導" },
    ],
  },
  // 參考館員 → 學生
  {
    from: "librarian_reference", to: "undergraduate",
    actions: [
      { id: "literacy_class", label: "資訊素養課程", icon: "school-outline", description: "教導資料搜尋技巧" },
      { id: "resource_guide", label: "資源推薦", icon: "bulb-outline", description: "依主題推薦書目/資料庫" },
      { id: "interlibrary_result", label: "館際互借結果", icon: "checkmark-done-outline", description: "通知書已到館" },
    ],
  },
  // 教師 → 參考館員
  {
    from: "full_time_faculty", to: "librarian_reference",
    actions: [
      { id: "course_reserve_req", label: "指定參考書", icon: "bookmark-outline", description: "設定課程指定參考書" },
      { id: "purchase_rec", label: "推薦採購", icon: "cart-outline", description: "推薦圖書館採購書籍" },
      { id: "special_access", label: "特藏申請", icon: "lock-open-outline", description: "申請閱覽古籍/特藏" },
    ],
  },
  // 參考館員 → 教師
  {
    from: "librarian_reference", to: "full_time_faculty",
    actions: [
      { id: "new_arrival", label: "新書到館通知", icon: "sparkles-outline", description: "教師研究領域新書通知" },
      { id: "subject_list", label: "主題書單", icon: "list-outline", description: "定期寄送專題書單" },
      { id: "reserve_confirm", label: "指定書確認", icon: "checkmark-circle-outline", description: "課程指定參考書已上架" },
    ],
  },
  // 教師 → 採編館員
  {
    from: "full_time_faculty", to: "librarian_acquisition",
    actions: [
      { id: "purchase_formal", label: "正式採購申請", icon: "document-text-outline", description: "填寫正式推薦採購單" },
    ],
  },
  // 採編館員 → 參考館員
  {
    from: "librarian_acquisition", to: "librarian_reference",
    actions: [
      { id: "catalog_done", label: "編目完成通知", icon: "pricetag-outline", description: "新書編目上架通知" },
    ],
  },
  // 學生 ↔ 學生
  {
    from: "undergraduate", to: "undergraduate",
    actions: [
      { id: "share_review", label: "書評互評", icon: "chatbubbles-outline", description: "互相評論書評" },
      { id: "recommend_book", label: "推薦書單", icon: "heart-outline", description: "向同學推薦好書" },
      { id: "study_group_invite", label: "讀書會組隊", icon: "people-outline", description: "邀請同學加入讀書會" },
      { id: "room_share", label: "討論室共用", icon: "home-outline", description: "多人協作預約討論室" },
      { id: "challenge_pk", label: "閱讀挑戰 PK", icon: "trophy-outline", description: "班級/系所閱讀 PK 賽" },
    ],
  },
  // 空間管理 → 所有人
  {
    from: "librarian_space", to: "undergraduate",
    actions: [
      { id: "room_approve", label: "討論室審核", icon: "checkmark-outline", description: "審核討論室預約" },
      { id: "seat_adjust", label: "座位調整通知", icon: "resize-outline", description: "座位區域調整/關閉通知" },
    ],
  },
  // 系統管理 → 全角色
  {
    from: "system_admin", to: "undergraduate",
    actions: [
      { id: "sys_announce", label: "系統公告", icon: "megaphone-outline", description: "發布全校性圖書館公告" },
      { id: "maintenance", label: "維護通知", icon: "construct-outline", description: "系統維護/休館通知" },
    ],
  },
];

// ═══════════════════════════════════════════════════
// 館際互借系統
// ═══════════════════════════════════════════════════

export type ILLStatus = "draft" | "submitted" | "processing" | "shipped" | "arrived" | "borrowed" | "returned" | "cancelled";

export interface InterlibraryLoan {
  id: string;
  userId: string;
  bookTitle: string;
  bookAuthor: string;
  isbn?: string;
  sourceLibrary: string;       // 提供館
  status: ILLStatus;
  requestedAt: string;
  estimatedArrival?: string;
  arrivedAt?: string;
  dueDate?: string;
  returnedAt?: string;
  fee: number;                 // 通常 50–100 元
  trackingNote?: string;
}

export function getILLStatusLabel(status: ILLStatus): string {
  const m: Record<ILLStatus, string> = {
    draft: "草稿", submitted: "已送出", processing: "處理中",
    shipped: "寄送中", arrived: "已到館", borrowed: "借閱中",
    returned: "已歸還", cancelled: "已取消",
  };
  return m[status] ?? status;
}

export function getILLStatusColor(status: ILLStatus): string {
  const m: Record<ILLStatus, string> = {
    draft: "#9CA3AF", submitted: "#3B82F6", processing: "#F59E0B",
    shipped: "#6366F1", arrived: "#10B981", borrowed: "#0D9488",
    returned: "#9CA3AF", cancelled: "#EF4444",
  };
  return m[status] ?? "#9CA3AF";
}

export const ILL_PARTNER_LIBRARIES = [
  { id: "ntu", name: "國立臺灣大學", city: "台北", deliveryDays: 3 },
  { id: "nchu", name: "國立中興大學", city: "台中", deliveryDays: 1 },
  { id: "nthu", name: "國立清華大學", city: "新竹", deliveryDays: 2 },
  { id: "ncku", name: "國立成功大學", city: "台南", deliveryDays: 2 },
  { id: "fcu", name: "逢甲大學", city: "台中", deliveryDays: 1 },
  { id: "thu", name: "東海大學", city: "台中", deliveryDays: 1 },
  { id: "cmu", name: "中國醫藥大學", city: "台中", deliveryDays: 1 },
  { id: "ncl", name: "國家圖書館", city: "台北", deliveryDays: 3 },
];

// ═══════════════════════════════════════════════════
// 教師指定參考書系統 (Course Reserve)
// ═══════════════════════════════════════════════════

export interface CourseReserve {
  id: string;
  courseId: string;
  courseName: string;
  instructor: string;
  semester: string;            // e.g. "114-2"
  bookIds: string[];           // 對應 LIBRARY_BOOKS.id
  borrowHours: number;         // 限時借閱（通常 2–4 小時館內閱覽）
  isInLibraryOnly: boolean;    // 限館內閱覽
  createdAt: string;
}

export const COURSE_RESERVES: CourseReserve[] = [
  {
    id: "cr-001", courseId: "CS201", courseName: "資料結構", instructor: "王教授",
    semester: "114-2", bookIds: ["LB001", "LB002"], borrowHours: 4, isInLibraryOnly: false,
    createdAt: "2026-02-15",
  },
  {
    id: "cr-002", courseId: "CS301", courseName: "演算法", instructor: "陳教授",
    semester: "114-2", bookIds: ["LB001", "LB005"], borrowHours: 4, isInLibraryOnly: false,
    createdAt: "2026-02-18",
  },
  {
    id: "cr-003", courseId: "CS401", courseName: "機器學習", instructor: "林教授",
    semester: "114-2", bookIds: ["LB007", "LB010", "LB013"], borrowHours: 2, isInLibraryOnly: true,
    createdAt: "2026-02-20",
  },
  {
    id: "cr-004", courseId: "CS102", courseName: "程式設計(一)", instructor: "張教授",
    semester: "114-2", bookIds: ["LB006"], borrowHours: 4, isInLibraryOnly: false,
    createdAt: "2026-02-14",
  },
  {
    id: "cr-005", courseId: "CS302", courseName: "資料庫系統", instructor: "黃教授",
    semester: "114-2", bookIds: ["LB008"], borrowHours: 4, isInLibraryOnly: false,
    createdAt: "2026-02-17",
  },
];

export function getCourseReserveBooks(courseName: string): LibraryBookEntry[] {
  const reserves = COURSE_RESERVES.filter(cr => cr.courseName.includes(courseName));
  const bookIds = reserves.flatMap(cr => cr.bookIds);
  return LIBRARY_BOOKS.filter(b => bookIds.includes(b.id));
}

// ═══════════════════════════════════════════════════
// 書評 / 社交閱讀系統
// ═══════════════════════════════════════════════════

export interface BookReview {
  id: string;
  bookId: string;
  userId: string;
  userName: string;
  userRole: BorrowerRole;
  rating: number;             // 1–5
  title: string;
  content: string;
  tags: string[];
  likes: number;
  isStaffPick: boolean;       // 館員精選
  createdAt: string;
}

export interface StudyGroup {
  id: string;
  name: string;
  topic: string;
  bookIds: string[];
  creatorId: string;
  members: { userId: string; name: string }[];
  maxMembers: number;
  meetingSchedule: string;    // e.g. "每週三 14:00"
  roomId?: string;            // 預約的討論室
  status: "recruiting" | "active" | "completed";
  createdAt: string;
}

export interface ReadingGoal {
  id: string;
  userId: string;
  semester: string;
  targetBooks: number;
  completedBooks: number;
  targetHours: number;       // 學習計時器時數
  completedHours: number;
  badges: string[];          // 已獲得的成就 ID
  streak: number;            // 連續借閱天數
}

export interface ReadingChallenge {
  id: string;
  title: string;
  description: string;
  type: "individual" | "class" | "department";
  startDate: string;
  endDate: string;
  targetBooks: number;
  participants: number;
  leaderboard: { rank: number; name: string; books: number }[];
}

// 模擬書評資料
export function simulateBookReviews(bookId: string): BookReview[] {
  const reviews: BookReview[] = [
    {
      id: "rev-001", bookId: "LB001", userId: "u-101", userName: "資工系同學A",
      userRole: "undergraduate", rating: 5, title: "演算法必讀聖經",
      content: "CLRS 真的是學演算法必備的一本書，雖然很厚但講解非常完整。搭配上課一起讀效果最好。",
      tags: ["演算法", "必讀"], likes: 42, isStaffPick: true,
      createdAt: "2026-03-15",
    },
    {
      id: "rev-002", bookId: "LB001", userId: "u-102", userName: "資工系同學B",
      userRole: "master_student", rating: 4, title: "研究所考試好幫手",
      content: "準備研究所考試時這本幫了大忙，動態規劃和圖論的章節特別推薦。",
      tags: ["考試", "研究所"], likes: 28, isStaffPick: false,
      createdAt: "2026-03-20",
    },
    {
      id: "rev-003", bookId: "LB006", userId: "u-103", userName: "大一新生C",
      userRole: "undergraduate", rating: 5, title: "Python 入門首選",
      content: "完全沒接觸過程式設計也能看懂，例子很實用。推薦大一新生借閱！",
      tags: ["Python", "入門", "推薦"], likes: 35, isStaffPick: true,
      createdAt: "2026-04-01",
    },
  ];
  return reviews.filter(r => bookId === "all" || r.bookId === bookId);
}

// 模擬讀書會
export function simulateStudyGroups(): StudyGroup[] {
  return [
    {
      id: "sg-001", name: "演算法讀書會", topic: "CLRS 精讀", bookIds: ["LB001"],
      creatorId: "u-101", members: [{ userId: "u-101", name: "同學A" }, { userId: "u-102", name: "同學B" }, { userId: "u-104", name: "同學D" }],
      maxMembers: 6, meetingSchedule: "每週三 14:00–16:00", roomId: "3F-D2",
      status: "active", createdAt: "2026-03-01",
    },
    {
      id: "sg-002", name: "ML 論文研讀", topic: "機器學習經典論文", bookIds: ["LB007", "LB010"],
      creatorId: "u-105", members: [{ userId: "u-105", name: "研究生E" }, { userId: "u-106", name: "研究生F" }],
      maxMembers: 4, meetingSchedule: "每週五 10:00–12:00", roomId: "6F-D1",
      status: "recruiting", createdAt: "2026-03-10",
    },
    {
      id: "sg-003", name: "英文小說讀書會", topic: "經典英美文學共讀", bookIds: ["LB017"],
      creatorId: "u-107", members: [{ userId: "u-107", name: "外文系同學G" }, { userId: "u-108", name: "同學H" }, { userId: "u-109", name: "同學I" }, { userId: "u-110", name: "同學J" }],
      maxMembers: 8, meetingSchedule: "隔週二 15:00–17:00",
      status: "active", createdAt: "2026-02-25",
    },
  ];
}

// 模擬閱讀挑戰
export function simulateReadingChallenge(): ReadingChallenge {
  return {
    id: "rc-2026-spring", title: "114-2 春季閱讀馬拉松",
    description: "本學期全校閱讀挑戰！個人借閱 20 本即可獲得特殊成就徽章",
    type: "department", startDate: "2026-02-17", endDate: "2026-06-20",
    targetBooks: 20, participants: 342,
    leaderboard: [
      { rank: 1, name: "外文系", books: 1247 },
      { rank: 2, name: "中文系", books: 1105 },
      { rank: 3, name: "資工系", books: 892 },
      { rank: 4, name: "法律系", books: 756 },
      { rank: 5, name: "財金系", books: 678 },
    ],
  };
}

// 模擬個人閱讀目標
export function simulateReadingGoal(): ReadingGoal {
  return {
    id: "goal-001", userId: "current-user", semester: "114-2",
    targetBooks: 20, completedBooks: 8,
    targetHours: 100, completedHours: 43,
    badges: ["first-borrow", "bookworm", "early-bird"],
    streak: 12,
  };
}

// ═══════════════════════════════════════════════════
// 罰款 / 費用追蹤
// ═══════════════════════════════════════════════════

export interface LibraryFine {
  id: string;
  userId: string;
  bookId: string;
  bookTitle: string;
  type: "overdue" | "lost" | "damage";
  amount: number;
  daysOverdue?: number;
  status: "unpaid" | "paid" | "waived";
  createdAt: string;
  paidAt?: string;
}

export function calculateOverdueFine(role: BorrowerRole, daysOverdue: number): number {
  const privilege = getBorrowPrivilege(role);
  return daysOverdue * privilege.overdueFinePerDay;
}

export const FINE_POLICY = {
  overduePerDay: 5,           // $5/天/冊
  maxOverdueFine: 500,        // 單冊最高 $500
  lostBookMultiplier: 2,      // 遺失賠償 = 書價 × 2
  damageMinFee: 100,          // 毀損最低 $100
  gracePeriodDays: 0,         // 無寬限期
  suspensionDays: 30,         // 未繳罰款 30 天暫停借閱
  paymentMethods: ["現金（出納組）", "校園 e-Pay", "ATM 轉帳"],
};

// ═══════════════════════════════════════════════════
// 推播通知類型
// ═══════════════════════════════════════════════════

export type NotificationType =
  | "overdue_warning"      // 即將到期（前 3 天）
  | "overdue_alert"        // 已逾期
  | "reserve_ready"        // 預約書到館
  | "ill_arrived"          // 館際互借到館
  | "room_reminder"        // 討論室預約提醒（前 30 分鐘）
  | "study_group_invite"   // 讀書會邀請
  | "challenge_update"     // 閱讀挑戰進度
  | "achievement_unlock"   // 成就解鎖
  | "new_arrival"          // 關注領域新書
  | "course_reserve_new"   // 課程指定參考書更新
  | "fine_reminder"        // 罰款提醒
  | "system_announcement"  // 系統公告
  | "library_closing"      // 閉館提醒
  | "ai_recommendation";   // AI 個人化推薦

export interface NotificationConfig {
  type: NotificationType;
  label: string;
  icon: string;
  color: string;
  defaultEnabled: boolean;
  description: string;
}

export const NOTIFICATION_TYPES: NotificationConfig[] = [
  { type: "overdue_warning", label: "到期提醒", icon: "time-outline", color: "#F59E0B", defaultEnabled: true, description: "借閱書籍到期前 3 天提醒" },
  { type: "overdue_alert", label: "逾期警告", icon: "alert-circle-outline", color: "#EF4444", defaultEnabled: true, description: "書籍已逾期未還通知" },
  { type: "reserve_ready", label: "預約到書", icon: "book-outline", color: "#10B981", defaultEnabled: true, description: "預約書已到館可取" },
  { type: "ill_arrived", label: "館際互借到館", icon: "globe-outline", color: "#6366F1", defaultEnabled: true, description: "跨校借書已送達" },
  { type: "room_reminder", label: "討論室提醒", icon: "home-outline", color: "#3B82F6", defaultEnabled: true, description: "預約討論室使用前 30 分鐘提醒" },
  { type: "study_group_invite", label: "讀書會邀請", icon: "people-outline", color: "#8B5CF6", defaultEnabled: true, description: "收到讀書會加入邀請" },
  { type: "challenge_update", label: "挑戰進度", icon: "trophy-outline", color: "#EC4899", defaultEnabled: false, description: "閱讀挑戰排名變動通知" },
  { type: "achievement_unlock", label: "成就解鎖", icon: "ribbon-outline", color: "#F97316", defaultEnabled: true, description: "獲得新閱讀成就徽章" },
  { type: "new_arrival", label: "新書通知", icon: "sparkles-outline", color: "#0D9488", defaultEnabled: false, description: "關注類別的新書到館" },
  { type: "course_reserve_new", label: "指定參考書", icon: "school-outline", color: "#DC2626", defaultEnabled: true, description: "修課教師新增指定參考書" },
  { type: "fine_reminder", label: "罰款提醒", icon: "card-outline", color: "#EF4444", defaultEnabled: true, description: "有未繳罰款提醒" },
  { type: "system_announcement", label: "系統公告", icon: "megaphone-outline", color: "#1E40AF", defaultEnabled: true, description: "圖書館系統公告" },
  { type: "library_closing", label: "閉館提醒", icon: "moon-outline", color: "#6366F1", defaultEnabled: false, description: "閉館前 30 分鐘提醒" },
  { type: "ai_recommendation", label: "AI 推薦", icon: "bulb-outline", color: "#F59E0B", defaultEnabled: false, description: "根據借閱紀錄的個人化推薦" },
];

// ═══════════════════════════════════════════════════
// AI 推薦引擎 — 模擬個人化推薦
// ═══════════════════════════════════════════════════

export interface AIRecommendation {
  bookId: string;
  reason: string;
  confidence: number;         // 0–1
  source: "borrow_history" | "course" | "review" | "trending" | "similar_readers";
}

export function simulateAIRecommendations(currentCourses?: string[]): AIRecommendation[] {
  const recs: AIRecommendation[] = [
    { bookId: "LB007", reason: "修習「機器學習」的同學 87% 也借閱此書", confidence: 0.92, source: "course" },
    { bookId: "LB012", reason: "根據您的借閱紀錄推薦：程式品質進階", confidence: 0.85, source: "borrow_history" },
    { bookId: "LB019", reason: "本月最熱門：React 學習手冊", confidence: 0.78, source: "trending" },
    { bookId: "LB001", reason: "與您相似的讀者也借閱了 CLRS", confidence: 0.81, source: "similar_readers" },
    { bookId: "LB015", reason: "資工系同學書評平均 4.8 分", confidence: 0.75, source: "review" },
  ];

  if (currentCourses) {
    const courseRecs = currentCourses.flatMap(course => {
      const books = getCourseReserveBooks(course);
      return books.map(b => ({
        bookId: b.id,
        reason: `修習「${course}」指定參考書`,
        confidence: 0.95,
        source: "course" as const,
      }));
    });
    return [...courseRecs, ...recs].slice(0, 8);
  }

  return recs;
}

// ═══════════════════════════════════════════════════
// 推薦採購系統
// ═══════════════════════════════════════════════════

export type PurchaseRequestStatus = "submitted" | "reviewing" | "approved" | "ordered" | "arrived" | "rejected";

export interface PurchaseRequest {
  id: string;
  requesterId: string;
  requesterRole: LibraryRole;
  bookTitle: string;
  bookAuthor: string;
  isbn?: string;
  publisher?: string;
  reason: string;
  status: PurchaseRequestStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export function getPurchaseStatusLabel(status: PurchaseRequestStatus): string {
  const m: Record<PurchaseRequestStatus, string> = {
    submitted: "已提交", reviewing: "審核中", approved: "已核准",
    ordered: "已訂購", arrived: "已到館", rejected: "未通過",
  };
  return m[status] ?? status;
}

export function getPurchaseStatusColor(status: PurchaseRequestStatus): string {
  const m: Record<PurchaseRequestStatus, string> = {
    submitted: "#3B82F6", reviewing: "#F59E0B", approved: "#10B981",
    ordered: "#6366F1", arrived: "#059669", rejected: "#EF4444",
  };
  return m[status] ?? "#9CA3AF";
}
