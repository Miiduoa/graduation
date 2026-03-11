/**
 * Firebase Firestore 資料庫種子腳本
 * 用於初始化示範資料
 * 
 * 使用方式:
 * 1. 設定 Firebase Admin SDK 認證
 *    - 前往 Firebase Console -> 專案設定 -> 服務帳戶
 *    - 產生新的私密金鑰，儲存為 serviceAccountKey.json
 * 2. 執行: node seed.js
 * 
 * 功能:
 * - 建立示範學校資料
 * - 建立示範使用者
 * - 建立公告、活動、餐廳、POI 等資料
 * - 建立 SSO 設定範本
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

if (!fs.existsSync(serviceAccountPath)) {
  console.log("⚠️  serviceAccountKey.json 未找到");
  console.log("請從 Firebase Console 下載服務帳戶金鑰：");
  console.log("Firebase Console -> 專案設定 -> 服務帳戶 -> 產生新的私密金鑰");
  console.log("");
  console.log("使用模擬器模式執行...");

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: "demo-campus" });
  } else {
    console.log("請設定 FIRESTORE_EMULATOR_HOST 環境變數，或提供 serviceAccountKey.json");
    process.exit(1);
  }
} else {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const DEMO_SCHOOL_ID = "ntust";
const DEMO_SCHOOL_NAME = "台灣科技大學";

const NOW = new Date();
const ONE_DAY = 24 * 60 * 60 * 1000;

function randomDate(daysFromNow, variance = 0) {
  const base = NOW.getTime() + daysFromNow * ONE_DAY;
  const offset = variance ? (Math.random() - 0.5) * 2 * variance * ONE_DAY : 0;
  return Timestamp.fromDate(new Date(base + offset));
}

function randomFutureDate(minDays, maxDays) {
  const days = minDays + Math.random() * (maxDays - minDays);
  return randomDate(days);
}

async function seedSchool() {
  console.log("📚 建立學校資料...");

  const schoolRef = db.collection("schools").doc(DEMO_SCHOOL_ID);
  await schoolRef.set({
    id: DEMO_SCHOOL_ID,
    name: DEMO_SCHOOL_NAME,
    shortName: "台科大",
    englishName: "National Taiwan University of Science and Technology",
    domain: "mail.ntust.edu.tw",
    logoUrl: "https://www.ntust.edu.tw/var/file/0/1000/img/513418973.png",
    primaryColor: "#003366",
    secondaryColor: "#FFD700",
    location: {
      latitude: 25.0133,
      longitude: 121.5414,
      address: "台北市大安區基隆路四段43號",
    },
    contactEmail: "info@mail.ntust.edu.tw",
    contactPhone: "02-2733-3141",
    website: "https://www.ntust.edu.tw",
    features: ["announcements", "events", "cafeteria", "map", "library", "bus", "groups"],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const ssoConfigRef = schoolRef.collection("settings").doc("sso");
  await ssoConfigRef.set({
    schoolId: DEMO_SCHOOL_ID,
    schoolName: DEMO_SCHOOL_NAME,
    ssoConfig: {
      provider: "oidc",
      name: "台科大單一登入",
      enabled: true,
      authUrl: "https://portal.ntust.edu.tw/oauth/authorize",
      tokenUrl: "https://portal.ntust.edu.tw/oauth/token",
      userInfoUrl: "https://portal.ntust.edu.tw/oauth/userinfo",
      clientId: "demo-client-id",
      scopes: ["openid", "profile", "email"],
    },
    emailDomain: "mail.ntust.edu.tw",
    allowEmailLogin: true,
  });

  console.log("  ✅ 學校資料建立完成");
}

async function seedAnnouncements() {
  console.log("📢 建立公告資料...");

  const announcements = [
    {
      title: "113 學年度第 2 學期註冊須知",
      content: "本學期註冊繳費日期為 2/15-2/28，請同學務必於期限內完成繳費。逾期未繳費者將依規定處理。",
      source: "教務處註冊組",
      category: "academic",
      priority: "high",
      tags: ["註冊", "繳費", "重要"],
      attachments: [],
      publishedAt: randomDate(-2),
      expiresAt: randomFutureDate(30, 60),
    },
    {
      title: "校園徵才博覽會報名開始",
      content: "113 年度校園徵才博覽會將於 3/15 舉辦，預計有 80 家企業參與。歡迎應屆畢業生及在校生踴躍參加！",
      source: "學務處職涯發展中心",
      category: "career",
      priority: "normal",
      tags: ["徵才", "就業", "活動"],
      attachments: [],
      publishedAt: randomDate(-5),
      expiresAt: randomFutureDate(20, 30),
    },
    {
      title: "圖書館寒假開放時間調整",
      content: "寒假期間（1/20-2/20）圖書館開放時間調整為 09:00-17:00，例假日休館。特殊開放時段請參閱圖書館網站公告。",
      source: "圖書館",
      category: "facility",
      priority: "normal",
      tags: ["圖書館", "開放時間"],
      attachments: [],
      publishedAt: randomDate(-10),
      expiresAt: randomFutureDate(15, 20),
    },
    {
      title: "學生宿舍申請公告",
      content: "113 學年度第 2 學期學生宿舍申請將於 1/15 開始，請有需求的同學至住宿服務組網站填寫申請表。床位有限，先搶先贏！",
      source: "學務處住宿服務組",
      category: "housing",
      priority: "high",
      tags: ["宿舍", "申請", "住宿"],
      attachments: [],
      publishedAt: randomDate(-15),
      expiresAt: randomFutureDate(10, 15),
    },
    {
      title: "校園網路維護通知",
      content: "預計於本週六 (1/20) 凌晨 02:00-06:00 進行校園網路設備維護，届時可能會有短暫斷線，敬請見諒。",
      source: "計算機中心",
      category: "system",
      priority: "normal",
      tags: ["網路", "維護"],
      attachments: [],
      publishedAt: randomDate(-1),
      expiresAt: randomFutureDate(3, 5),
    },
    {
      title: "期末考試時間表公告",
      content: "113 學年度第 1 學期期末考試週為 1/8-1/14，請同學注意各科目考試時間及教室，並做好準備。",
      source: "教務處課務組",
      category: "academic",
      priority: "high",
      tags: ["考試", "期末", "重要"],
      attachments: [],
      publishedAt: randomDate(-20),
      expiresAt: randomDate(0),
    },
    {
      title: "獎學金申請公告",
      content: "本學期各類獎學金開始申請，包含清寒獎學金、書卷獎、特殊表現獎學金等。詳情請至學務處網站查詢。",
      source: "學務處生活輔導組",
      category: "scholarship",
      priority: "normal",
      tags: ["獎學金", "申請"],
      attachments: [],
      publishedAt: randomDate(-7),
      expiresAt: randomFutureDate(25, 35),
    },
    {
      title: "停車證申請延長公告",
      content: "因應同學需求，本學期停車證申請期限延長至 2/28。請尚未申請的同學把握時間！",
      source: "總務處事務組",
      category: "facility",
      priority: "low",
      tags: ["停車", "申請"],
      attachments: [],
      publishedAt: randomDate(-3),
      expiresAt: randomFutureDate(40, 50),
    },
  ];

  const announcementsRef = db.collection("schools").doc(DEMO_SCHOOL_ID).collection("announcements");

  for (const announcement of announcements) {
    await announcementsRef.add({
      ...announcement,
      viewCount: Math.floor(Math.random() * 500) + 50,
      isImportant: announcement.priority === "high",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`  ✅ 建立了 ${announcements.length} 則公告`);
}

async function seedEvents() {
  console.log("📅 建立活動資料...");

  const events = [
    {
      title: "校園徵才博覽會",
      description: "年度最大校園徵才活動，超過 80 家知名企業現場徵才。提供履歷健檢、職涯諮詢等服務。",
      location: "國際大樓",
      category: "career",
      organizer: "職涯發展中心",
      startsAt: randomFutureDate(15, 20),
      endsAt: randomFutureDate(15.5, 20.5),
      registrationDeadline: randomFutureDate(10, 15),
      capacity: 500,
      registeredCount: Math.floor(Math.random() * 300) + 100,
      fee: 0,
      tags: ["徵才", "就業", "企業"],
    },
    {
      title: "社團聯合迎新茶會",
      description: "認識各社團的好機會！現場有才藝表演、社團介紹、抽獎活動等，歡迎新生參加。",
      location: "學生活動中心",
      category: "social",
      organizer: "學生會",
      startsAt: randomFutureDate(5, 10),
      endsAt: randomFutureDate(5.3, 10.3),
      registrationDeadline: randomFutureDate(3, 8),
      capacity: 200,
      registeredCount: Math.floor(Math.random() * 150) + 30,
      fee: 0,
      tags: ["社團", "迎新", "活動"],
    },
    {
      title: "程式設計工作坊 - Python 入門",
      description: "適合初學者的 Python 程式設計入門課程，從零開始學習程式邏輯與基礎語法。",
      location: "工程學院 E1-304",
      category: "workshop",
      organizer: "資訊工程學系",
      startsAt: randomFutureDate(7, 12),
      endsAt: randomFutureDate(7.2, 12.2),
      registrationDeadline: randomFutureDate(5, 10),
      capacity: 40,
      registeredCount: Math.floor(Math.random() * 35) + 5,
      fee: 100,
      tags: ["程式", "Python", "工作坊"],
    },
    {
      title: "校慶運動會",
      description: "一年一度的校慶運動會，包含田徑、球類、趣味競賽等項目。為班級爭光，展現青春活力！",
      location: "運動場",
      category: "sports",
      organizer: "體育室",
      startsAt: randomFutureDate(25, 35),
      endsAt: randomFutureDate(25.4, 35.4),
      registrationDeadline: randomFutureDate(20, 30),
      capacity: 2000,
      registeredCount: Math.floor(Math.random() * 1500) + 300,
      fee: 0,
      tags: ["運動會", "校慶", "競賽"],
    },
    {
      title: "學術演講：AI 在醫療領域的應用",
      description: "邀請業界專家分享人工智慧在醫療診斷、藥物研發等領域的最新應用與發展趨勢。",
      location: "國際會議廳",
      category: "lecture",
      organizer: "電機工程學系",
      startsAt: randomFutureDate(3, 7),
      endsAt: randomFutureDate(3.1, 7.1),
      registrationDeadline: randomFutureDate(1, 5),
      capacity: 150,
      registeredCount: Math.floor(Math.random() * 120) + 20,
      fee: 0,
      tags: ["演講", "AI", "醫療"],
    },
    {
      title: "期末音樂會",
      description: "音樂性社團期末聯合音樂會，包含古典、流行、搖滾等多種風格演出。",
      location: "藝文中心演藝廳",
      category: "performance",
      organizer: "音樂性社團聯盟",
      startsAt: randomFutureDate(10, 15),
      endsAt: randomFutureDate(10.15, 15.15),
      registrationDeadline: null,
      capacity: 300,
      registeredCount: Math.floor(Math.random() * 250) + 50,
      fee: 0,
      tags: ["音樂", "表演", "社團"],
    },
    {
      title: "創業講座：從 0 到 1 的創業之路",
      description: "邀請成功創業家分享創業經驗與心得，了解從點子到產品的完整過程。",
      location: "創新育成中心",
      category: "lecture",
      organizer: "創新創業中心",
      startsAt: randomFutureDate(8, 12),
      endsAt: randomFutureDate(8.1, 12.1),
      registrationDeadline: randomFutureDate(6, 10),
      capacity: 80,
      registeredCount: Math.floor(Math.random() * 60) + 15,
      fee: 0,
      tags: ["創業", "講座", "分享"],
    },
  ];

  const eventsRef = db.collection("schools").doc(DEMO_SCHOOL_ID).collection("events");

  for (const event of events) {
    await eventsRef.add({
      ...event,
      status: "published",
      isHighlighted: Math.random() > 0.7,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`  ✅ 建立了 ${events.length} 個活動`);
}

async function seedCafeterias() {
  console.log("🍽️ 建立餐廳資料...");

  const cafeterias = [
    {
      id: "cafeteria-1",
      name: "第一學生餐廳",
      location: "學生活動中心 1F",
      openingHours: "週一至週五 07:00-20:00，週六 08:00-14:00",
      seatingCapacity: 300,
      currentOccupancy: Math.floor(Math.random() * 200) + 50,
    },
    {
      id: "cafeteria-2",
      name: "第二學生餐廳",
      location: "工程學院地下室",
      openingHours: "週一至週五 11:00-14:00, 17:00-19:00",
      seatingCapacity: 200,
      currentOccupancy: Math.floor(Math.random() * 150) + 30,
    },
    {
      id: "cafeteria-3",
      name: "便利商店 7-11",
      location: "學生活動中心 B1",
      openingHours: "24小時營業",
      seatingCapacity: 20,
      currentOccupancy: Math.floor(Math.random() * 15) + 5,
    },
  ];

  const menus = [
    { name: "雞腿飯", price: 75, calories: 850, cafeteriaId: "cafeteria-1", category: "主餐", available: true },
    { name: "排骨飯", price: 70, calories: 800, cafeteriaId: "cafeteria-1", category: "主餐", available: true },
    { name: "滷肉飯", price: 45, calories: 550, cafeteriaId: "cafeteria-1", category: "主餐", available: true },
    { name: "蔬食便當", price: 65, calories: 450, cafeteriaId: "cafeteria-1", category: "素食", available: true },
    { name: "牛肉麵", price: 85, calories: 750, cafeteriaId: "cafeteria-2", category: "麵類", available: true },
    { name: "炸醬麵", price: 55, calories: 650, cafeteriaId: "cafeteria-2", category: "麵類", available: true },
    { name: "陽春麵", price: 40, calories: 400, cafeteriaId: "cafeteria-2", category: "麵類", available: true },
    { name: "水餃 (10入)", price: 50, calories: 500, cafeteriaId: "cafeteria-2", category: "點心", available: true },
    { name: "御飯糰", price: 32, calories: 280, cafeteriaId: "cafeteria-3", category: "輕食", available: true },
    { name: "關東煮 (3串)", price: 45, calories: 200, cafeteriaId: "cafeteria-3", category: "輕食", available: true },
    { name: "三明治", price: 38, calories: 350, cafeteriaId: "cafeteria-3", category: "輕食", available: true },
    { name: "大亨堡", price: 42, calories: 420, cafeteriaId: "cafeteria-3", category: "輕食", available: true },
  ];

  const cafeteriasRef = db.collection("schools").doc(DEMO_SCHOOL_ID).collection("cafeterias");
  const menusRef = db.collection("schools").doc(DEMO_SCHOOL_ID).collection("menus");

  for (const cafeteria of cafeterias) {
    await cafeteriasRef.doc(cafeteria.id).set({
      ...cafeteria,
      rating: (Math.random() * 1.5 + 3.5).toFixed(1),
      reviewCount: Math.floor(Math.random() * 200) + 50,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  for (const menu of menus) {
    await menusRef.add({
      ...menu,
      rating: (Math.random() * 1.5 + 3.5).toFixed(1),
      orderCount: Math.floor(Math.random() * 1000) + 100,
      tags: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`  ✅ 建立了 ${cafeterias.length} 間餐廳和 ${menus.length} 個菜單項目`);
}

async function seedPOIs() {
  console.log("📍 建立地點資料...");

  const pois = [
    {
      name: "圖書館",
      category: "學術",
      description: "總館含地下一層至地上十層，提供豐富藏書與自習空間",
      latitude: 25.0142,
      longitude: 121.5421,
      floor: "1F-10F",
      openingHours: "週一至週五 08:00-22:00，週六日 09:00-17:00",
      services: ["自習室", "影印", "電腦區", "討論室"],
    },
    {
      name: "行政大樓",
      category: "行政",
      description: "校長室、教務處、學務處、總務處等行政單位所在地",
      latitude: 25.0135,
      longitude: 121.5410,
      floor: "1F-5F",
      openingHours: "週一至週五 08:30-17:30",
      services: ["證明文件申請", "諮詢服務"],
    },
    {
      name: "學生活動中心",
      category: "生活",
      description: "學生餐廳、社團辦公室、便利商店等設施",
      latitude: 25.0128,
      longitude: 121.5405,
      floor: "B1-4F",
      openingHours: "07:00-22:00",
      services: ["餐飲", "社團", "ATM", "便利商店"],
    },
    {
      name: "體育館",
      category: "運動",
      description: "室內籃球場、羽球場、桌球室、健身房等運動設施",
      latitude: 25.0150,
      longitude: 121.5425,
      floor: "1F-3F",
      openingHours: "週一至週五 08:00-22:00，週六日 09:00-18:00",
      services: ["籃球", "羽球", "桌球", "健身房"],
    },
    {
      name: "游泳池",
      category: "運動",
      description: "標準 50 公尺泳池，提供學生游泳課程與自由泳時段",
      latitude: 25.0155,
      longitude: 121.5420,
      floor: "1F",
      openingHours: "週一至週五 06:00-22:00",
      services: ["游泳", "淋浴間", "置物櫃"],
    },
    {
      name: "工程學院 E1",
      category: "學術",
      description: "電機、機械、化工等系所教室與實驗室",
      latitude: 25.0138,
      longitude: 121.5430,
      floor: "1F-8F",
      openingHours: "週一至週五 07:00-22:00",
      services: ["教室", "實驗室", "研究室"],
    },
    {
      name: "管理學院",
      category: "學術",
      description: "企管、資管、財金等商管學系教室",
      latitude: 25.0130,
      longitude: 121.5415,
      floor: "1F-6F",
      openingHours: "週一至週五 07:00-22:00",
      services: ["教室", "電腦教室", "會議室"],
    },
    {
      name: "國際大樓",
      category: "學術",
      description: "國際會議廳、外語中心、國際學生服務處",
      latitude: 25.0145,
      longitude: 121.5408,
      floor: "1F-5F",
      openingHours: "週一至週五 08:00-21:00",
      services: ["會議廳", "語言學習", "國際服務"],
    },
    {
      name: "第一宿舍",
      category: "宿舍",
      description: "男生宿舍，4人一室，含公共浴室與洗衣間",
      latitude: 25.0158,
      longitude: 121.5435,
      floor: "1F-7F",
      openingHours: "24小時",
      services: ["住宿", "洗衣", "自習室"],
    },
    {
      name: "第二宿舍",
      category: "宿舍",
      description: "女生宿舍，4人一室，含公共浴室與交誼廳",
      latitude: 25.0160,
      longitude: 121.5430,
      floor: "1F-6F",
      openingHours: "24小時",
      services: ["住宿", "洗衣", "交誼廳"],
    },
    {
      name: "醫療中心",
      category: "服務",
      description: "提供基本醫療服務、健康諮詢、疫苗注射",
      latitude: 25.0132,
      longitude: 121.5418,
      floor: "1F",
      openingHours: "週一至週五 09:00-12:00, 14:00-17:00",
      services: ["看診", "健康諮詢", "急救"],
    },
    {
      name: "停車場",
      category: "交通",
      description: "機車停車場與汽車停車場",
      latitude: 25.0125,
      longitude: 121.5400,
      floor: "地面層",
      openingHours: "24小時",
      services: ["機車停車", "汽車停車"],
    },
  ];

  const poisRef = db.collection("schools").doc(DEMO_SCHOOL_ID).collection("pois");

  for (const poi of pois) {
    await poisRef.add({
      ...poi,
      coordinates: new admin.firestore.GeoPoint(poi.latitude, poi.longitude),
      isAccessible: Math.random() > 0.3,
      hasWifi: Math.random() > 0.2,
      rating: (Math.random() * 1 + 4).toFixed(1),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`  ✅ 建立了 ${pois.length} 個地點`);
}

async function seedGroups() {
  console.log("👥 建立群組資料...");

  const groups = [
    {
      name: "資工系 113 級",
      description: "資訊工程學系 113 級同學交流群組",
      category: "class",
      isPublic: false,
      memberCount: Math.floor(Math.random() * 50) + 30,
      tags: ["資工系", "113級", "班級"],
    },
    {
      name: "吉他社",
      description: "喜歡音樂的同學一起切磋琴藝！每週三晚上社課",
      category: "club",
      isPublic: true,
      memberCount: Math.floor(Math.random() * 40) + 20,
      tags: ["音樂", "吉他", "社團"],
    },
    {
      name: "跑步同好會",
      description: "一起晨跑、參加馬拉松，運動健身交朋友",
      category: "interest",
      isPublic: true,
      memberCount: Math.floor(Math.random() * 30) + 15,
      tags: ["運動", "跑步", "健身"],
    },
    {
      name: "程式設計讀書會",
      description: "一起學習演算法、資料結構，準備技術面試",
      category: "study",
      isPublic: true,
      memberCount: Math.floor(Math.random() * 25) + 10,
      tags: ["程式", "讀書會", "面試"],
    },
    {
      name: "交換學生群",
      description: "即將出國或已歸國的交換生經驗分享與交流",
      category: "interest",
      isPublic: true,
      memberCount: Math.floor(Math.random() * 20) + 8,
      tags: ["交換學生", "留學", "分享"],
    },
  ];

  const groupsRef = db.collection("groups");

  for (const group of groups) {
    await groupsRef.add({
      ...group,
      schoolId: DEMO_SCHOOL_ID,
      coverUrl: null,
      postCount: Math.floor(Math.random() * 100) + 10,
      lastActivityAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`  ✅ 建立了 ${groups.length} 個群組`);
}

async function seedBusSchedules() {
  console.log("🚌 建立公車時刻表...");

  const routes = [
    {
      routeId: "campus-shuttle",
      routeName: "校園接駁車",
      stops: ["校門口", "宿舍區", "圖書館", "工程學院", "體育館"],
      schedule: [
        { departureTime: "07:30", direction: "順向" },
        { departureTime: "08:00", direction: "順向" },
        { departureTime: "08:30", direction: "順向" },
        { departureTime: "12:00", direction: "逆向" },
        { departureTime: "12:30", direction: "逆向" },
        { departureTime: "17:30", direction: "順向" },
        { departureTime: "18:00", direction: "順向" },
        { departureTime: "21:00", direction: "逆向" },
      ],
      frequency: "尖峰時段 15 分鐘一班",
      operatingHours: "07:30-21:30",
    },
    {
      routeId: "mrt-shuttle",
      routeName: "捷運站接駁車",
      stops: ["公館站", "校門口"],
      schedule: [
        { departureTime: "07:00", direction: "進校" },
        { departureTime: "07:20", direction: "進校" },
        { departureTime: "07:40", direction: "進校" },
        { departureTime: "08:00", direction: "進校" },
        { departureTime: "17:00", direction: "離校" },
        { departureTime: "17:30", direction: "離校" },
        { departureTime: "18:00", direction: "離校" },
        { departureTime: "18:30", direction: "離校" },
      ],
      frequency: "尖峰時段 20 分鐘一班",
      operatingHours: "07:00-18:30",
    },
  ];

  const busRef = db.collection("schools").doc(DEMO_SCHOOL_ID).collection("busRoutes");

  for (const route of routes) {
    await busRef.doc(route.routeId).set({
      ...route,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`  ✅ 建立了 ${routes.length} 條公車路線`);
}

async function seedCourses() {
  console.log("📖 建立課程資料...");

  const courses = [
    { code: "CS101", name: "程式設計一", credits: 3, instructor: "王教授", category: "required", schedule: "週一 3-4 節" },
    { code: "CS102", name: "資料結構", credits: 3, instructor: "李教授", category: "required", schedule: "週二 5-6 節" },
    { code: "CS201", name: "演算法", credits: 3, instructor: "陳教授", category: "required", schedule: "週三 1-2 節" },
    { code: "CS301", name: "作業系統", credits: 3, instructor: "林教授", category: "required", schedule: "週四 3-4 節" },
    { code: "CS302", name: "資料庫系統", credits: 3, instructor: "張教授", category: "required", schedule: "週五 5-6 節" },
    { code: "CS401", name: "人工智慧概論", credits: 3, instructor: "黃教授", category: "elective", schedule: "週二 3-4 節" },
    { code: "CS402", name: "機器學習", credits: 3, instructor: "吳教授", category: "elective", schedule: "週三 7-8 節" },
    { code: "CS403", name: "深度學習", credits: 3, instructor: "劉教授", category: "elective", schedule: "週四 1-2 節" },
    { code: "CS404", name: "網頁程式設計", credits: 3, instructor: "周教授", category: "elective", schedule: "週一 5-6 節" },
    { code: "CS405", name: "行動應用開發", credits: 3, instructor: "鄭教授", category: "elective", schedule: "週五 3-4 節" },
    { code: "GE101", name: "科技與社會", credits: 2, instructor: "許教授", category: "general", schedule: "週五 7-8 節" },
    { code: "GE102", name: "藝術欣賞", credits: 2, instructor: "謝教授", category: "general", schedule: "週四 7-8 節" },
    { code: "GE103", name: "經濟學概論", credits: 2, instructor: "楊教授", category: "general", schedule: "週三 5-6 節" },
  ];

  const coursesRef = db.collection("schools").doc(DEMO_SCHOOL_ID).collection("courses");

  for (const course of courses) {
    await coursesRef.add({
      ...course,
      semester: "113-2",
      department: "資訊工程學系",
      enrollment: Math.floor(Math.random() * 30) + 20,
      capacity: 60,
      rating: (Math.random() * 1.5 + 3.5).toFixed(1),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`  ✅ 建立了 ${courses.length} 門課程`);
}

async function seedDemoUsers() {
  console.log("👤 建立示範使用者...");

  const users = [
    {
      uid: "demo-student-1",
      email: "student@mail.ntust.edu.tw",
      displayName: "王小明",
      studentId: "B11234567",
      department: "資訊工程學系",
      role: "student",
      grade: 3,
      balance: 1500,
    },
    {
      uid: "demo-student-2",
      email: "student2@mail.ntust.edu.tw",
      displayName: "李小華",
      studentId: "B11234568",
      department: "電機工程學系",
      role: "student",
      grade: 2,
      balance: 800,
    },
    {
      uid: "demo-teacher",
      email: "teacher@mail.ntust.edu.tw",
      displayName: "陳教授",
      department: "資訊工程學系",
      role: "teacher",
    },
    {
      uid: "demo-admin",
      email: "admin@mail.ntust.edu.tw",
      displayName: "系統管理員",
      department: "計算機中心",
      role: "admin",
    },
  ];

  const usersRef = db.collection("users");

  for (const user of users) {
    await usersRef.doc(user.uid).set({
      ...user,
      schoolId: DEMO_SCHOOL_ID,
      avatarUrl: null,
      notificationsEnabled: true,
      createdAt: FieldValue.serverTimestamp(),
      lastLoginAt: FieldValue.serverTimestamp(),
    });

    await db.collection("schools").doc(DEMO_SCHOOL_ID).collection("members").doc(user.uid).set({
      status: "active",
      role: user.role,
      joinedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log(`  ✅ 建立了 ${users.length} 位示範使用者`);
}

async function main() {
  console.log("🚀 開始建立示範資料...\n");

  try {
    await seedSchool();
    await seedAnnouncements();
    await seedEvents();
    await seedCafeterias();
    await seedPOIs();
    await seedGroups();
    await seedBusSchedules();
    await seedCourses();
    await seedDemoUsers();

    console.log("\n✨ 所有示範資料建立完成！");
    console.log("\n📋 建立的資料包含：");
    console.log("  - 1 所學校 (含 SSO 設定)");
    console.log("  - 8 則公告");
    console.log("  - 7 個活動");
    console.log("  - 3 間餐廳 + 12 個菜單");
    console.log("  - 12 個校園地點");
    console.log("  - 5 個群組");
    console.log("  - 2 條公車路線");
    console.log("  - 13 門課程");
    console.log("  - 4 位示範使用者");
    console.log("\n🔑 示範帳號：");
    console.log("  - 學生：student@mail.ntust.edu.tw");
    console.log("  - 教師：teacher@mail.ntust.edu.tw");
    console.log("  - 管理員：admin@mail.ntust.edu.tw");
  } catch (error) {
    console.error("❌ 建立資料時發生錯誤：", error);
    process.exit(1);
  }

  process.exit(0);
}

main();
