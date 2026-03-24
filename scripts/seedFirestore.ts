/**
 * Firebase Firestore Seed Script
 *
 * Usage: npx ts-node scripts/seedFirestore.ts
 *
 * Seeds demo data into Firestore for demonstration purposes.
 * Supports multiple schools with per-school data isolation.
 *
 * Prerequisites:
 * - Set GOOGLE_APPLICATION_CREDENTIALS environment variable pointing to a Firebase service account JSON
 * - Or run in a Firebase-authenticated environment
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const DEMO_SCHOOLS = ['tw-nchu', 'tw-demo-uni'];
const DEFAULT_USER_ID = 'demo-user-1';
const BATCH_SIZE = 500; // Firestore batch limit

// ===== Helper Functions =====

function getDateOffset(days: number, options?: { hours?: number }): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  if (options?.hours) {
    date.setHours(options.hours, 0, 0, 0);
  }
  return date.toISOString();
}

function createId(schoolId: string, prefix: string, num: number): string {
  return `${schoolId}-${prefix}-${num}`;
}

// ===== Demo Data Generators =====

function generateAnnouncements(schoolId: string) {
  const announcements = [
    {
      id: createId(schoolId, 'ann', 1),
      schoolId,
      title: '114學年度第二學期期中考時間公告',
      body: '親愛同學，期中考定於2026年4月20日至4月24日舉辦。請詳見教務系統選課時間表。',
      source: '教務處',
      category: 'academic',
      publishedAt: getDateOffset(-10),
      pinned: true,
    },
    {
      id: createId(schoolId, 'ann', 2),
      schoolId,
      title: '第二學期選課注意事項',
      body: '選課時間為3月24日至3月28日。請務必於期限內完成選課，逾期不受理。建議同學預先瀏覽選課清單。',
      source: '教務處',
      category: 'academic',
      publishedAt: getDateOffset(-8),
    },
    {
      id: createId(schoolId, 'ann', 3),
      schoolId,
      title: '碩博士班獎學金申請開放',
      body: '即日起至4月15日，符合資格之碩博士班學生可向學務處申請各項獎學金。獎學金總額較去年增加30%。',
      source: '學務處',
      category: 'event',
      publishedAt: getDateOffset(-5),
    },
    {
      id: createId(schoolId, 'ann', 4),
      schoolId,
      title: '2026校園社團博覽會',
      body: '時間：3月29日（週六）上午10:00-16:00\n地點：學生活動中心\n超過50個社團參展，等你來認識！',
      source: '學務處',
      category: 'event',
      publishedAt: getDateOffset(-3),
    },
    {
      id: createId(schoolId, 'ann', 5),
      schoolId,
      title: '圖書館2樓施工通知',
      body: '為改善館舍設施，圖書館2樓將於3月25日至4月10日進行整修。期間該樓層閉館，造成不便敬請見諒。',
      source: '總務處',
      category: 'system',
      publishedAt: getDateOffset(-7),
    },
  ];

  if (schoolId === 'tw-nchu') {
    return announcements;
  }
  return announcements.slice(0, 3);
}

function generateCourses(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'course', 1),
      schoolId,
      code: 'CS201',
      name: '資料結構',
      instructor: '陳教授',
      schedule: [
        { day: 'Monday', time: '10:00-11:30', room: '工程館101' },
        { day: 'Wednesday', time: '10:00-11:30', room: '工程館101' },
      ],
      credits: 3,
      enrolledCount: 45,
      capacity: 50,
    },
    {
      id: createId(schoolId, 'course', 2),
      schoolId,
      code: 'CS202',
      name: '演算法設計',
      instructor: '李教授',
      schedule: [
        { day: 'Tuesday', time: '14:00-15:30', room: '工程館202' },
        { day: 'Thursday', time: '14:00-15:30', room: '工程館202' },
      ],
      credits: 3,
      enrolledCount: 38,
      capacity: 45,
    },
    {
      id: createId(schoolId, 'course', 3),
      schoolId,
      code: 'CS203',
      name: '資料庫系統',
      instructor: '王教授',
      schedule: [
        { day: 'Monday', time: '13:00-14:30', room: '工程館301' },
        { day: 'Friday', time: '13:00-14:30', room: '工程館301' },
      ],
      credits: 3,
      enrolledCount: 52,
      capacity: 60,
    },
  ];
}

function generateEvents(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'event', 1),
      schoolId,
      name: '資訊社春季聚會',
      description: '歡迎所有程式愛好者參加！將分享最新的技術趨勢。',
      startTime: getDateOffset(7),
      endTime: getDateOffset(7, { hours: 18 }),
      location: '學生活動中心205室',
      category: 'social',
      attendeesCount: 23,
      maxAttendees: 50,
      organizer: '資訊社',
    },
    {
      id: createId(schoolId, 'event', 2),
      schoolId,
      name: '校園馬拉松',
      description: '2026年校園運動會馬拉松比賽。全程5公里。',
      startTime: getDateOffset(14),
      endTime: getDateOffset(14, { hours: 16 }),
      location: '校園內',
      category: 'sports',
      attendeesCount: 127,
      maxAttendees: 200,
      organizer: '體育室',
    },
  ];
}

function generatePois(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'poi', 1),
      schoolId,
      name: '工程館',
      description: '資訊工程系主要教學大樓',
      category: 'building',
      location: { lat: 24.1234, lng: 120.7890 },
      address: '校區中心',
      openingHours: { weekday: '08:00-22:00', weekend: '09:00-18:00' },
    },
    {
      id: createId(schoolId, 'poi', 2),
      schoolId,
      name: '圖書館',
      description: '校園中央圖書館',
      category: 'library',
      location: { lat: 24.1240, lng: 120.7885 },
      address: '校區中心',
      openingHours: { weekday: '08:00-23:00', weekend: '09:00-21:00' },
    },
    {
      id: createId(schoolId, 'poi', 3),
      schoolId,
      name: '學生餐廳',
      description: '提供平價餐飲服務',
      category: 'cafeteria',
      location: { lat: 24.1220, lng: 120.7900 },
      address: '學生活動中心1樓',
      openingHours: { weekday: '11:00-14:00,17:00-19:00', weekend: '11:30-13:30' },
    },
  ];
}

function generateCafeterias(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'cafe', 1),
      schoolId,
      name: '學生餐廳A',
      description: '主食滷肉飯、便當為主',
      location: { lat: 24.1220, lng: 120.7900 },
      openingHours: { weekday: '11:00-14:00,17:00-19:00', weekend: '11:30-13:30' },
      pilotStatus: 'live',
      orderingEnabled: true,
      merchantId: createId(schoolId, 'merchant', 1),
      rating: 4.2,
      reviewCount: 127,
    },
    {
      id: createId(schoolId, 'cafe', 2),
      schoolId,
      name: '咖啡館',
      description: '供應咖啡、茶飲及輕食',
      location: { lat: 24.1235, lng: 120.7895 },
      openingHours: { weekday: '08:00-18:00', weekend: '10:00-17:00' },
      pilotStatus: 'pilot',
      orderingEnabled: true,
      merchantId: createId(schoolId, 'merchant', 2),
      rating: 4.5,
      reviewCount: 89,
    },
  ];
}

function generateMenuItems(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'menu', 1),
      schoolId,
      cafeteriaId: createId(schoolId, 'cafe', 1),
      name: '滷肉飯',
      description: '傳統台灣滷肉飯，搭配滷蛋和青菜',
      price: 50,
      category: 'main',
      available: true,
      calories: 450,
      rating: 4.3,
    },
    {
      id: createId(schoolId, 'menu', 2),
      schoolId,
      cafeteriaId: createId(schoolId, 'cafe', 1),
      name: '雞腿便當',
      description: '炸雞腿便當，配白飯及時菜',
      price: 75,
      category: 'main',
      available: true,
      calories: 650,
      rating: 4.1,
    },
    {
      id: createId(schoolId, 'menu', 3),
      schoolId,
      cafeteriaId: createId(schoolId, 'cafe', 2),
      name: '拿鐵咖啡',
      description: '義大利濃縮咖啡加牛奶',
      price: 65,
      category: 'beverage',
      available: true,
      calories: 150,
      rating: 4.6,
    },
  ];
}

function generateUsers(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'user', 1),
      schoolId,
      email: 'student.demo@nchu.edu.tw',
      displayName: '陳小明',
      studentId: 'S110123456',
      department: '資訊工程學系',
      year: 2,
      role: 'student',
      createdAt: getDateOffset(-180),
    },
    {
      id: createId(schoolId, 'user', 2),
      schoolId,
      email: 'lin.jiayong@nchu.edu.tw',
      displayName: '林佳蓉',
      studentId: 'S110234567',
      department: '資訊工程學系',
      year: 2,
      role: 'student',
      createdAt: getDateOffset(-180),
    },
    {
      id: createId(schoolId, 'user', 3),
      schoolId,
      email: 'chang.zhihao@nchu.edu.tw',
      displayName: '張志豪',
      studentId: 'S110345678',
      department: '資訊工程學系',
      year: 3,
      role: 'student',
      createdAt: getDateOffset(-180),
    },
  ];
}

function generateGroups(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'group', 1),
      schoolId,
      name: '資訊社',
      description: '分享程式設計知識和技術交流',
      type: 'club',
      memberCount: 42,
      createdAt: getDateOffset(-365),
      coverImage: 'https://via.placeholder.com/400x200?text=CS+Club',
    },
    {
      id: createId(schoolId, 'group', 2),
      schoolId,
      name: '資料結構研讀組',
      description: '共同研讀資料結構課程',
      type: 'study',
      memberCount: 15,
      createdAt: getDateOffset(-30),
      coverImage: 'https://via.placeholder.com/400x200?text=Study+Group',
    },
  ];
}

function generateGroupPosts(schoolId: string) {
  const posts: any[] = [];
  const groupId1 = createId(schoolId, 'group', 1);
  const groupId2 = createId(schoolId, 'group', 2);

  posts.push(
    {
      id: createId(schoolId, 'post', 1),
      schoolId,
      groupId: groupId1,
      authorId: createId(schoolId, 'user', 1),
      content: '大家好！這次分享一個有趣的排序演算法優化技巧。',
      createdAt: getDateOffset(-5),
      likeCount: 23,
      commentCount: 8,
    },
    {
      id: createId(schoolId, 'post', 2),
      schoolId,
      groupId: groupId2,
      authorId: createId(schoolId, 'user', 2),
      content: '有人願意一起組讀書會嗎？準備期中考。',
      createdAt: getDateOffset(-2),
      likeCount: 12,
      commentCount: 5,
    }
  );

  return posts;
}

function generateBusRoutes(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'bus', 1),
      schoolId,
      routeName: '校園巡迴線',
      stops: [
        { name: '校園中心', order: 1 },
        { name: '工程館', order: 2 },
        { name: '圖書館', order: 3 },
        { name: '學生宿舍', order: 4 },
      ],
      schedules: [
        { departure: '08:00', arrival: '08:45' },
        { departure: '12:00', arrival: '12:45' },
        { departure: '16:00', arrival: '16:45' },
      ],
    },
  ];
}

function generateLibraryBooks(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'book', 1),
      schoolId,
      title: 'Introduction to Algorithms',
      author: 'Cormen, Leiserson, Rivest, Stein',
      isbn: '978-0262033848',
      publishedYear: 2009,
      category: '資訊科學',
      availableCopies: 3,
      totalCopies: 5,
      location: 'A2-301',
      rating: 4.8,
    },
    {
      id: createId(schoolId, 'book', 2),
      schoolId,
      title: 'Design Patterns',
      author: 'Gang of Four',
      isbn: '978-0201633610',
      publishedYear: 1994,
      category: '軟體設計',
      availableCopies: 1,
      totalCopies: 2,
      location: 'B1-250',
      rating: 4.6,
    },
  ];
}

function generateNotifications(schoolId: string, userId: string) {
  return [
    {
      id: createId(schoolId, 'notif', 1),
      schoolId,
      userId,
      title: '新公告發布',
      message: '教務處發布了新的期中考相關公告',
      type: 'announcement',
      read: false,
      createdAt: getDateOffset(-1),
    },
    {
      id: createId(schoolId, 'notif', 2),
      schoolId,
      userId,
      title: '課程提醒',
      message: '資料結構課程今天下午14:00開始',
      type: 'course',
      read: false,
      createdAt: getDateOffset(0),
    },
    {
      id: createId(schoolId, 'notif', 3),
      schoolId,
      userId,
      title: '新社團招募',
      message: '資訊社邀請你加入',
      type: 'group',
      read: true,
      createdAt: getDateOffset(-3),
    },
  ];
}

function generateAssignments(schoolId: string, groupId: string) {
  return [
    {
      id: createId(schoolId, 'assign', 1),
      schoolId,
      groupId,
      courseId: createId(schoolId, 'course', 1),
      title: '第一次程式習題',
      description: '實作基本的資料結構操作',
      dueDate: getDateOffset(7),
      type: 'homework',
      submissionCount: 34,
      totalStudents: 45,
    },
  ];
}

function generateLostFoundItems(schoolId: string) {
  return [
    {
      id: createId(schoolId, 'lf', 1),
      schoolId,
      title: '黑色雨傘',
      description: '在圖書館3樓遺失的黑色摺疊傘，柄部有黃色條紋',
      category: 'umbrella',
      location: '圖書館',
      dateFound: getDateOffset(-5),
      status: 'found',
      reporterId: createId(schoolId, 'user', 1),
    },
    {
      id: createId(schoolId, 'lf', 2),
      schoolId,
      title: '學生證',
      description: '遺失NCHU學生證，卡號S110234567',
      category: 'document',
      location: '學生餐廳',
      dateFound: getDateOffset(-2),
      status: 'lost',
      reporterId: createId(schoolId, 'user', 2),
    },
  ];
}

function generateCalendarEvents(schoolId: string, userId: string) {
  return [
    {
      id: createId(schoolId, 'cal', 1),
      schoolId,
      userId,
      title: '資料結構課',
      startTime: getDateOffset(1, { hours: 10 }),
      endTime: getDateOffset(1, { hours: 11 }),
      type: 'class',
      location: '工程館101',
    },
    {
      id: createId(schoolId, 'cal', 2),
      schoolId,
      userId,
      title: '期中考',
      startTime: getDateOffset(30),
      endTime: getDateOffset(35),
      type: 'exam',
    },
    {
      id: createId(schoolId, 'cal', 3),
      schoolId,
      userId,
      title: '習題繳交截止',
      startTime: getDateOffset(7),
      type: 'assignment',
    },
  ];
}

function generateConversations(schoolId: string, userId: string) {
  return [
    {
      id: createId(schoolId, 'conv', 1),
      schoolId,
      participantIds: [userId, createId(schoolId, 'user', 2)],
      lastMessage: '那我明天見！',
      lastMessageAt: getDateOffset(-2),
      createdAt: getDateOffset(-30),
      memberIds: [userId, createId(schoolId, 'user', 2)],
    },
    {
      id: createId(schoolId, 'conv', 2),
      schoolId,
      participantIds: [userId, createId(schoolId, 'user', 3)],
      lastMessage: '習題答案對了嗎？',
      lastMessageAt: getDateOffset(-1),
      createdAt: getDateOffset(-15),
      memberIds: [userId, createId(schoolId, 'user', 3)],
    },
  ];
}

// ===== Batch Write Helper =====

async function writeBatchDocuments(
  docs: Array<{ path: string[]; data: any }>,
  schoolId: string
): Promise<number> {
  let written = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const { path, data } of docs) {
    const ref = db.collection(path[0]);
    let docRef = ref as any;

    // Build path for nested collections
    for (let i = 1; i < path.length; i++) {
      if (i % 2 === 1) {
        // doc
        docRef = docRef.doc(path[i]);
      } else {
        // collection
        docRef = docRef.collection(path[i]);
      }
    }

    batch.set(docRef, data);
    batchCount++;
    written++;

    if (batchCount >= BATCH_SIZE) {
      await batch.commit();
      console.log(`  ✓ Committed ${batchCount} documents`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`  ✓ Committed ${batchCount} documents`);
  }

  return written;
}

// ===== Main Seed Function =====

async function seedSchool(schoolId: string) {
  console.log(`\n🏫 Seeding data for school: ${schoolId}`);
  const docs: Array<{ path: string[]; data: any }> = [];

  // 1. Announcements
  const announcements = generateAnnouncements(schoolId);
  announcements.forEach((ann) => {
    docs.push({ path: ['announcements', ann.id], data: ann });
  });
  console.log(`  📢 Generated ${announcements.length} announcements`);

  // 2. Courses
  const courses = generateCourses(schoolId);
  courses.forEach((course) => {
    docs.push({ path: ['courses', course.id], data: course });
  });
  console.log(`  📚 Generated ${courses.length} courses`);

  // 3. Events
  const events = generateEvents(schoolId);
  events.forEach((event) => {
    docs.push({ path: ['events', event.id], data: event });
  });
  console.log(`  🎉 Generated ${events.length} events`);

  // 4. POIs
  const pois = generatePois(schoolId);
  pois.forEach((poi) => {
    docs.push({ path: ['pois', poi.id], data: poi });
  });
  console.log(`  📍 Generated ${pois.length} POIs`);

  // 5. Cafeterias
  const cafeterias = generateCafeterias(schoolId);
  cafeterias.forEach((cafe) => {
    docs.push({ path: ['cafeterias', cafe.id], data: cafe });
  });
  console.log(`  🍽️  Generated ${cafeterias.length} cafeterias`);

  // 6. Menu Items
  const menuItems = generateMenuItems(schoolId);
  menuItems.forEach((item) => {
    docs.push({ path: ['menuItems', item.id], data: item });
  });
  console.log(`  🍜 Generated ${menuItems.length} menu items`);

  // 7. Users
  const users = generateUsers(schoolId);
  users.forEach((user) => {
    docs.push({ path: ['users', user.id], data: user });
  });
  console.log(`  👥 Generated ${users.length} users`);

  // 8. Groups
  const groups = generateGroups(schoolId);
  groups.forEach((group) => {
    docs.push({ path: ['groups', group.id], data: group });
  });
  console.log(`  👫 Generated ${groups.length} groups`);

  // 9. Group Posts
  const groupPosts = generateGroupPosts(schoolId);
  groupPosts.forEach((post) => {
    docs.push({ path: ['groupPosts', post.id], data: post });
  });
  console.log(`  💬 Generated ${groupPosts.length} group posts`);

  // 10. Bus Routes
  const busRoutes = generateBusRoutes(schoolId);
  busRoutes.forEach((route) => {
    docs.push({ path: ['busRoutes', route.id], data: route });
  });
  console.log(`  🚌 Generated ${busRoutes.length} bus routes`);

  // 11. Library Books
  const books = generateLibraryBooks(schoolId);
  books.forEach((book) => {
    docs.push({ path: ['libraryBooks', book.id], data: book });
  });
  console.log(`  📖 Generated ${books.length} library books`);

  // 12. Notifications (per user)
  const firstUserId = users[0]?.id || createId(schoolId, 'user', 1);
  const notifications = generateNotifications(schoolId, firstUserId);
  notifications.forEach((notif) => {
    docs.push({ path: ['notifications', notif.id], data: notif });
  });
  console.log(`  🔔 Generated ${notifications.length} notifications`);

  // 13. Assignments (per group)
  const firstGroupId = groups[0]?.id || createId(schoolId, 'group', 1);
  const assignments = generateAssignments(schoolId, firstGroupId);
  assignments.forEach((assign) => {
    docs.push({ path: ['assignments', assign.id], data: assign });
  });
  console.log(`  ✏️  Generated ${assignments.length} assignments`);

  // 14. Lost & Found Items
  const lostFound = generateLostFoundItems(schoolId);
  lostFound.forEach((item) => {
    docs.push({ path: ['lostFoundItems', item.id], data: item });
  });
  console.log(`  🔍 Generated ${lostFound.length} lost & found items`);

  // 15. Calendar Events (per user)
  const calendarEvents = generateCalendarEvents(schoolId, firstUserId);
  calendarEvents.forEach((event) => {
    docs.push({ path: ['calendarEvents', event.id], data: event });
  });
  console.log(`  📅 Generated ${calendarEvents.length} calendar events`);

  // 16. Conversations (per user)
  const conversations = generateConversations(schoolId, firstUserId);
  conversations.forEach((conv) => {
    docs.push({ path: ['conversations', conv.id], data: conv });
  });
  console.log(`  💭 Generated ${conversations.length} conversations`);

  // Write all documents
  console.log(`\n  Writing ${docs.length} total documents to Firestore...`);
  const written = await writeBatchDocuments(docs, schoolId);
  console.log(`  ✅ Successfully wrote ${written} documents`);

  return written;
}

async function main() {
  console.log('🌱 Starting Firestore seed...');
  console.log(`   Schools: ${DEMO_SCHOOLS.join(', ')}`);

  let totalWritten = 0;

  for (const schoolId of DEMO_SCHOOLS) {
    const count = await seedSchool(schoolId);
    totalWritten += count;
  }

  console.log(`\n✅ Seed complete! Total documents written: ${totalWritten}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
