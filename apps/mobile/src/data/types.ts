// ===== 基礎公告與活動 =====

export type Announcement = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  source?: string;
  category?: AnnouncementCategory;
  attachments?: Attachment[];
  pinned?: boolean;
  expiresAt?: string;
  schoolId?: string;
};

export type AnnouncementCategory = 'general' | 'academic' | 'event' | 'emergency' | 'system';

export type ClubEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  capacity?: number;
  registeredCount?: number;
  category?: EventCategory;
  organizer?: string;
  imageUrl?: string;
  registrationDeadline?: string;
  fee?: number;
  tags?: string[];
  schoolId?: string;
};

export type EventCategory =
  | 'academic'
  | 'sports'
  | 'arts'
  | 'social'
  | 'career'
  | 'workshop'
  | 'competition';

// ===== 地點與餐廳 =====

export type Poi = {
  id: string;
  name: string;
  description?: string;
  category: PoiCategory;
  lat: number;
  lng: number;
  floor?: number;
  building?: string;
  openingHours?: OpeningHours;
  imageUrl?: string;
  facilities?: string[];
  accessible?: boolean;
  crowdLevel?: 'low' | 'medium' | 'high';
  schoolId?: string;
};

export type PoiCategory =
  | 'building'
  | 'food'
  | 'library'
  | 'cafeteria'
  | 'parking'
  | 'sports'
  | 'lab'
  | 'office'
  | 'dormitory'
  | 'medical'
  | 'convenience'
  | 'other';

export type CrowdLevel = 'low' | 'medium' | 'high' | 'very_high';

export type PoiReview = {
  id: string;
  uid: string;
  schoolId?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  rating: number;
  comment: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  helpful: number;
  helpfulBy?: string[];
};

export type PoiCrowdReport = {
  id: string;
  uid: string;
  schoolId?: string;
  level: CrowdLevel;
  createdAt?: string;
};

export type PoiReportType = 'closed' | 'wrong_info' | 'accessibility' | 'safety' | 'other';

export type PoiReport = {
  id: string;
  uid: string;
  schoolId?: string;
  email?: string | null;
  type: PoiReportType;
  description: string;
  createdAt?: string;
  status: 'pending' | 'resolved' | 'rejected';
};

export type OpeningHours = {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
};

export type DayHours = {
  open: string;
  close: string;
  closed?: boolean;
};

export type CafeteriaPilotStatus = 'inactive' | 'pilot' | 'live';

export type CafeteriaOperatorRole = 'owner' | 'manager' | 'staff';

export type MerchantAssignmentStatus = 'active' | 'inactive';

export type Cafeteria = {
  id: string;
  schoolId?: string;
  name: string;
  description?: string;
  merchantId?: string;
  brandKey?: string;
  location?: string;
  openingHours?: string;
  seatingCapacity?: number;
  currentOccupancy?: number;
  pilotStatus?: CafeteriaPilotStatus;
  orderingEnabled?: boolean;
  activeOperatorCount?: number;
  rating?: number | string;
  reviewCount?: number;
  sourceLabel?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type MerchantAssignment = {
  schoolId: string;
  schoolName?: string | null;
  cafeteriaId: string;
  cafeteriaName: string;
  merchantId: string;
  brandKey?: string | null;
  operatorRole: CafeteriaOperatorRole;
  status: MerchantAssignmentStatus;
  orderingEnabled: boolean;
  pilotStatus: CafeteriaPilotStatus;
  displayName?: string | null;
  email?: string | null;
  lastActiveAt?: string | null;
};

export type MenuItem = {
  id: string;
  name: string;
  cafeteria: string;
  cafeteriaId?: string;
  availableOn: string;
  price?: number;
  category?: MenuCategory;
  description?: string;
  imageUrl?: string;
  image?: string;
  calories?: number;
  allergens?: string[];
  vegetarian?: boolean;
  vegan?: boolean;
  rating?: number;
  ratingCount?: number;
  soldOut?: boolean;
  customizable?: boolean;
  popular?: boolean;
  waitTime?: number;
  sourceLabel?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  schoolId?: string;
  orderingEnabled?: boolean;
  pilotStatus?: CafeteriaPilotStatus;
};

export type MenuCategory = 'main' | 'side' | 'soup' | 'dessert' | 'beverage' | 'set';

// ===== 使用者與認證 =====

export type User = {
  id: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
  avatarUrl?: string | null;
  studentId?: string;
  department?: string;
  year?: number;
  role: UserRole;
  schoolId: string;
  createdAt: string;
  updatedAt?: string;
  settings?: UserSettings;
  pushToken?: string;
  lastActiveAt?: string;
  phone?: string | null;
  bio?: string | null;
  joinedAt?: string;
  balance?: number;
  isPublicProfile?: boolean;
};

export type UserRole =
  | 'student'
  | 'teacher'
  | 'professor'
  | 'principal'
  | 'admin'
  | 'staff'
  | 'alumni';

export type RoleMode = 'guest' | 'student' | 'teacher' | 'admin';

export type UserSettings = {
  language?: string;
  theme?: 'light' | 'dark' | 'system';
  notifications?: NotificationPreferences | boolean;
  emailNotifications?: boolean;
  accessibility?: AccessibilitySettings;
};

export type NotificationPreferences = {
  announcements?: boolean;
  events?: boolean;
  grades?: boolean;
  assignments?: boolean;
  messages?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
};

export type AccessibilitySettings = {
  fontSize?: 'small' | 'medium' | 'large' | 'xlarge';
  highContrast?: boolean;
  reduceMotion?: boolean;
  screenReader?: boolean;
};

// ===== 課程與學業 =====

export type Course = {
  id: string;
  code: string;
  name: string;
  instructor: string;
  teacher?: string;
  credits: number;
  semester: string;
  category?: string;
  department?: string;
  description?: string;
  schedule: CourseSchedule[];
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  startPeriod?: number;
  endPeriod?: number;
  location?: string;
  color?: string;
  capacity?: number;
  enrolled?: number;
  prerequisites?: string[];
  syllabus?: string;
  schoolId?: string;
};

export type CourseSchedule = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
  day?: number;
  startPeriod?: number;
  endPeriod?: number;
};

export type Enrollment = {
  id: string;
  userId: string;
  courseId: string;
  semester: string;
  schoolId?: string;
  status: 'enrolled' | 'dropped' | 'completed' | 'waitlisted';
  grade?: string;
  gradePoints?: number;
  createdAt: string;
  enrolledAt?: string;
};

export type Grade = {
  id: string;
  userId: string;
  courseId: string;
  courseName: string;
  courseCode?: string;
  credits: number;
  semester: string;
  schoolId?: string;
  letterGrade?: string;
  gradePoints?: number;
  grade?: number;
  gradePoint?: number;
  score?: number;
  midtermScore?: number;
  finalScore?: number;
  rank?: number;
  classSize?: number;
  publishedAt?: string;
  instructor?: string;
  /** 修別：必修/選修/通識/體育… (from E校園 成績頁) */
  courseType?: string;
  /** 修課班級 */
  courseClass?: string;
  /** 英文課程名 */
  courseNameEn?: string;
};

export type Assignment = {
  id: string;
  groupId: string;
  courseId?: string;
  title: string;
  description: string;
  dueAt: string;
  points?: number;
  type: AssignmentType;
  attachments?: Attachment[];
  submissionCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
};

export type AssignmentType = 'homework' | 'quiz' | 'exam' | 'project' | 'presentation' | 'report';

export type Submission = {
  id: string;
  assignmentId: string;
  userId: string;
  uid?: string;
  groupId?: string;
  content?: string;
  attachments?: Attachment[];
  submittedAt: string;
  grade?: number;
  feedback?: string;
  gradedAt?: string;
  gradedBy?: string;
  status: 'submitted' | 'graded' | 'late' | 'missing';
};

export type CourseSpace = {
  id: string;
  groupId: string;
  courseId?: string;
  name: string;
  description?: string;
  role?: string;
  unreadCount: number;
  assignmentCount: number;
  dueSoonCount: number;
  quizCount: number;
  moduleCount: number;
  activeSessionId: string | null;
  latestDueAt: Date | null;
  memberCount?: number;
  activeLearnerCount?: number;
  completedAssignmentCount?: number;
  completionRate?: number;
  socialProofUpdatedAt?: Date | null;
  schoolId?: string;
};

export type AmbientCueSurface =
  | 'today'
  | 'inbox'
  | 'courseHub'
  | 'teachingHub'
  | 'achievements'
  | 'campus'
  | 'department'
  | 'admin'
  | 'staff';

export type AmbientCueRole = 'guest' | 'student' | 'teacher' | 'staff' | 'department' | 'admin';

export type AmbientCueSignalType =
  | 'course_completion'
  | 'attendance_momentum'
  | 'teaching_review'
  | 'leaderboard_momentum'
  | 'campus_popularity'
  | 'approval_backlog'
  | 'admin_activity';

export type AmbientCueTarget = {
  tab?: string;
  screen?: string;
  params?: Record<string, unknown>;
};

export type AmbientCue = {
  id: string;
  surface: AmbientCueSurface;
  role: AmbientCueRole;
  signalType: AmbientCueSignalType;
  headline: string;
  body: string;
  ctaLabel: string;
  target?: AmbientCueTarget;
  metric?: string;
  distinctUserCount: number;
  updatedAt: Date | null;
  dismissKey: string;
};

export type CourseMaterial = {
  id: string;
  moduleId: string;
  groupId: string;
  type: 'link' | 'file' | 'video' | 'document' | 'external';
  label: string;
  description?: string;
  url?: string | null;
  createdAt?: Date | null;
};

export type CourseModule = {
  id: string;
  groupId: string;
  groupName: string;
  title?: string;
  description?: string;
  week?: number;
  order?: number;
  estimatedMinutes?: number;
  resourceCount?: number;
  published?: boolean;
  resourceUrl?: string | null;
  resourceLabel?: string | null;
  materials?: CourseMaterial[];
};

export type Question = {
  id: string;
  prompt: string;
  type: 'single_choice' | 'multiple_choice' | 'short_answer' | 'essay' | 'true_false';
  required?: boolean;
  options?: Array<{
    id: string;
    label: string;
    value: string;
  }>;
  explanation?: string;
  points?: number;
};

export type QuestionBank = {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  questionCount: number;
  updatedAt?: Date | null;
};

export type Quiz = {
  id: string;
  assignmentId: string;
  groupId: string;
  groupName: string;
  title: string;
  description?: string;
  dueAt?: Date | null;
  type: 'quiz' | 'exam';
  gradesPublished?: boolean;
  questionCount?: number;
  durationMinutes?: number;
  points?: number;
  weight?: number;
  source: 'quiz' | 'assignment';
  questionBankId?: string | null;
  questions?: Question[];
};

export type AttendanceSession = {
  id: string;
  groupId: string;
  groupName: string;
  active: boolean;
  attendeeCount?: number;
  startedAt: Date | null;
  endedAt: Date | null;
  source: 'attendance' | 'live';
  attendanceMode?: string | null;
};

export type AttendanceRecord = {
  id: string;
  sessionId: string;
  groupId: string;
  userId: string;
  status: 'present' | 'late' | 'absent' | 'excused';
  source?: 'qr' | 'tap' | 'manual';
  checkedInAt?: Date | null;
};

export type AttendanceSummary = {
  groupId: string;
  totalSessions: number;
  activeSessions: number;
  totalAttendees: number;
  latestSession: AttendanceSession | null;
};

export type InboxTask = {
  id: string;
  kind: 'live' | 'assignment' | 'quiz' | 'group';
  groupId: string;
  groupName: string;
  title: string;
  subtitle: string;
  sessionId?: string;
  assignmentId?: string;
  priority: number;
  dueAt?: Date | null;
  unreadCount?: number;
  preferredIntent?: InboxIntent;
  actionLabel?: string;
  reason?: string;
  consequence?: string;
  nextStep?: string;
};

export type InboxIntent = 'submit' | 'join' | 'review' | 'read' | 'reply' | 'navigate' | 'verify';

export type InboxUrgency = 'critical' | 'high' | 'medium' | 'low';

export type FreshnessState = 'live' | 'new' | 'today' | 'stale';

export type InboxItem = InboxTask & {
  intent: InboxIntent;
  urgency: InboxUrgency;
  freshness: FreshnessState;
  actionLabel: string;
  actionTarget?: {
    tab?: string;
    screen?: string;
    params?: Record<string, unknown>;
  };
  reason?: string;
  consequence?: string;
  nextStep?: string;
};

export type TodayCardPriority = 'critical' | 'high' | 'medium' | 'low' | 'complete';

export type TodayCardContext = 'next_action' | 'course' | 'deadline' | 'campus' | 'support';

export type TodayCard = {
  id: string;
  title: string;
  description: string;
  priority: TodayCardPriority;
  context: TodayCardContext;
  confidence: FreshnessState;
  badge?: string;
  meta?: string;
  actionLabel?: string;
  actionTarget?: {
    tab?: string;
    screen?: string;
    params?: Record<string, unknown>;
  };
};

export type CampusServiceCategory = 'mobility' | 'daily_life' | 'operations' | 'support';

export type CampusService = {
  id: string;
  title: string;
  description: string;
  category: CampusServiceCategory;
  icon: string;
  tint: string;
  contextTags: string[];
  badge?: string;
  actionLabel: string;
  actionTarget?: {
    tab?: string;
    screen?: string;
    params?: Record<string, unknown>;
  };
};

export type CourseGradebookAssignment = {
  id: string;
  title: string;
  weight: number;
  dueAt: Date | null;
  gradesPublished: boolean;
  averageScore: number | null;
};

export type CourseGradebookEntry = {
  assignmentId: string;
  title: string;
  weight: number;
  dueAt: Date | null;
  grade: number | null;
  isLate: boolean;
  feedback?: string | null;
  submittedAt: Date | null;
};

export type CourseGradebookRow = {
  uid: string;
  displayName: string;
  email?: string | null;
  studentId?: string | null;
  department?: string | null;
  finalScore: number | null;
  passingScore: number;
  result: string;
  published: boolean;
  publishedAt: Date | null;
  gradedAssignments: number;
  totalAssignments: number;
  assignmentBreakdown: CourseGradebookEntry[];
};

export type CourseGradebookData = {
  groupName: string;
  finalScoresPublished: boolean;
  finalScoresPublishedAt: Date | null;
  assignments: CourseGradebookAssignment[];
  rows: CourseGradebookRow[];
};

// ===== 群組與社群 =====

export type Group = {
  id: string;
  name: string;
  description?: string;
  type: GroupType;
  courseId?: string;
  coverImage?: string;
  memberCount: number;
  createdBy?: string;
  ownerId?: string;
  createdAt: string;
  isPrivate?: boolean;
  isPublic?: boolean;
  joinCode?: string;
  schoolId?: string;
  createdByEmail?: string;
};

export type GroupType = 'course' | 'club' | 'study' | 'project' | 'social';

export type GroupMember = {
  id: string;
  groupId: string;
  userId: string;
  uid?: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
  user?: User;
  displayName?: string;
  email?: string;
  avatarUrl?: string | null;
  status?: string;
};

export type GroupPost = {
  id: string;
  groupId: string;
  authorId: string;
  author?: User;
  content: string;
  attachments?: Attachment[];
  isPinned?: boolean;
  isAnnouncement?: boolean;
  likeCount?: number;
  commentCount?: number;
  createdAt: string;
  updatedAt?: string;
};

export type Comment = {
  id: string;
  postId: string;
  groupId?: string;
  authorId: string;
  author?: User;
  content: string;
  parentId?: string;
  likeCount?: number;
  createdAt: string;
  updatedAt?: string;
};

// ===== 訊息與聊天 =====

export type Conversation = {
  id: string;
  memberIds: string[];
  participantUsers?: User[];
  schoolId?: string | null;
  lastMessage?: Message | null;
  lastMessageAt?: string | null;
  unreadCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  sender?: User;
  content: string;
  type: MessageType;
  attachments?: Attachment[];
  readBy?: string[];
  createdAt: string;
};

export type MessageType = 'text' | 'image' | 'file' | 'location' | 'system';

// ===== 失物招領 =====

export type LostFoundItem = {
  id: string;
  type: 'lost' | 'found';
  title: string;
  description: string;
  category: LostFoundCategory;
  location: string;
  date: string;
  imageUrls?: string[];
  imageUrl?: string;
  contactInfo?: string;
  status: 'open' | 'resolved' | 'expired' | 'claimed' | 'returned' | 'active';
  reporterId: string;
  reporter?: User;
  createdAt: string;
  resolvedAt?: string;
  schoolId?: string;
  claimedBy?: string;
  claimedAt?: string;
};

export type LostFoundCategory =
  | 'electronics'
  | 'documents'
  | 'clothing'
  | 'accessories'
  | 'cards'
  | 'books'
  | 'keys'
  | 'wallet'
  | 'other';

// ===== 圖書館 =====

export type LibraryBook = {
  id: string;
  isbn?: string;
  title: string;
  author: string;
  publisher?: string;
  publishYear?: number;
  publishedYear?: number;
  category?: string;
  location: string;
  available: number;
  total: number;
  copies?: number;
  coverUrl?: string;
  description?: string;
  schoolId?: string;
};

export type LibraryLoan = {
  id: string;
  userId: string;
  bookId: string;
  schoolId?: string;
  book?: LibraryBook;
  borrowedAt: string;
  dueAt?: string;
  dueDate?: string;
  returnedAt?: string;
  renewCount: number;
  status: 'borrowed' | 'returned' | 'overdue';
};

export type LibrarySeat = {
  id: string;
  zone: string;
  seatNumber: string;
  name?: string;
  floor?: string;
  hasOutlet: boolean;
  isQuietZone: boolean;
  status: 'available' | 'occupied' | 'reserved';
  reservedBy?: string;
  reservedUntil?: string;
  schoolId?: string;
};

export type SeatReservation = {
  id: string;
  userId: string;
  seatId: string;
  schoolId?: string;
  seat?: LibrarySeat;
  date: string;
  startTime: string;
  endTime: string;
  status: 'active' | 'completed' | 'cancelled' | 'noshow';
  createdAt?: string;
};

// ===== 公車與交通 =====

export type BusRoute = {
  id: string;
  name: string;
  description?: string;
  stops: BusStop[];
  schedule: BusScheduleItem[] | { weekday: string[]; weekend: string[] };
  isActive?: boolean;
  color?: string;
  frequency?: string;
  operatingHours?: string | { weekday: string[]; weekend: string[] } | BusScheduleItem[];
  schoolId?: string;
};

export type BusStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  order?: number;
};

export type BusScheduleItem = {
  stopId: string;
  departureTime: string;
  isWeekdayOnly?: boolean;
  isWeekendOnly?: boolean;
};

export type BusArrival = {
  id: string;
  routeId: string;
  stopId: string;
  estimatedArrival?: string;
  estimatedMinutes?: number;
  busId?: string;
  vehicleId?: string;
  isDelayed?: boolean;
  delayMinutes?: number;
};

// ===== 通知 =====

export type Notification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
  expiresAt?: string;
};

export type NotificationType =
  | 'announcement'
  | 'event'
  | 'grade'
  | 'assignment'
  | 'message'
  | 'reminder'
  | 'system';

// ===== 行事曆 =====

export type CalendarEvent = {
  id: string;
  userId: string;
  schoolId?: string;
  title: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  startDate?: string;
  endDate?: string;
  allDay?: boolean;
  location?: string;
  color?: string;
  type?: CalendarEventType;
  sourceId?: string;
  sourceType?: 'course' | 'event' | 'assignment' | 'custom';
  reminder?: number;
  recurrence?: RecurrenceRule;
};

export type CalendarEventType = 'class' | 'assignment' | 'exam' | 'event' | 'personal' | 'holiday';

export type RecurrenceRule = {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  endDate?: string;
  count?: number;
  byDays?: number[];
};

// ===== 支付 =====

export type PaymentMethod = {
  id: string;
  userId: string;
  type: 'credit_card' | 'debit_card' | 'campus_card' | 'mobile_pay';
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  createdAt: string;
};

export type Transaction = {
  id: string;
  userId: string;
  schoolId?: string;
  amount: number;
  currency: string;
  type: 'payment' | 'refund' | 'topup' | 'expense';
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  description: string;
  merchantId?: string;
  merchantName?: string;
  paymentMethodId?: string;
  createdAt: string;
  completedAt?: string;
};

export type Order = {
  id: string;
  userId: string;
  schoolId?: string;
  items: OrderItem[];
  subtotal?: number;
  tax?: number;
  total?: number;
  totalAmount?: number;
  status: OrderStatus;
  paymentStatus: 'pending' | 'paid' | 'refunded' | 'unpaid';
  merchantId?: string;
  merchantName?: string;
  cafeteria?: string;
  cafeteriaId?: string;
  queueNumber?: string;
  estimatedTime?: number;
  totalPrice?: number;
  pickupTime?: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
};

export type OrderItem = {
  menuItemId: string;
  name: string;
  quantity: number;
  price: number;
  options?: string[];
  note?: string;
};

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled';

// ===== 成就系統 =====

export type Achievement = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: AchievementCategory;
  points: number;
  requirement: number;
  secret?: boolean;
};

export type AchievementCategory =
  | 'academic'
  | 'social'
  | 'exploration'
  | 'contribution'
  | 'special';

export type UserAchievement = {
  id: string;
  userId?: string;
  schoolId?: string;
  achievementId?: string;
  achievement?: Achievement;
  progress: number;
  completed?: boolean;
  unlockedAt?: string;
  name?: string;
  description?: string;
  icon?: string;
  points?: number;
  category?: AchievementCategory | 'general';
  maxProgress?: number;
};

// ===== 共用類型 =====

export type Attachment = {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'document' | 'video' | 'audio' | 'other';
  size?: number;
  mimeType?: string;
};

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextCursor?: string;
};

export type QueryOptions = {
  page?: number;
  pageSize?: number;
  limit?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  search?: string;
  filters?: QueryFilter[];
};

export type QueryFilter = {
  field: string;
  operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
  value: unknown;
};

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
};

export type School = {
  id: string;
  code: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
  primaryColor?: string;
  domain?: string;
  ssoProvider?: 'oidc' | 'cas' | 'saml';
  ssoConfig?: Record<string, unknown>;
  features?: SchoolFeature[];
  createdAt: string;
};

export type SchoolFeature = 'sso' | 'library' | 'bus' | 'cafeteria' | 'payment' | 'ar_navigation';

// ===== 宿舍服務 =====

export type DormitoryInfo = {
  id: string;
  building: string;
  room: string;
  floor: number;
  roommates?: string[];
  startDate: string;
  endDate: string;
  userId: string;
  schoolId?: string;
};

export type RepairRequest = {
  id: string;
  type: RepairType;
  title: string;
  description: string;
  status: RepairStatus;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  room: string;
  userId: string;
  assignedTo?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  images?: string[];
  feedback?: string;
  rating?: number;
  schoolId?: string;
};

export type RepairType = 'electrical' | 'plumbing' | 'furniture' | 'ac' | 'internet' | 'other';

export type RepairStatus = 'pending' | 'assigned' | 'inProgress' | 'completed' | 'cancelled';

export type DormPackage = {
  id: string;
  trackingNumber: string;
  carrier: string;
  arrivedAt: string;
  status: 'pending' | 'picked' | 'returned';
  location: string;
  userId: string;
  pickedAt?: string;
  description?: string;
  schoolId?: string;
};

export type WashingMachine = {
  id: string;
  number: number;
  floor: string;
  building: string;
  status: 'available' | 'inUse' | 'maintenance' | 'reserved';
  type: 'washer' | 'dryer';
  remainingTime?: number;
  reservedBy?: string;
  reservedUntil?: string;
  price: number;
  schoolId?: string;
};

export type WashingReservation = {
  id: string;
  machineId: string;
  machine?: WashingMachine;
  userId: string;
  startTime: string;
  endTime?: string;
  status: 'reserved' | 'inUse' | 'completed' | 'cancelled' | 'noshow';
  createdAt: string;
};

export type DormAnnouncement = {
  id: string;
  title: string;
  content: string;
  type: 'notice' | 'warning' | 'emergency' | 'maintenance';
  building?: string;
  publishedAt: string;
  expiresAt?: string;
  schoolId?: string;
};

// ===== 列印服務 =====

export type Printer = {
  id: string;
  name: string;
  location: string;
  building: string;
  floor: string;
  status: 'online' | 'offline' | 'busy' | 'error' | 'outOfPaper' | 'outOfToner';
  capabilities: PrinterCapability[];
  queueLength: number;
  pricePerPage: {
    bw: number;
    color: number;
  };
  schoolId?: string;
};

export type PrinterCapability = 'color' | 'duplex' | 'a3' | 'a4' | 'scan' | 'copy';

export type PrintJob = {
  id: string;
  userId: string;
  schoolId?: string;
  printerId: string;
  printer?: Printer;
  fileName: string;
  fileUrl?: string;
  pages: number;
  copies: number;
  color: boolean;
  duplex: boolean;
  status: 'pending' | 'printing' | 'completed' | 'failed' | 'cancelled';
  cost: number;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
};

// ===== 健康服務 =====

export type HealthAppointment = {
  id: string;
  userId: string;
  department: HealthDepartment;
  doctorId?: string;
  doctorName?: string;
  date: string;
  timeSlot: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'noshow';
  reason?: string;
  notes?: string;
  createdAt: string;
  schoolId?: string;
};

export type HealthDepartment = 'general' | 'dental' | 'mental' | 'physical' | 'vaccination';

export type HealthRecord = {
  id: string;
  userId: string;
  type: 'appointment' | 'vaccination' | 'checkup' | 'prescription';
  title?: string;
  date: string;
  department: HealthDepartment;
  doctorName?: string;
  diagnosis?: string;
  prescription?: string;
  notes?: string;
  attachments?: Attachment[];
  schoolId?: string;
};

export type HealthTimeSlot = {
  id: string;
  department: HealthDepartment;
  doctorId?: string;
  doctorName?: string;
  date: string;
  time: string;
  available: boolean;
  capacity: number;
  booked: number;
};
