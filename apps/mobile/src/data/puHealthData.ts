/**
 * 靜宜大學校園健康 — 完整真實資料 + 創新功能
 *
 * 創新定位：從「掛號預約 APP」→「AI 全人健康生態圈」
 * 市面上的校園健康 APP 只做「預約掛號→看診→紀錄」
 * 我們做到：
 *  1. AI 症狀自評分流（看診前自動分類急迫度 → 減少等待）
 *  2. 心理健康 Mood Tracker（匿名情緒日記 + 趨勢分析 + 預警）
 *  3. 校園 AED/急救資源即時地圖（救命黃金 4 分鐘）
 *  4. 健康護照（疫苗/健檢/過敏/血型 → 一碼通行）
 *  5. 運動處方箋（結合體適能數據 → 個人化運動建議）
 *  6. 匿名同儕互助圈（壓力管理/睡眠/飲食 → 社群力量）
 *  7. 季節性預防推播（流感/登革熱/PM2.5 → 即時警報）
 *  8. 跨角色全鏈路（學生↔校護↔醫師↔諮商師↔教練↔行政）
 */

// ═══════════════════════════════════════════════════
// 靜宜大學健康中心 — 真實資料
// ═══════════════════════════════════════════════════

export interface HealthCenterInfo {
  name: string;
  location: string;
  building: string;
  floor: string;
  phone: string;
  fax: string;
  email: string;
  hours: { day: string; time: string }[];
  address: string;
  lat: number;
  lng: number;
}

export const HEALTH_CENTER: HealthCenterInfo = {
  name: '靜宜大學衛生保健組',
  location: '行政大樓 1F',
  building: '行政大樓',
  floor: '1F',
  phone: '04-2632-8001 #11350',
  fax: '04-2631-0741',
  email: 'health@pu.edu.tw',
  hours: [
    { day: '週一至週五', time: '08:10 – 12:00, 13:10 – 17:00' },
    { day: '週六、週日', time: '休診' },
    { day: '寒暑假', time: '08:10 – 12:00, 13:10 – 16:00' },
  ],
  address: '台中市沙鹿區台灣大道七段200號',
  lat: 24.2281,
  lng: 120.5629,
};

export interface CounselingCenterInfo {
  name: string;
  location: string;
  phone: string;
  email: string;
  hours: { day: string; time: string }[];
  services: string[];
  bookingUrl: string;
}

export const COUNSELING_CENTER: CounselingCenterInfo = {
  name: '諮商暨健康中心（諮商組）',
  location: '至善樓 1F',
  phone: '04-2632-8001 #11261',
  email: 'counsel@pu.edu.tw',
  hours: [
    { day: '週一至週五', time: '08:30 – 17:30' },
    { day: '夜間諮商', time: '週二、週四 18:00 – 21:00（需預約）' },
  ],
  services: ['個別諮商', '團體諮商', '心理測驗', '工作坊', '導師轉介', '危機處理'],
  bookingUrl: 'https://counsel.pu.edu.tw/booking',
};

// ═══════════════════════════════════════════════════
// 科別 / 門診類型
// ═══════════════════════════════════════════════════

export type HealthDepartment =
  | 'general' // 一般門診（感冒/腸胃/皮膚）
  | 'women' // 女性保健
  | 'sports_injury' // 運動傷害/物理治療
  | 'dental' // 口腔保健（洗牙/塗氟）
  | 'eye' // 視力保健
  | 'vaccination' // 預防接種
  | 'nutrition' // 營養諮詢
  | 'mental' // 心理諮商
  | 'group_therapy' // 團體治療
  | 'crisis'; // 危機處理

export interface DepartmentInfo {
  id: HealthDepartment;
  label: string;
  icon: string;
  color: string;
  description: string;
  avgWaitMinutes: number;
  requiresAppointment: boolean;
  availableDays: string;
}

export const DEPARTMENTS: DepartmentInfo[] = [
  {
    id: 'general',
    label: '一般門診',
    icon: 'medical-outline',
    color: '#5856D6',
    description: '感冒/腸胃/皮膚/頭痛/過敏等一般症狀',
    avgWaitMinutes: 15,
    requiresAppointment: false,
    availableDays: '週一至週五',
  },
  {
    id: 'women',
    label: '女性保健',
    icon: 'female-outline',
    color: '#FF2D55',
    description: '月經不適/婦科諮詢/衛教',
    avgWaitMinutes: 20,
    requiresAppointment: true,
    availableDays: '週二、週四',
  },
  {
    id: 'sports_injury',
    label: '運動傷害',
    icon: 'fitness-outline',
    color: '#FF9500',
    description: '扭傷/拉傷/物理治療/復健指導',
    avgWaitMinutes: 25,
    requiresAppointment: true,
    availableDays: '週一、週三、週五',
  },
  {
    id: 'dental',
    label: '口腔保健',
    icon: 'happy-outline',
    color: '#34C759',
    description: '洗牙/塗氟/口腔檢查（合作牙醫巡診）',
    avgWaitMinutes: 30,
    requiresAppointment: true,
    availableDays: '每月第 2、4 週三',
  },
  {
    id: 'eye',
    label: '視力保健',
    icon: 'eye-outline',
    color: '#AF52DE',
    description: '視力檢查/用眼衛教/乾眼症諮詢',
    avgWaitMinutes: 10,
    requiresAppointment: false,
    availableDays: '週一至週五',
  },
  {
    id: 'vaccination',
    label: '預防接種',
    icon: 'medkit-outline',
    color: '#34C759',
    description: '流感/B肝/HPV/COVID疫苗',
    avgWaitMinutes: 10,
    requiresAppointment: true,
    availableDays: '依公告時間',
  },
  {
    id: 'nutrition',
    label: '營養諮詢',
    icon: 'nutrition-outline',
    color: '#5AC8FA',
    description: '體重管理/飲食規劃/特殊需求飲食',
    avgWaitMinutes: 30,
    requiresAppointment: true,
    availableDays: '週三',
  },
  {
    id: 'mental',
    label: '心理諮商',
    icon: 'heart-outline',
    color: '#AF52DE',
    description: '情緒/壓力/人際/生涯/感情困擾',
    avgWaitMinutes: 0,
    requiresAppointment: true,
    availableDays: '週一至週五（含夜間）',
  },
  {
    id: 'group_therapy',
    label: '團體工作坊',
    icon: 'people-outline',
    color: '#D70015',
    description: '壓力管理/人際溝通/自我探索/正念減壓',
    avgWaitMinutes: 0,
    requiresAppointment: true,
    availableDays: '依公告',
  },
  {
    id: 'crisis',
    label: '危機處理',
    icon: 'alert-circle-outline',
    color: '#FF3B30',
    description: '自傷傾向/重大創傷/緊急心理支持',
    avgWaitMinutes: 0,
    requiresAppointment: false,
    availableDays: '24h 緊急專線',
  },
];

export function getDeptInfo(id: HealthDepartment): DepartmentInfo {
  return DEPARTMENTS.find((d) => d.id === id) ?? DEPARTMENTS[0];
}

// ═══════════════════════════════════════════════════
// AI 症狀自評引擎 — 看診前分流
// ═══════════════════════════════════════════════════

export type SymptomSeverity = 'mild' | 'moderate' | 'severe' | 'emergency';
export type BodyPart =
  | 'head'
  | 'chest'
  | 'abdomen'
  | 'limbs'
  | 'skin'
  | 'eyes'
  | 'throat'
  | 'back'
  | 'mental'
  | 'other';

export interface SymptomOption {
  id: string;
  bodyPart: BodyPart;
  label: string;
  icon: string;
  followUpQuestions: string[];
  possibleDepartments: HealthDepartment[];
  severityIndicators: { keyword: string; level: SymptomSeverity }[];
}

export const SYMPTOM_OPTIONS: SymptomOption[] = [
  {
    id: 'headache',
    bodyPart: 'head',
    label: '頭痛',
    icon: 'flashlight-outline',
    followUpQuestions: ['持續多久？', '伴隨噁心嗎？', '有發燒嗎？', '視覺有異常嗎？'],
    possibleDepartments: ['general', 'eye'],
    severityIndicators: [
      { keyword: '劇烈', level: 'severe' },
      { keyword: '視覺模糊', level: 'severe' },
      { keyword: '輕微', level: 'mild' },
      { keyword: '偶爾', level: 'mild' },
    ],
  },
  {
    id: 'stomach',
    bodyPart: 'abdomen',
    label: '腹痛/腸胃',
    icon: 'restaurant-outline',
    followUpQuestions: ['飯前還是飯後？', '有腹瀉或嘔吐嗎？', '持續多久？', '有血便嗎？'],
    possibleDepartments: ['general'],
    severityIndicators: [
      { keyword: '血便', level: 'emergency' },
      { keyword: '劇痛', level: 'severe' },
      { keyword: '輕微不適', level: 'mild' },
    ],
  },
  {
    id: 'cold',
    bodyPart: 'throat',
    label: '感冒/喉嚨痛',
    icon: 'snow-outline',
    followUpQuestions: ['有發燒嗎？幾度？', '咳嗽有痰嗎？', '持續幾天了？'],
    possibleDepartments: ['general'],
    severityIndicators: [
      { keyword: '高燒', level: 'moderate' },
      { keyword: '呼吸困難', level: 'emergency' },
      { keyword: '微燒', level: 'mild' },
    ],
  },
  {
    id: 'skin',
    bodyPart: 'skin',
    label: '皮膚問題',
    icon: 'hand-left-outline',
    followUpQuestions: ['紅腫/起疹/搔癢？', '範圍多大？', '有接觸過敏原嗎？'],
    possibleDepartments: ['general'],
    severityIndicators: [
      { keyword: '全身', level: 'moderate' },
      { keyword: '呼吸急促', level: 'emergency' },
      { keyword: '局部', level: 'mild' },
    ],
  },
  {
    id: 'injury',
    bodyPart: 'limbs',
    label: '扭傷/拉傷',
    icon: 'accessibility-outline',
    followUpQuestions: ['哪個部位？', '能活動嗎？', '有腫脹嗎？', '何時受傷的？'],
    possibleDepartments: ['sports_injury', 'general'],
    severityIndicators: [
      { keyword: '無法行走', level: 'severe' },
      { keyword: '骨頭突出', level: 'emergency' },
      { keyword: '輕微腫脹', level: 'mild' },
    ],
  },
  {
    id: 'eye_issue',
    bodyPart: 'eyes',
    label: '眼睛不適',
    icon: 'eye-outline',
    followUpQuestions: ['乾澀/紅腫/視覺模糊？', '持續多久？', '有配戴隱形眼鏡嗎？'],
    possibleDepartments: ['eye', 'general'],
    severityIndicators: [
      { keyword: '突然看不見', level: 'emergency' },
      { keyword: '乾澀', level: 'mild' },
    ],
  },
  {
    id: 'period',
    bodyPart: 'abdomen',
    label: '生理期不適',
    icon: 'female-outline',
    followUpQuestions: ['經痛程度？', '經期規律嗎？', '出血量正常嗎？'],
    possibleDepartments: ['women', 'general'],
    severityIndicators: [
      { keyword: '大量出血', level: 'severe' },
      { keyword: '輕微悶痛', level: 'mild' },
    ],
  },
  {
    id: 'stress',
    bodyPart: 'mental',
    label: '壓力/情緒困擾',
    icon: 'cloudy-outline',
    followUpQuestions: ['持續多久了？', '影響睡眠嗎？', '有自傷想法嗎？', '是否有支持系統？'],
    possibleDepartments: ['mental', 'crisis'],
    severityIndicators: [
      { keyword: '自傷', level: 'emergency' },
      { keyword: '無法入睡超過一週', level: 'severe' },
      { keyword: '偶爾低落', level: 'mild' },
    ],
  },
  {
    id: 'sleep',
    bodyPart: 'mental',
    label: '失眠/睡眠問題',
    icon: 'moon-outline',
    followUpQuestions: ['入睡困難或早醒？', '持續幾天？', '有使用電子產品？', '壓力來源？'],
    possibleDepartments: ['mental', 'general'],
    severityIndicators: [
      { keyword: '超過兩週', level: 'moderate' },
      { keyword: '偶爾', level: 'mild' },
    ],
  },
  {
    id: 'back_pain',
    bodyPart: 'back',
    label: '腰背痛',
    icon: 'body-outline',
    followUpQuestions: ['久坐引起？', '有麻木感嗎？', '能否彎腰？'],
    possibleDepartments: ['sports_injury', 'general'],
    severityIndicators: [
      { keyword: '下肢麻木', level: 'severe' },
      { keyword: '久坐痠痛', level: 'mild' },
    ],
  },
];

export interface TriageResult {
  severity: SymptomSeverity;
  recommendedDepartment: HealthDepartment;
  urgencyMessage: string;
  waitEstimate: string;
  selfCareAdvice?: string[];
  shouldCallEmergency: boolean;
}

export function triageSymptom(symptomId: string, keywords: string[]): TriageResult {
  const symptom = SYMPTOM_OPTIONS.find((s) => s.id === symptomId);
  if (!symptom)
    return {
      severity: 'mild',
      recommendedDepartment: 'general',
      urgencyMessage: '建議就診',
      waitEstimate: '約 15 分鐘',
      shouldCallEmergency: false,
    };

  // 判斷嚴重程度
  let maxSeverity: SymptomSeverity = 'mild';
  const severityOrder: SymptomSeverity[] = ['mild', 'moderate', 'severe', 'emergency'];

  for (const kw of keywords) {
    for (const indicator of symptom.severityIndicators) {
      if (kw.includes(indicator.keyword)) {
        if (severityOrder.indexOf(indicator.level) > severityOrder.indexOf(maxSeverity)) {
          maxSeverity = indicator.level;
        }
      }
    }
  }

  const dept =
    maxSeverity === 'emergency' && symptom.possibleDepartments.includes('crisis')
      ? 'crisis'
      : symptom.possibleDepartments[0];
  const deptInfo = getDeptInfo(dept);

  const messages: Record<SymptomSeverity, string> = {
    mild: '症狀輕微，可先自我觀察。若持續請至健康中心',
    moderate: '建議今日內就診，可先至健康中心掛號',
    severe: '請盡快就醫，建議立即前往健康中心或就近醫院',
    emergency: '情況緊急！請立即撥打 119 或校園緊急專線',
  };

  const selfCare: Record<SymptomSeverity, string[] | undefined> = {
    mild: ['多喝水多休息', '避免過度疲勞', '觀察 24-48 小時症狀變化'],
    moderate: ['避免劇烈活動', '記錄症狀變化', '今日內安排就診'],
    severe: undefined,
    emergency: undefined,
  };

  return {
    severity: maxSeverity,
    recommendedDepartment: dept,
    urgencyMessage: messages[maxSeverity],
    waitEstimate: maxSeverity === 'emergency' ? '立即處理' : `約 ${deptInfo.avgWaitMinutes} 分鐘`,
    selfCareAdvice: selfCare[maxSeverity],
    shouldCallEmergency: maxSeverity === 'emergency',
  };
}

// ═══════════════════════════════════════════════════
// 心理健康 Mood Tracker
// ═══════════════════════════════════════════════════

export type MoodLevel = 1 | 2 | 3 | 4 | 5; // 1=很差 5=很好
export type MoodFactor =
  | 'academic'
  | 'social'
  | 'family'
  | 'romantic'
  | 'financial'
  | 'health'
  | 'sleep'
  | 'career'
  | 'other';

export interface MoodEntry {
  id: string;
  date: string;
  time: string;
  level: MoodLevel;
  factors: MoodFactor[];
  note?: string;
  isAnonymous: boolean;
}

export interface MoodTrend {
  weekAvg: number;
  monthAvg: number;
  trend: 'improving' | 'stable' | 'declining';
  dominantFactor: MoodFactor;
  alertLevel: 'normal' | 'attention' | 'concern' | 'urgent';
  suggestion: string;
}

export const MOOD_EMOJIS: Record<MoodLevel, { emoji: string; label: string; color: string }> = {
  1: { emoji: '😞', label: '很差', color: '#FF3B30' },
  2: { emoji: '😟', label: '不太好', color: '#FF9500' },
  3: { emoji: '😐', label: '普通', color: '#FF9500' },
  4: { emoji: '🙂', label: '不錯', color: '#34C759' },
  5: { emoji: '😄', label: '很好', color: '#34C759' },
};

export const MOOD_FACTORS: { id: MoodFactor; label: string; icon: string }[] = [
  { id: 'academic', label: '課業', icon: 'school-outline' },
  { id: 'social', label: '人際', icon: 'people-outline' },
  { id: 'family', label: '家庭', icon: 'home-outline' },
  { id: 'romantic', label: '感情', icon: 'heart-outline' },
  { id: 'financial', label: '經濟', icon: 'wallet-outline' },
  { id: 'health', label: '身體', icon: 'fitness-outline' },
  { id: 'sleep', label: '睡眠', icon: 'moon-outline' },
  { id: 'career', label: '生涯', icon: 'briefcase-outline' },
  { id: 'other', label: '其他', icon: 'ellipsis-horizontal-outline' },
];

export function analyzeMoodTrend(entries: MoodEntry[]): MoodTrend {
  if (entries.length === 0) {
    return {
      weekAvg: 3,
      monthAvg: 3,
      trend: 'stable',
      dominantFactor: 'academic',
      alertLevel: 'normal',
      suggestion: '開始記錄心情吧！',
    };
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  const weekEntries = entries.filter((e) => new Date(e.date) >= weekAgo);
  const monthEntries = entries.filter((e) => new Date(e.date) >= monthAgo);

  const weekAvg =
    weekEntries.length > 0 ? weekEntries.reduce((s, e) => s + e.level, 0) / weekEntries.length : 3;
  const monthAvg =
    monthEntries.length > 0
      ? monthEntries.reduce((s, e) => s + e.level, 0) / monthEntries.length
      : 3;

  const trend =
    weekAvg > monthAvg + 0.3 ? 'improving' : weekAvg < monthAvg - 0.3 ? 'declining' : 'stable';

  // 統計主要困擾
  const factorCount: Record<string, number> = {};
  for (const e of monthEntries) {
    for (const f of e.factors) factorCount[f] = (factorCount[f] ?? 0) + 1;
  }
  const dominantFactor = (Object.entries(factorCount).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    'academic') as MoodFactor;

  // 警戒等級
  let alertLevel: MoodTrend['alertLevel'] = 'normal';
  if (weekAvg <= 1.5) alertLevel = 'urgent';
  else if (weekAvg <= 2.2) alertLevel = 'concern';
  else if (weekAvg <= 2.8 || trend === 'declining') alertLevel = 'attention';

  const suggestions: Record<MoodTrend['alertLevel'], string> = {
    normal: '保持目前的生活節奏，繼續記錄心情變化',
    attention: '最近情緒稍有波動，建議多和朋友聊聊或參加工作坊',
    concern: '持續低落情緒，建議預約諮商師聊聊，我們都在這裡',
    urgent: '我們注意到你最近很辛苦，建議盡快聯繫諮商中心或信任的人',
  };

  return {
    weekAvg: Math.round(weekAvg * 10) / 10,
    monthAvg: Math.round(monthAvg * 10) / 10,
    trend,
    dominantFactor,
    alertLevel,
    suggestion: suggestions[alertLevel],
  };
}

// ═══════════════════════════════════════════════════
// 健康護照
// ═══════════════════════════════════════════════════

export type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'O+' | 'O-' | 'AB+' | 'AB-';
export type AllergyType = 'drug' | 'food' | 'environment' | 'other';

export interface HealthPassport {
  userId: string;
  bloodType?: BloodType;
  allergies: { type: AllergyType; name: string; severity: 'mild' | 'moderate' | 'severe' }[];
  chronicConditions: string[];
  medications: { name: string; dosage: string; frequency: string }[];
  emergencyContact: { name: string; relation: string; phone: string };
  vaccinations: VaccinationRecord[];
  lastCheckup?: string;
  bmi?: number;
  visionLeft?: number;
  visionRight?: number;
}

export interface VaccinationRecord {
  id: string;
  vaccine: string;
  date: string;
  dose: number;
  totalDoses: number;
  location: string;
  nextDueDate?: string;
  certificate?: string;
}

export const AVAILABLE_VACCINES: {
  id: string;
  name: string;
  doses: number;
  interval: string;
  note: string;
  icon: string;
  color: string;
}[] = [
  {
    id: 'flu',
    name: '季節性流感疫苗',
    doses: 1,
    interval: '每年一次',
    note: '每年10-11月開放接種',
    icon: 'snow-outline',
    color: '#5856D6',
  },
  {
    id: 'covid',
    name: 'COVID-19 疫苗',
    doses: 3,
    interval: '依 CDC 公告',
    note: 'XBB 次世代疫苗',
    icon: 'shield-outline',
    color: '#34C759',
  },
  {
    id: 'hpv',
    name: 'HPV 子宮頸癌疫苗',
    doses: 3,
    interval: '0-2-6 月',
    note: '26歲以下女性建議接種',
    icon: 'female-outline',
    color: '#FF2D55',
  },
  {
    id: 'hepb',
    name: 'B 型肝炎疫苗',
    doses: 3,
    interval: '0-1-6 月',
    note: '抗體不足者補接種',
    icon: 'water-outline',
    color: '#FF9500',
  },
  {
    id: 'tetanus',
    name: '破傷風疫苗',
    doses: 1,
    interval: '每 10 年追加',
    note: '運動員/戶外活動者建議',
    icon: 'fitness-outline',
    color: '#5856D6',
  },
  {
    id: 'mmr',
    name: 'MMR 麻疹腮腺炎德國麻疹',
    doses: 2,
    interval: '間隔 4 週',
    note: '出國交換前確認',
    icon: 'airplane-outline',
    color: '#D70015',
  },
];

// ═══════════════════════════════════════════════════
// AED 急救地圖
// ═══════════════════════════════════════════════════

export interface AEDLocation {
  id: string;
  name: string;
  building: string;
  floor: string;
  exactLocation: string;
  lat: number;
  lng: number;
  lastChecked: string;
  status: 'available' | 'maintenance' | 'used';
}

export const AED_LOCATIONS: AEDLocation[] = [
  {
    id: 'aed-1',
    name: '行政大樓 AED',
    building: '行政大樓',
    floor: '1F',
    exactLocation: '大門入口右側牆面',
    lat: 24.2281,
    lng: 120.5629,
    lastChecked: '2026-04-01',
    status: 'available',
  },
  {
    id: 'aed-2',
    name: '蓋夏圖書館 AED',
    building: '蓋夏圖書館',
    floor: '1F',
    exactLocation: '流通櫃檯旁',
    lat: 24.2275,
    lng: 120.5635,
    lastChecked: '2026-04-01',
    status: 'available',
  },
  {
    id: 'aed-3',
    name: '體育館 AED',
    building: '體育館',
    floor: '1F',
    exactLocation: '入口服務台旁',
    lat: 24.2265,
    lng: 120.563,
    lastChecked: '2026-04-01',
    status: 'available',
  },
  {
    id: 'aed-4',
    name: '學生餐廳 AED',
    building: '濟時樓',
    floor: '1F',
    exactLocation: '餐廳入口',
    lat: 24.2269,
    lng: 120.5638,
    lastChecked: '2026-03-15',
    status: 'available',
  },
  {
    id: 'aed-5',
    name: '至善樓 AED',
    building: '至善樓',
    floor: '1F',
    exactLocation: '警衛室旁',
    lat: 24.228,
    lng: 120.564,
    lastChecked: '2026-04-01',
    status: 'available',
  },
  {
    id: 'aed-6',
    name: '伯鐸樓 AED',
    building: '伯鐸樓',
    floor: '1F',
    exactLocation: '電梯旁牆面',
    lat: 24.2268,
    lng: 120.5642,
    lastChecked: '2026-03-20',
    status: 'available',
  },
  {
    id: 'aed-7',
    name: '宿舍區 AED',
    building: '希嘉學苑',
    floor: '1F',
    exactLocation: '宿舍大廳服務台',
    lat: 24.2285,
    lng: 120.5625,
    lastChecked: '2026-04-01',
    status: 'available',
  },
  {
    id: 'aed-8',
    name: '操場 AED',
    building: '戶外運動場',
    floor: '地面',
    exactLocation: '司令台側邊',
    lat: 24.2262,
    lng: 120.5628,
    lastChecked: '2026-03-25',
    status: 'available',
  },
];

export const EMERGENCY_NUMBERS = [
  {
    name: '校園緊急專線',
    phone: '04-2632-8001 #11119',
    icon: 'warning-outline',
    color: '#FF3B30',
    available: '24h',
  },
  {
    name: '衛保組',
    phone: '04-2632-8001 #11350',
    icon: 'medical-outline',
    color: '#5856D6',
    available: '上班時間',
  },
  {
    name: '諮商緊急專線',
    phone: '04-2632-8001 #11261',
    icon: 'heart-outline',
    color: '#AF52DE',
    available: '上班時間',
  },
  { name: '119 消防救護', phone: '119', icon: 'flame-outline', color: '#D70015', available: '24h' },
  {
    name: '安心專線',
    phone: '1925',
    icon: 'call-outline',
    color: '#34C759',
    available: '24h 免費',
  },
  { name: '生命線', phone: '1995', icon: 'pulse-outline', color: '#FF9500', available: '24h' },
  {
    name: '張老師專線',
    phone: '1980',
    icon: 'chatbubble-ellipses-outline',
    color: '#5AC8FA',
    available: '24h',
  },
];

// ═══════════════════════════════════════════════════
// 運動處方箋 + 體適能
// ═══════════════════════════════════════════════════

export type FitnessLevel = 'beginner' | 'intermediate' | 'advanced';
export type ExerciseType = 'cardio' | 'strength' | 'flexibility' | 'balance' | 'sports';

export interface FitnessProfile {
  userId: string;
  bmi: number;
  restingHR: number;
  level: FitnessLevel;
  weeklyExerciseMinutes: number;
  goals: string[];
  limitations: string[];
}

export interface ExercisePrescription {
  id: string;
  type: ExerciseType;
  name: string;
  icon: string;
  color: string;
  durationMinutes: number;
  frequency: string;
  intensity: 'low' | 'moderate' | 'high';
  calories: number;
  campusLocation: string;
  description: string;
}

export function generateExercisePrescription(profile: FitnessProfile): ExercisePrescription[] {
  const prescriptions: ExercisePrescription[] = [];

  // 基於 BMI 和目標推薦
  if (profile.bmi > 24 || profile.goals.includes('減重')) {
    prescriptions.push({
      id: 'rx-1',
      type: 'cardio',
      name: '操場慢跑',
      icon: 'walk-outline',
      color: '#5856D6',
      durationMinutes: 30,
      frequency: '每週 3-4 次',
      intensity: 'moderate',
      calories: 250,
      campusLocation: '操場',
      description: '從 10 分鐘開始，每週增加 5 分鐘',
    });
  }

  if (profile.goals.includes('紓壓') || profile.goals.includes('改善睡眠')) {
    prescriptions.push({
      id: 'rx-2',
      type: 'flexibility',
      name: '瑜珈伸展',
      icon: 'leaf-outline',
      color: '#34C759',
      durationMinutes: 20,
      frequency: '每週 2-3 次',
      intensity: 'low',
      calories: 80,
      campusLocation: '體育館韻律教室',
      description: '睡前伸展有助於改善睡眠品質',
    });
  }

  if (profile.level !== 'beginner') {
    prescriptions.push({
      id: 'rx-3',
      type: 'strength',
      name: '重量訓練',
      icon: 'barbell-outline',
      color: '#FF9500',
      durationMinutes: 40,
      frequency: '每週 2-3 次',
      intensity: 'high',
      calories: 200,
      campusLocation: '體育館重訓室',
      description: '建議搭配教練指導避免受傷',
    });
  }

  // 固定推薦
  prescriptions.push({
    id: 'rx-4',
    type: 'cardio',
    name: '校園散步',
    icon: 'footsteps-outline',
    color: '#AF52DE',
    durationMinutes: 15,
    frequency: '每日',
    intensity: 'low',
    calories: 60,
    campusLocation: '校園步道',
    description: '午餐後散步有助消化和提神',
  });

  return prescriptions;
}

// ═══════════════════════════════════════════════════
// 角色定義 + 權限矩陣
// ═══════════════════════════════════════════════════

export type HealthRole =
  | 'student' // 一般學生
  | 'student_athlete' // 體育生/運動員
  | 'nurse' // 校護/護理師
  | 'doctor' // 駐校醫師/特約醫師
  | 'counselor' // 心理諮商師
  | 'nutritionist' // 營養師
  | 'coach' // 體育教練
  | 'dorm_admin' // 宿舍管理員
  | 'health_admin' // 衛保組行政人員
  | 'system_admin'; // 系統管理

export type HealthFeature =
  | 'symptom_check'
  | 'book_appointment'
  | 'view_records'
  | 'health_passport'
  | 'mood_tracker'
  | 'exercise_rx'
  | 'peer_support'
  | 'aed_map'
  | 'emergency_call'
  | 'vaccine_info'
  | 'nutrition_plan'
  | 'sleep_tracker'
  | 'manage_appointments'
  | 'write_prescription'
  | 'view_patient_records'
  | 'triage_patients'
  | 'send_alert'
  | 'manage_vaccines'
  | 'counseling_notes'
  | 'crisis_response'
  | 'fitness_assessment'
  | 'group_sessions'
  | 'referral'
  | 'statistics'
  | 'policy_manage'
  | 'system_config';

export interface HealthRoleConfig {
  role: HealthRole;
  label: string;
  icon: string;
  color: string;
  features: HealthFeature[];
  description: string;
}

export const ROLE_HEALTH_CONFIG: HealthRoleConfig[] = [
  {
    role: 'student',
    label: '學生',
    icon: 'school-outline',
    color: '#5856D6',
    features: [
      'symptom_check',
      'book_appointment',
      'view_records',
      'health_passport',
      'mood_tracker',
      'exercise_rx',
      'peer_support',
      'aed_map',
      'emergency_call',
      'vaccine_info',
      'nutrition_plan',
      'sleep_tracker',
    ],
    description: 'AI 症狀自評、預約掛號、健康護照、情緒追蹤、運動處方',
  },
  {
    role: 'student_athlete',
    label: '體育生',
    icon: 'trophy-outline',
    color: '#FF9500',
    features: [
      'symptom_check',
      'book_appointment',
      'view_records',
      'health_passport',
      'mood_tracker',
      'exercise_rx',
      'peer_support',
      'aed_map',
      'emergency_call',
      'vaccine_info',
      'fitness_assessment',
      'nutrition_plan',
    ],
    description: '含學生功能 + 體適能評估 + 教練連結 + 運動傷害追蹤',
  },
  {
    role: 'nurse',
    label: '校護',
    icon: 'medkit-outline',
    color: '#34C759',
    features: [
      'triage_patients',
      'manage_appointments',
      'view_patient_records',
      'write_prescription',
      'manage_vaccines',
      'send_alert',
      'aed_map',
      'referral',
      'statistics',
    ],
    description: '分流掛號、量測生命徵象、衛教、疫苗管理、轉介',
  },
  {
    role: 'doctor',
    label: '駐校醫師',
    icon: 'pulse-outline',
    color: '#D70015',
    features: [
      'view_patient_records',
      'write_prescription',
      'manage_appointments',
      'referral',
      'statistics',
      'triage_patients',
    ],
    description: '診斷、開立處方、轉介外院、健康諮詢',
  },
  {
    role: 'counselor',
    label: '心理諮商師',
    icon: 'heart-outline',
    color: '#AF52DE',
    features: [
      'counseling_notes',
      'crisis_response',
      'group_sessions',
      'view_patient_records',
      'referral',
      'mood_tracker',
      'statistics',
    ],
    description: '個別/團體諮商、危機介入、導師轉介處理',
  },
  {
    role: 'nutritionist',
    label: '營養師',
    icon: 'nutrition-outline',
    color: '#5AC8FA',
    features: [
      'nutrition_plan',
      'view_patient_records',
      'fitness_assessment',
      'write_prescription',
      'group_sessions',
    ],
    description: '飲食評估、營養計畫、特殊飲食建議、衛教講座',
  },
  {
    role: 'coach',
    label: '體育教練',
    icon: 'fitness-outline',
    color: '#EA580C',
    features: [
      'fitness_assessment',
      'exercise_rx',
      'view_patient_records',
      'referral',
      'send_alert',
    ],
    description: '體適能評估、運動處方、傷害預防、轉介治療',
  },
  {
    role: 'dorm_admin',
    label: '宿舍管理員',
    icon: 'home-outline',
    color: '#FF2D55',
    features: ['emergency_call', 'aed_map', 'send_alert', 'referral'],
    description: '緊急通報、協助就醫、夜間急病處理',
  },
  {
    role: 'health_admin',
    label: '衛保組行政',
    icon: 'clipboard-outline',
    color: '#3C3C43',
    features: [
      'manage_appointments',
      'manage_vaccines',
      'send_alert',
      'statistics',
      'policy_manage',
      'referral',
    ],
    description: '行政管理、疫苗計畫、健檢安排、衛教活動',
  },
  {
    role: 'system_admin',
    label: '系統管理',
    icon: 'settings-outline',
    color: '#8E8E93',
    features: ['system_config', 'statistics', 'send_alert', 'policy_manage'],
    description: '系統設定、資料管理、推播設定',
  },
];

export function hasHealthFeature(role: HealthRole, feature: HealthFeature): boolean {
  return ROLE_HEALTH_CONFIG.find((r) => r.role === role)?.features.includes(feature) ?? false;
}

// ═══════════════════════════════════════════════════
// 角色間動作關聯
// ═══════════════════════════════════════════════════

export interface HealthRoleInteraction {
  from: HealthRole;
  to: HealthRole;
  actions: { id: string; label: string; icon: string; description: string }[];
}

export const HEALTH_ROLE_INTERACTIONS: HealthRoleInteraction[] = [
  // ── 學生 → 校護 ──
  {
    from: 'student',
    to: 'nurse',
    actions: [
      {
        id: 'self_triage',
        label: 'AI 分流掛號',
        icon: 'git-compare-outline',
        description: '症狀自評後自動分類、掛號、排序看診',
      },
      {
        id: 'walk_in',
        label: '現場掛號',
        icon: 'log-in-outline',
        description: '直接到衛保組掛號就診',
      },
      {
        id: 'vaccine_book',
        label: '疫苗預約',
        icon: 'medkit-outline',
        description: '線上預約各類疫苗接種',
      },
      {
        id: 'health_consult',
        label: '健康諮詢',
        icon: 'chatbubble-outline',
        description: '線上或現場健康問題諮詢',
      },
    ],
  },
  // ── 校護 → 學生 ──
  {
    from: 'nurse',
    to: 'student',
    actions: [
      {
        id: 'triage_result',
        label: '分流結果通知',
        icon: 'notifications-outline',
        description: 'AI 分流後通知看診順序和預估等待時間',
      },
      {
        id: 'health_remind',
        label: '健康提醒',
        icon: 'alarm-outline',
        description: '定期健檢/疫苗追加/用藥提醒',
      },
      {
        id: 'health_edu',
        label: '衛教推播',
        icon: 'book-outline',
        description: '季節性健康資訊/預防宣導',
      },
      {
        id: 'report_ready',
        label: '報告完成通知',
        icon: 'document-text-outline',
        description: '健檢/抽血報告已上傳可查看',
      },
    ],
  },
  // ── 學生 → 諮商師 ──
  {
    from: 'student',
    to: 'counselor',
    actions: [
      {
        id: 'book_counseling',
        label: '預約諮商',
        icon: 'calendar-outline',
        description: '線上預約個別諮商或團體',
      },
      {
        id: 'mood_share',
        label: '情緒日記分享',
        icon: 'analytics-outline',
        description: '授權諮商師查看 Mood Tracker 趨勢（可匿名）',
      },
      {
        id: 'crisis_help',
        label: '緊急求助',
        icon: 'alert-circle-outline',
        description: '一鍵連繫諮商師/發送危機訊號',
      },
    ],
  },
  // ── 諮商師 → 學生 ──
  {
    from: 'counselor',
    to: 'student',
    actions: [
      {
        id: 'session_confirm',
        label: '預約確認/提醒',
        icon: 'checkmark-circle-outline',
        description: '諮商時間確認和行前提醒',
      },
      {
        id: 'resource_share',
        label: '分享資源',
        icon: 'link-outline',
        description: '推薦自助文章/工作坊/正念資源',
      },
      {
        id: 'mood_alert',
        label: '關懷追蹤',
        icon: 'heart-outline',
        description: 'Mood Tracker 預警後主動聯繫關懷',
      },
      {
        id: 'group_invite',
        label: '團體邀請',
        icon: 'people-outline',
        description: '邀請加入合適的治療性團體',
      },
    ],
  },
  // ── 校護 → 醫師 ──
  {
    from: 'nurse',
    to: 'doctor',
    actions: [
      {
        id: 'assign_patient',
        label: '分配看診',
        icon: 'person-add-outline',
        description: '分流後將學生分配給醫師看診',
      },
      {
        id: 'vital_signs',
        label: '回報生命徵象',
        icon: 'pulse-outline',
        description: '量測結果（體溫/血壓/心率）回傳',
      },
    ],
  },
  // ── 醫師 → 學生 ──
  {
    from: 'doctor',
    to: 'student',
    actions: [
      {
        id: 'diagnosis',
        label: '診斷/處方',
        icon: 'document-text-outline',
        description: '開立診斷書和處方箋',
      },
      {
        id: 'referral_out',
        label: '轉介外院',
        icon: 'arrow-forward-outline',
        description: '病情需要時轉介合作醫院',
      },
      { id: 'follow_up', label: '複診提醒', icon: 'repeat-outline', description: '安排回診追蹤' },
    ],
  },
  // ── 教練 → 學生(運動員) ──
  {
    from: 'coach',
    to: 'student_athlete',
    actions: [
      {
        id: 'fitness_plan',
        label: '訓練計畫',
        icon: 'barbell-outline',
        description: '個人化訓練課表和強度調整',
      },
      {
        id: 'injury_alert',
        label: '傷害預防提醒',
        icon: 'alert-outline',
        description: '訓練前風險評估/恢復指引',
      },
      {
        id: 'refer_treatment',
        label: '轉介治療',
        icon: 'medkit-outline',
        description: '運動傷害轉介運動醫學',
      },
    ],
  },
  // ── 學生(運動員) → 教練 ──
  {
    from: 'student_athlete',
    to: 'coach',
    actions: [
      {
        id: 'report_pain',
        label: '回報不適',
        icon: 'body-outline',
        description: '訓練中/後不適即時回報',
      },
      {
        id: 'fitness_data',
        label: '體能數據同步',
        icon: 'analytics-outline',
        description: '體適能評估結果同步給教練',
      },
    ],
  },
  // ── 宿舍管理 → 校護 ──
  {
    from: 'dorm_admin',
    to: 'nurse',
    actions: [
      {
        id: 'night_emergency',
        label: '夜間急症通報',
        icon: 'moon-outline',
        description: '夜間/假日住宿生急病通報',
      },
      {
        id: 'epidemic_report',
        label: '群聚通報',
        icon: 'people-outline',
        description: '宿舍出現疑似群聚感染通報',
      },
    ],
  },
  // ── 衛保組行政 → 全校 ──
  {
    from: 'health_admin',
    to: 'student',
    actions: [
      {
        id: 'vaccine_campaign',
        label: '疫苗接種公告',
        icon: 'megaphone-outline',
        description: '疫苗到貨/開放預約通知',
      },
      {
        id: 'checkup_arrange',
        label: '健檢安排',
        icon: 'clipboard-outline',
        description: '新生健檢/年度健檢時程',
      },
      {
        id: 'epidemic_alert',
        label: '疫情/空污警報',
        icon: 'warning-outline',
        description: '流感高峰/登革熱/PM2.5 預警',
      },
    ],
  },
  // ── 系統 → 學生 ──
  {
    from: 'system_admin',
    to: 'student',
    actions: [
      {
        id: 'mood_nudge',
        label: '情緒關懷推播',
        icon: 'sparkles-outline',
        description: '偵測 Mood Tracker 低落趨勢，溫柔提醒資源',
      },
      {
        id: 'seasonal_tip',
        label: '季節保健提醒',
        icon: 'sunny-outline',
        description: '依季節推送保健知識（中暑/流感/過敏）',
      },
      {
        id: 'aed_proximity',
        label: 'AED 位置推播',
        icon: 'location-outline',
        description: '緊急時推播最近 AED 位置',
      },
    ],
  },
  // ── 諮商師 → 校護/醫師 (跨專業) ──
  {
    from: 'counselor',
    to: 'nurse',
    actions: [
      {
        id: 'psych_referral',
        label: '身心轉介',
        icon: 'swap-horizontal-outline',
        description: '心理問題合併身體症狀時轉介醫療',
      },
      {
        id: 'medication_consult',
        label: '藥物諮詢',
        icon: 'medical-outline',
        description: '評估是否需精神科藥物轉介',
      },
    ],
  },
];

// ═══════════════════════════════════════════════════
// 匿名同儕互助圈
// ═══════════════════════════════════════════════════

export type PeerSupportTopic =
  | 'stress'
  | 'sleep'
  | 'loneliness'
  | 'anxiety'
  | 'diet'
  | 'exercise'
  | 'breakup'
  | 'homesick'
  | 'academic_pressure'
  | 'career_worry';

export interface PeerSupportPost {
  id: string;
  topic: PeerSupportTopic;
  content: string;
  isAnonymous: boolean;
  authorAlias: string; // 匿名時的代稱（如「操場的雲」「圖書館的貓」）
  createdAt: string;
  reactions: { type: 'hug' | 'same' | 'cheer'; count: number }[];
  replyCount: number;
}

export const PEER_TOPICS: { id: PeerSupportTopic; label: string; icon: string; color: string }[] = [
  { id: 'stress', label: '壓力山大', icon: 'thunderstorm-outline', color: '#FF3B30' },
  { id: 'sleep', label: '失眠夜貓', icon: 'moon-outline', color: '#5856D6' },
  { id: 'loneliness', label: '感到孤單', icon: 'person-outline', color: '#AF52DE' },
  { id: 'anxiety', label: '焦慮不安', icon: 'pulse-outline', color: '#FF9500' },
  { id: 'diet', label: '飲食困擾', icon: 'fast-food-outline', color: '#34C759' },
  { id: 'exercise', label: '運動打卡', icon: 'bicycle-outline', color: '#5856D6' },
  { id: 'breakup', label: '感情傷痛', icon: 'heart-dislike-outline', color: '#FF2D55' },
  { id: 'homesick', label: '想家', icon: 'home-outline', color: '#FF9500' },
  { id: 'academic_pressure', label: '考試地獄', icon: 'school-outline', color: '#D70015' },
  { id: 'career_worry', label: '未來迷惘', icon: 'compass-outline', color: '#5AC8FA' },
];

// ═══════════════════════════════════════════════════
// 季節性健康預警
// ═══════════════════════════════════════════════════

export type AlertType =
  | 'flu'
  | 'dengue'
  | 'pm25'
  | 'heat'
  | 'cold'
  | 'allergy'
  | 'covid'
  | 'food_safety';

export interface SeasonalAlert {
  id: string;
  type: AlertType;
  title: string;
  severity: 'info' | 'warning' | 'danger';
  icon: string;
  color: string;
  message: string;
  preventionTips: string[];
  validFrom: string;
  validTo: string;
}

export function getActiveAlerts(): SeasonalAlert[] {
  const month = new Date().getMonth() + 1; // 1-12
  const alerts: SeasonalAlert[] = [];

  if (month >= 10 || month <= 2) {
    alerts.push({
      id: 'flu-season',
      type: 'flu',
      title: '流感高峰期',
      severity: 'warning',
      icon: 'snow-outline',
      color: '#5856D6',
      message: '10月至隔年2月為流感高峰，建議接種疫苗',
      preventionTips: ['接種流感疫苗', '勤洗手', '避免觸摸口鼻', '維持室內通風', '充足睡眠'],
      validFrom: '2025-10-01',
      validTo: '2026-02-28',
    });
  }

  if (month >= 5 && month <= 10) {
    alerts.push({
      id: 'dengue-alert',
      type: 'dengue',
      title: '登革熱防治期',
      severity: 'warning',
      icon: 'bug-outline',
      color: '#FF9500',
      message: '台中地區登革熱病媒蚊活躍，請注意防蚊',
      preventionTips: ['清除積水容器', '穿著長袖長褲', '使用防蚊液', '裝設紗門紗窗'],
      validFrom: '2026-05-01',
      validTo: '2026-10-31',
    });
  }

  if (month >= 3 && month <= 5) {
    alerts.push({
      id: 'allergy-spring',
      type: 'allergy',
      title: '春季過敏好發期',
      severity: 'info',
      icon: 'flower-outline',
      color: '#FF2D55',
      message: '花粉和塵蟎活躍，過敏體質者請注意',
      preventionTips: ['外出戴口罩', '回家更換衣物', '保持室內清潔', '使用空氣清淨機'],
      validFrom: '2026-03-01',
      validTo: '2026-05-31',
    });
  }

  if (month >= 6 && month <= 9) {
    alerts.push({
      id: 'heat-summer',
      type: 'heat',
      title: '中暑預防',
      severity: 'warning',
      icon: 'sunny-outline',
      color: '#FF3B30',
      message: '高溫警報！戶外活動請注意防曬補水',
      preventionTips: ['避免正午戶外活動', '隨時補充水分', '穿著透氣衣物', '注意中暑前兆'],
      validFrom: '2026-06-01',
      validTo: '2026-09-30',
    });
  }

  // 固定：PM2.5
  alerts.push({
    id: 'pm25-check',
    type: 'pm25',
    title: '空氣品質注意',
    severity: 'info',
    icon: 'cloud-outline',
    color: '#8E8E93',
    message: '台中冬季空品易不佳，敏感族群請留意',
    preventionTips: ['查看即時 AQI', '紅燈時減少戶外運動', '戴 N95 口罩', '室內使用空氣清淨機'],
    validFrom: '2025-11-01',
    validTo: '2026-03-31',
  });

  return alerts;
}

// ═══════════════════════════════════════════════════
// 時段感知推薦
// ═══════════════════════════════════════════════════

export interface HealthSuggestion {
  icon: string;
  text: string;
  color: string;
  action?: string;
}

export function getSmartHealthSuggestions(): HealthSuggestion[] {
  const hour = new Date().getHours();
  const suggestions: HealthSuggestion[] = [];

  if (hour >= 6 && hour < 9) {
    suggestions.push({
      icon: 'sunny-outline',
      text: '早安！吃早餐了嗎？規律飲食有助專注力',
      color: '#FF9500',
    });
    suggestions.push({
      icon: 'water-outline',
      text: '起床後喝一杯溫水開啟新陳代謝',
      color: '#5856D6',
    });
  }
  if (hour >= 10 && hour < 12) {
    suggestions.push({
      icon: 'eye-outline',
      text: '用電腦 50 分鐘了？看看遠方休息眼睛',
      color: '#AF52DE',
      action: 'eye_rest',
    });
  }
  if (hour >= 12 && hour < 14) {
    suggestions.push({
      icon: 'restaurant-outline',
      text: '午餐選擇蔬菜蛋白質搭配，少油少鹽',
      color: '#34C759',
    });
    suggestions.push({
      icon: 'walk-outline',
      text: '飯後走 15 分鐘幫助消化',
      color: '#34C759',
      action: 'exercise',
    });
  }
  if (hour >= 14 && hour < 17) {
    suggestions.push({
      icon: 'water-outline',
      text: '提醒補充水分！每天建議 2000ml',
      color: '#5856D6',
    });
  }
  if (hour >= 17 && hour < 20) {
    suggestions.push({
      icon: 'fitness-outline',
      text: '下課了！體育館重訓室還有位置',
      color: '#FF9500',
      action: 'exercise',
    });
  }
  if (hour >= 21 && hour < 23) {
    suggestions.push({
      icon: 'moon-outline',
      text: '睡前 1 小時放下手機，幫助入睡',
      color: '#5856D6',
      action: 'sleep',
    });
    suggestions.push({
      icon: 'happy-outline',
      text: '記錄今天的心情吧',
      color: '#FF2D55',
      action: 'mood',
    });
  }
  if (hour >= 23 || hour < 6) {
    suggestions.push({
      icon: 'bed-outline',
      text: '大學生也需要睡眠！明天會更好的',
      color: '#AF52DE',
    });
  }

  return suggestions.slice(0, 3);
}

// ═══════════════════════════════════════════════════
// 推播通知類型
// ═══════════════════════════════════════════════════

export type HealthNotificationType =
  | 'appointment_remind' // 看診提醒
  | 'vaccine_available' // 疫苗開放
  | 'report_ready' // 檢驗報告
  | 'mood_nudge' // 情緒關懷
  | 'seasonal_alert' // 季節預警
  | 'exercise_remind' // 運動提醒
  | 'hydration' // 補水提醒
  | 'counseling_remind' // 諮商提醒
  | 'checkup_due' // 健檢到期
  | 'peer_reply' // 互助圈回覆
  | 'prescription_refill' // 處方到期
  | 'aed_check'; // AED 巡檢

export interface HealthNotificationConfig {
  type: HealthNotificationType;
  label: string;
  icon: string;
  color: string;
  defaultEnabled: boolean;
}

export const HEALTH_NOTIFICATION_TYPES: HealthNotificationConfig[] = [
  {
    type: 'appointment_remind',
    label: '看診提醒',
    icon: 'calendar-outline',
    color: '#5856D6',
    defaultEnabled: true,
  },
  {
    type: 'vaccine_available',
    label: '疫苗通知',
    icon: 'medkit-outline',
    color: '#34C759',
    defaultEnabled: true,
  },
  {
    type: 'report_ready',
    label: '報告完成',
    icon: 'document-text-outline',
    color: '#34C759',
    defaultEnabled: true,
  },
  {
    type: 'mood_nudge',
    label: '情緒關懷',
    icon: 'heart-outline',
    color: '#AF52DE',
    defaultEnabled: true,
  },
  {
    type: 'seasonal_alert',
    label: '季節預警',
    icon: 'warning-outline',
    color: '#FF9500',
    defaultEnabled: true,
  },
  {
    type: 'exercise_remind',
    label: '運動提醒',
    icon: 'fitness-outline',
    color: '#EA580C',
    defaultEnabled: false,
  },
  {
    type: 'hydration',
    label: '喝水提醒',
    icon: 'water-outline',
    color: '#5AC8FA',
    defaultEnabled: false,
  },
  {
    type: 'counseling_remind',
    label: '諮商提醒',
    icon: 'chatbubble-outline',
    color: '#AF52DE',
    defaultEnabled: true,
  },
  {
    type: 'checkup_due',
    label: '健檢到期',
    icon: 'clipboard-outline',
    color: '#D70015',
    defaultEnabled: true,
  },
  {
    type: 'peer_reply',
    label: '互助圈回覆',
    icon: 'people-outline',
    color: '#FF2D55',
    defaultEnabled: true,
  },
  {
    type: 'prescription_refill',
    label: '處方到期',
    icon: 'medical-outline',
    color: '#FF3B30',
    defaultEnabled: true,
  },
  {
    type: 'aed_check',
    label: 'AED 巡檢',
    icon: 'pulse-outline',
    color: '#3C3C43',
    defaultEnabled: false,
  },
];

// ═══════════════════════════════════════════════════
// 模擬資料
// ═══════════════════════════════════════════════════

export function simulateHealthStats() {
  return {
    totalVisitsThisMonth: 156,
    avgWaitMinutes: 12,
    topDepartments: [
      { dept: 'general' as HealthDepartment, visits: 78 },
      { dept: 'mental' as HealthDepartment, visits: 32 },
      { dept: 'sports_injury' as HealthDepartment, visits: 21 },
      { dept: 'vaccination' as HealthDepartment, visits: 15 },
      { dept: 'eye' as HealthDepartment, visits: 10 },
    ],
    vaccinesCovered: 1247,
    counselingSessions: 89,
    satisfactionRate: 0.94,
    moodAvgCampus: 3.4,
    peakHours: ['10:00-11:00', '14:00-15:00'],
    aedChecksThisMonth: 8,
  };
}

export function simulateMyHealth(): {
  passport: Partial<HealthPassport>;
  recentVisits: { date: string; dept: HealthDepartment; doctor: string; note: string }[];
  moodEntries: MoodEntry[];
  upcomingAppointments: {
    id: string;
    dept: HealthDepartment;
    date: string;
    time: string;
    doctor: string;
  }[];
} {
  return {
    passport: {
      bloodType: 'A+',
      allergies: [{ type: 'drug', name: 'Penicillin 盤尼西林', severity: 'severe' }],
      chronicConditions: [],
      medications: [],
      emergencyContact: { name: '王媽媽', relation: '母親', phone: '0912-345-678' },
      vaccinations: [
        {
          id: 'v1',
          vaccine: 'COVID-19 (Moderna)',
          date: '2025-10-15',
          dose: 3,
          totalDoses: 3,
          location: '衛保組',
          certificate: 'TW-COVID-12345',
        },
        {
          id: 'v2',
          vaccine: '季節性流感',
          date: '2025-11-01',
          dose: 1,
          totalDoses: 1,
          location: '衛保組',
        },
      ],
      lastCheckup: '2025-09-05',
      bmi: 21.8,
      visionLeft: 0.8,
      visionRight: 0.9,
    },
    recentVisits: [
      { date: '2026-04-20', dept: 'general', doctor: '林醫師', note: '感冒，開立感冒藥 3 天份' },
      { date: '2026-03-10', dept: 'eye', doctor: '校護張姐', note: '視力檢查，建議配鏡' },
      { date: '2026-02-15', dept: 'mental', doctor: '陳諮商師', note: '第 3 次諮商' },
    ],
    moodEntries: [
      {
        id: 'm1',
        date: '2026-04-27',
        time: '09:00',
        level: 4,
        factors: ['academic'],
        isAnonymous: false,
      },
      {
        id: 'm2',
        date: '2026-04-26',
        time: '22:00',
        level: 3,
        factors: ['sleep', 'academic'],
        isAnonymous: false,
      },
      {
        id: 'm3',
        date: '2026-04-25',
        time: '21:30',
        level: 2,
        factors: ['academic', 'social'],
        note: '期中考壓力好大',
        isAnonymous: false,
      },
      {
        id: 'm4',
        date: '2026-04-24',
        time: '20:00',
        level: 3,
        factors: ['social'],
        isAnonymous: false,
      },
      {
        id: 'm5',
        date: '2026-04-23',
        time: '22:30',
        level: 4,
        factors: ['health'],
        note: '跑步完心情好多了',
        isAnonymous: false,
      },
      {
        id: 'm6',
        date: '2026-04-22',
        time: '21:00',
        level: 3,
        factors: ['academic', 'career'],
        isAnonymous: false,
      },
      {
        id: 'm7',
        date: '2026-04-21',
        time: '23:00',
        level: 2,
        factors: ['sleep'],
        note: '又失眠了',
        isAnonymous: false,
      },
    ],
    upcomingAppointments: [
      { id: 'apt-1', dept: 'mental', date: '2026-04-30', time: '14:00', doctor: '陳諮商師' },
    ],
  };
}

export function simulatePeerPosts(): PeerSupportPost[] {
  return [
    {
      id: 'pp-1',
      topic: 'academic_pressure',
      content: '期中考完以為可以喘口氣，結果三個報告同時截止...',
      isAnonymous: true,
      authorAlias: '圖書館的貓',
      createdAt: '2026-04-27T08:30:00',
      reactions: [
        { type: 'same', count: 23 },
        { type: 'hug', count: 8 },
        { type: 'cheer', count: 5 },
      ],
      replyCount: 7,
    },
    {
      id: 'pp-2',
      topic: 'sleep',
      content: '連續第五天凌晨三點還醒著，白天上課超痛苦',
      isAnonymous: true,
      authorAlias: '操場的雲',
      createdAt: '2026-04-26T03:15:00',
      reactions: [
        { type: 'same', count: 31 },
        { type: 'hug', count: 15 },
      ],
      replyCount: 12,
    },
    {
      id: 'pp-3',
      topic: 'exercise',
      content: '今天終於跑完操場五圈！從開學的兩圈到現在，進步好多',
      isAnonymous: false,
      authorAlias: '陽光跑者',
      createdAt: '2026-04-26T18:00:00',
      reactions: [
        { type: 'cheer', count: 42 },
        { type: 'same', count: 3 },
      ],
      replyCount: 9,
    },
    {
      id: 'pp-4',
      topic: 'loneliness',
      content: '轉學過來快一個月了，還是覺得交不到朋友...',
      isAnonymous: true,
      authorAlias: '至善樓的風',
      createdAt: '2026-04-25T21:30:00',
      reactions: [
        { type: 'hug', count: 28 },
        { type: 'same', count: 11 },
        { type: 'cheer', count: 6 },
      ],
      replyCount: 15,
    },
    {
      id: 'pp-5',
      topic: 'stress',
      content: '研究所推甄準備好焦慮，覺得自己什麼都不夠好',
      isAnonymous: true,
      authorAlias: '伯鐸樓的星',
      createdAt: '2026-04-25T16:00:00',
      reactions: [
        { type: 'same', count: 19 },
        { type: 'hug', count: 12 },
        { type: 'cheer', count: 8 },
      ],
      replyCount: 6,
    },
  ];
}
