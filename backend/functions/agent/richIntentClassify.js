'use strict';

/**
 * 與 apps/mobile/src/services/ai.ts 的 INTENT_PATTERNS + classifyIntent 計分邏輯對齊：
 * pattern 命中 +3（每類別最多一次）、keyword 累計 min(hits*1.5, 4)、subIntentMap 命中 +0.5（每類別最多一次）。
 * 理論最大 rawScore = 3 + 4 + 0.5 = 7.5
 */
const MAX_RICH_RAW_SCORE = 7.5;

const INTENT_PATTERNS = [
  {
    category: 'food',
    patterns: [
      /什麼.*吃/,
      /吃.*什麼/,
      /有.*好吃/,
      /推薦.*[餐飯麵]/,
      /[餐飯麵].*推薦/,
      /想吃/,
      /肚子餓/,
      /好餓/,
      /覓食/,
    ],
    keywords: [
      '吃',
      '餐',
      '飯',
      '麵',
      '湯',
      '菜',
      '蔬菜',
      '肉',
      '素食',
      '便當',
      '小吃',
      '甜點',
      '飲料',
      '外送',
      '午餐',
      '晚餐',
      '早餐',
      '宵夜',
      '點心',
      '食物',
      '餐廳',
      '餐點',
      '菜單',
      '美食',
      '推薦',
      '便宜',
      '健康餐',
      '低卡',
      '咖啡',
      '奶茶',
      '雞排',
      '滷肉',
      '排骨',
      '牛肉',
      '豬',
      '海鮮',
      '火鍋',
      '定食',
      '套餐',
      '加蛋',
      '加大',
      '辣',
      '不辣',
      '清淡',
      '重口味',
      '炸',
      '烤',
      '涼麵',
      '沙拉',
      '有哪些',
      '其他選擇',
      '還有其他',
      '別的',
      '換一個',
      '多一點',
      '少一點',
      '價格',
      '多少錢',
      '預算',
      '划算',
      'CP值',
      '平價',
      '省錢',
      '訂餐',
      '點餐',
      '下單',
      '外帶',
      '內用',
      '排隊',
      '等多久',
    ],
    subIntentMap: {
      recommend: ['推薦', '建議', '有哪些', '什麼好', '吃什麼', '想吃'],
      order: ['訂', '點餐', '下單', '幫我訂', '幫我點', '我要點', '點一份', '來一份', '外帶', '我要'],
      wait: ['排隊', '等多久', '人多', '等候'],
      budget: ['便宜', '預算', '多少錢', '價格', '划算', 'CP'],
      dietary: ['素食', '蔬菜', '健康', '低卡', '清淡', '不辣', '過敏'],
    },
  },
  {
    category: 'health',
    patterns: [/不舒服/, /頭.*痛/, /肚子.*痛/, /身體.*不/, /想.*看醫/, /需要.*看診/],
    keywords: [
      '不舒服',
      '頭痛',
      '肚子痛',
      '發燒',
      '感冒',
      '咳嗽',
      '流鼻水',
      '喉嚨痛',
      '拉肚子',
      '過敏',
      '頭暈',
      '噁心',
      '想吐',
      '受傷',
      '扭到',
      '痛',
      '看醫生',
      '掛號',
      '門診',
      '看診',
      '衛保',
      '諮商',
      '心理',
      '牙齒',
      '牙痛',
      '生病',
      '藥',
      '急救',
      'AED',
      '緊急',
    ],
  },
  {
    category: 'course',
    patterns: [
      /還有.*多久.*畢業/,
      /畢業.*還.*多久/,
      /差.*多少.*學分/,
      /什麼時候.*畢業/,
      /能不能.*畢業/,
      /成績.*怎/,
      /怎.*成績/,
      /gpa.*多少/,
      /修.*多少.*學分/,
      /[幾什].*門課/,
      /有.*什麼課/,
      /有課嗎/,
      /星期.*有課/,
      /週.*有課/,
      /禮拜.*有課/,
    ],
    keywords: [
      '畢業',
      '學分',
      '成績',
      '分數',
      'gpa',
      '排名',
      '選課',
      '退選',
      '加選',
      '必修',
      '選修',
      '通識',
      '學程',
      '輔系',
      '雙主修',
      '延畢',
      '本學期',
      '哪些課',
      '幾門課',
      '課表',
      '上什麼課',
      '今天有課',
      '明天有課',
      '幾點上課',
      '教室',
      '考試',
      '期中',
      '期末',
      '報告',
      '小考',
      'quiz',
      '老師',
      '教授',
      '助教',
      '修課',
      '擋修',
      '有課',
      '作業',
      '待繳',
      '截止',
      '繳交',
      '期限',
      '幾分',
    ],
  },
  {
    category: 'leave_status',
    patterns: [
      /請假.*(審核|狀態|通過|駁回|好了)/,
      /(審核|核准|駁回|退件).*請假/,
      /老師.*(審核|核准|通過|駁回)/,
      /請假.*(通過|駁回)了嗎/,
    ],
    keywords: ['審核', '核准', '通過', '駁回', '退件', '待審', '請假狀態'],
  },
  {
    category: 'leave',
    patterns: [/想.*請假/, /幫.*請假/, /幫.*請.*假/, /請.*假/, /怎.*請假/, /可以.*請假/],
    keywords: [
      '請假',
      '請病假',
      '病假',
      '事假',
      '公假',
      '喪假',
      '翹課',
      '缺課',
      '曠課',
      '補假',
      '請明天的假',
      '請今天的假',
    ],
  },
  {
    category: 'location',
    patterns: [/在哪/, /怎麼走/, /怎麼去/, /哪裡有/, /.*位置/, /.*地址/],
    keywords: [
      '在哪',
      '怎麼走',
      '怎麼去',
      '地點',
      '導航',
      '地圖',
      '位置',
      '路線',
      '圖書館',
      '行政大樓',
      '體育館',
      '教室',
      '實驗室',
      '停車場',
      '校門',
      '操場',
    ],
  },
  {
    category: 'event',
    patterns: [/有.*活動/, /什麼.*活動/, /可以.*報名/, /想.*參加/],
    keywords: ['活動', '報名', '參加', '社團', '演講', '工作坊', '比賽', '展覽', '營隊'],
  },
  {
    category: 'announcement',
    patterns: [/有.*公告/, /什麼.*消息/, /最新.*通知/],
    keywords: ['公告', '消息', '通知', '最新', '學校公告', '系公告', '重要公告'],
  },
  {
    category: 'library',
    patterns: [/想.*借書/, /怎.*借書/, /有.*書/, /找.*書/, /預約.*座位/, /座位.*預約/, /自習室/],
    keywords: [
      '借書',
      '還書',
      '圖書',
      '書籍',
      '館藏',
      '預約座位',
      '自習',
      '討論室',
      '閱覽室',
      '開館',
      '閉館',
    ],
  },
  {
    category: 'dorm',
    patterns: [/宿舍.*壞/, /.*壞了/, /怎麼.*報修/, /有.*包裹/],
    keywords: [
      '宿舍',
      '報修',
      '壞了',
      '故障',
      '維修',
      '漏水',
      '冷氣',
      '熱水器',
      '洗衣機',
      '烘衣機',
      '洗衣',
      '包裹',
      '快遞',
      '門禁',
      '室友',
      '退宿',
      '住宿',
    ],
  },
  {
    category: 'transport',
    patterns: [/怎麼.*[去到].*[站市]/, /公車.*幾點/, /有.*公車/],
    keywords: [
      '公車',
      '搭車',
      '坐車',
      '交通',
      '火車站',
      '高鐵',
      '客運',
      'Uber',
      '計程車',
      '停車',
      '腳踏車',
      'YouBike',
      '幾號公車',
    ],
  },
  {
    category: 'print',
    patterns: [/怎.*列印/, /哪.*列印/, /印.*[報作文]/, /列印.*餘額/],
    keywords: ['列印', '影印', '印表機', '影印卡', '列印餘額', '掃描'],
  },
  {
    category: 'lost_found',
    patterns: [/遺失.*[了]/, /掉了/, /不見了/, /撿到/, /找不到.*我的/],
    keywords: ['遺失', '掉了', '不見了', '弄丟', '丟了', '撿到', '拾獲', '失物'],
  },
  {
    category: 'schedule',
    patterns: [/提醒.*我/, /別忘.*了/, /幾點.*[要有]/],
    keywords: ['提醒', '鬧鐘', '行事曆', '排程', '日程', '時間表'],
  },
  {
    category: 'mood',
    patterns: [/心情.*[不好差]/, /壓力.*大/, /好.*[煩累]/, /覺得.*[焦憂鬱]/],
    keywords: [
      '心情',
      '情緒',
      '壓力',
      '焦慮',
      '緊張',
      '憂鬱',
      '煩',
      '累',
      '低落',
      '難過',
      '開心',
      '快樂',
    ],
  },
  {
    category: 'weather',
    patterns: [/會.*下雨/, /要.*帶傘/, /天氣.*怎/, /氣溫.*多少/],
    keywords: ['天氣', '下雨', '氣溫', '帶傘', '防曬', '紫外線'],
  },
  {
    category: 'greeting',
    patterns: [/^(嗨|你好|哈囉|hi|hello|hey|早安|午安|晚安|安安|嘿)[\s！!？?。,.]*$/i],
    keywords: [],
  },
  {
    category: 'thanks',
    patterns: [/謝謝|感謝|感恩|3q|thx|thanks|好的謝|太好了/i],
    keywords: [],
  },
  {
    category: 'help',
    patterns: [/你.*[能會可].*什麼/, /有.*功能/, /怎麼用/, /你.*做.*什麼/],
    keywords: ['功能', '怎麼用', '說明', '幫助', 'help', '你能做', '你會什麼'],
  },
];

/**
 * @param {string} message
 * @returns {{ category: string, subIntent?: string, rawScore: number }}
 */
function classifyRichIntent(message) {
  const msg = String(message ?? '')
    .toLowerCase()
    .trim();
  let bestMatch = { category: 'general', rawScore: 0, subIntent: undefined };

  for (const intent of INTENT_PATTERNS) {
    let score = 0;

    for (const pattern of intent.patterns) {
      if (pattern.test(msg)) {
        score += 3;
        break;
      }
    }

    let kwHits = 0;
    for (const kw of intent.keywords) {
      if (msg.includes(kw)) kwHits++;
    }
    score += Math.min(kwHits * 1.5, 4);

    if (intent.subIntentMap) {
      for (const [, subKws] of Object.entries(intent.subIntentMap)) {
        if (subKws.some((k) => msg.includes(k))) {
          score += 0.5;
          break;
        }
      }
    }

    if (score > bestMatch.rawScore) {
      let subIntent;
      if (intent.subIntentMap) {
        for (const [sub, subKws] of Object.entries(intent.subIntentMap)) {
          if (subKws.some((k) => msg.includes(k))) {
            subIntent = sub;
            break;
          }
        }
      }
      bestMatch = { category: intent.category, rawScore: score, subIntent };
    }
  }

  return bestMatch;
}

/**
 * 將與 ai.ts 相同的 raw 分數線性壓到 [0,1]（飽和於理論上限）。
 * @param {number} rawScore
 */
function richRawScoreToConfidence01(rawScore) {
  if (rawScore <= 0) return 0;
  return Math.min(1, rawScore / MAX_RICH_RAW_SCORE);
}

module.exports = {
  INTENT_PATTERNS,
  MAX_RICH_RAW_SCORE,
  classifyRichIntent,
  richRawScoreToConfidence01,
};
