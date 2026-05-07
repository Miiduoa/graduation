/**
 * Agent Toolkit — 本地 AI 助理的工具集
 * ═══════════════════════════════════════════════
 * 定義所有可用工具並連接到 APP 內部的真實資料來源。
 * 每個工具都是完全本地執行（除了 web_search 需要網路）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { registerTool, type AgentTool, type ToolResult } from './agentReasoningEngine';
import { getAnyCachedCourses, getAnyCachedGrades, getAnyCachedTCAttendance } from './puDataCache';

// ═══════════════════════════════════════════════════
// 1. campus_query — 校園資料查詢
// ═══════════════════════════════════════════════════

const campusQueryTool: AgentTool = {
  name: 'campus_query',
  description:
    '查詢校園資料：課表(courses)、成績(grades)、出席(attendance)、公告(announcements)、餐廳菜單(menu)',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: '查詢類型: courses|grades|attendance|announcements|menu',
      required: true,
    },
    { name: 'filter', type: 'string', description: '篩選條件（可選）', required: false },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const { type, filter } = params;

      switch (type) {
        case 'courses': {
          const cached = await getAnyCachedCourses();
          if (!cached?.courses?.length) {
            return { success: false, data: null, error: '目前沒有課表資料，請先登入 TronClass' };
          }
          let courses = cached.courses;
          if (filter) {
            const f = filter.toLowerCase();
            courses = courses.filter(
              (c: any) =>
                (c.name ?? '').toLowerCase().includes(f) ||
                (c.teacher ?? '').toLowerCase().includes(f) ||
                (c.code ?? '').toLowerCase().includes(f),
            );
          }
          return {
            success: true,
            data: {
              total: courses.length,
              courses: courses.slice(0, 10).map((c: any) => ({
                name: c.name,
                teacher: c.teacher,
                time: c.time ?? c.schedule,
                location: c.location ?? c.room,
                code: c.code,
              })),
            },
          };
        }

        case 'grades': {
          const cached = await getAnyCachedGrades();
          if (!cached?.grades?.length) {
            return { success: false, data: null, error: '目前沒有成績資料' };
          }
          return {
            success: true,
            data: {
              total: cached.grades.length,
              grades: cached.grades.slice(0, 15).map((g: any) => ({
                course: g.courseName ?? g.name,
                score: g.score,
                credits: g.credits,
                semester: g.semester,
              })),
            },
          };
        }

        case 'attendance': {
          const cached = await getAnyCachedTCAttendance();
          if (!cached?.length) {
            return { success: false, data: null, error: '目前沒有出席紀錄' };
          }
          return {
            success: true,
            data: {
              total: cached.length,
              summary: {
                present: cached.filter((r: any) => r.status === 'present' || r.status === '出席')
                  .length,
                absent: cached.filter((r: any) => r.status === 'absent' || r.status === '缺席')
                  .length,
                late: cached.filter((r: any) => r.status === 'late' || r.status === '遲到').length,
              },
              recent: cached.slice(-5).map((r: any) => ({
                course: r.courseName ?? r.course,
                date: r.date,
                status: r.status,
              })),
            },
          };
        }

        case 'announcements': {
          const raw = await AsyncStorage.getItem('@pu_cache:announcements');
          const announcements = raw ? JSON.parse(raw) : [];
          if (!announcements.length) {
            return { success: false, data: null, error: '目前沒有公告資料' };
          }
          return {
            success: true,
            data: {
              total: announcements.length,
              recent: announcements.slice(0, 5).map((a: any) => ({
                title: a.title,
                date: a.date ?? a.publishDate,
                source: a.source ?? '學校',
              })),
            },
          };
        }

        case 'menu': {
          const raw = await AsyncStorage.getItem('@pu_cache:menus');
          const menus = raw ? JSON.parse(raw) : [];
          if (!menus.length) {
            return { success: false, data: null, error: '目前沒有餐廳菜單資料' };
          }
          return {
            success: true,
            data: {
              restaurants: menus.slice(0, 5).map((m: any) => ({
                name: m.name ?? m.restaurant,
                items: (m.items ?? m.menu ?? []).slice(0, 5),
              })),
            },
          };
        }

        default:
          return { success: false, data: null, error: `不支援的查詢類型: ${type}` };
      }
    } catch (e: any) {
      return { success: false, data: null, error: e.message };
    }
  },
};

// ═══════════════════════════════════════════════════
// 2. web_search — 網路搜尋
// ═══════════════════════════════════════════════════

const webSearchTool: AgentTool = {
  name: 'web_search',
  description: '搜尋網路資訊（新聞、天氣、知識、任何網路上的內容）',
  parameters: [
    { name: 'query', type: 'string', description: '搜尋關鍵字', required: true },
    {
      name: 'type',
      type: 'string',
      description: '搜尋類型: general|news|weather',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    const { query, type = 'general' } = params;

    // 檢查網路連線
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      return { success: false, data: null, error: '無網路連線，無法搜尋' };
    }

    try {
      // 使用 DuckDuckGo Instant Answer API（免費，不需 API key）
      if (type === 'weather') {
        return await searchWeather(query);
      }

      // DuckDuckGo HTML search (no API key needed)
      const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=tw-tzh`;
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
          Accept: 'text/html',
        },
      });

      if (!response.ok) {
        // Fallback: DuckDuckGo Instant Answer API
        return await duckDuckGoInstant(query);
      }

      const html = await response.text();
      const results = parseDDGResults(html);

      if (results.length === 0) {
        return await duckDuckGoInstant(query);
      }

      return {
        success: true,
        data: {
          query,
          results: results.slice(0, 5),
          source: 'DuckDuckGo',
        },
      };
    } catch (e: any) {
      // 最後備用：嘗試 DuckDuckGo Instant Answer
      try {
        return await duckDuckGoInstant(query);
      } catch {
        return { success: false, data: null, error: `搜尋失敗: ${e.message}` };
      }
    }
  },
};

/**
 * DuckDuckGo Instant Answer API (免費、不需 key)
 */
async function duckDuckGoInstant(query: string): Promise<ToolResult> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const resp = await fetch(url);
  const data = await resp.json();

  if (data.AbstractText || data.Answer) {
    return {
      success: true,
      data: {
        query,
        answer: data.AbstractText || data.Answer,
        source: data.AbstractSource || 'DuckDuckGo',
        url: data.AbstractURL,
        relatedTopics: (data.RelatedTopics ?? [])
          .slice(0, 3)
          .map((t: any) => t.Text?.slice(0, 100)),
      },
    };
  }

  // 至少回傳相關主題
  if (data.RelatedTopics?.length > 0) {
    return {
      success: true,
      data: {
        query,
        results: data.RelatedTopics.slice(0, 5).map((t: any) => ({
          title: t.Text?.slice(0, 80) ?? '',
          url: t.FirstURL ?? '',
        })),
        source: 'DuckDuckGo',
      },
    };
  }

  return { success: false, data: null, error: '找不到相關結果' };
}

/**
 * 天氣查詢（使用 wttr.in — 免費、不需 key）
 */
async function searchWeather(query: string): Promise<ToolResult> {
  // 預設查詢靜宜大學所在地（台中沙鹿）
  const location = query.replace(/天氣|氣溫|溫度|weather/gi, '').trim() || '沙鹿';
  const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=zh-tw`;

  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'curl/7.0' } });
    const data = await resp.json();

    if (data.current_condition?.[0]) {
      const current = data.current_condition[0];
      const forecast = data.weather?.slice(0, 3) ?? [];

      return {
        success: true,
        data: {
          location,
          current: {
            temp: `${current.temp_C}°C`,
            feelsLike: `${current.FeelsLikeC}°C`,
            description: current.lang_zh?.[0]?.value ?? current.weatherDesc?.[0]?.value ?? '',
            humidity: `${current.humidity}%`,
            wind: `${current.windspeedKmph} km/h`,
          },
          forecast: forecast.map((day: any) => ({
            date: day.date,
            maxTemp: `${day.maxtempC}°C`,
            minTemp: `${day.mintempC}°C`,
            description: day.hourly?.[4]?.lang_zh?.[0]?.value ?? '',
          })),
        },
      };
    }

    return { success: false, data: null, error: '無法取得天氣資料' };
  } catch (e: any) {
    return { success: false, data: null, error: `天氣查詢失敗: ${e.message}` };
  }
}

/**
 * 解析 DuckDuckGo HTML 搜尋結果
 */
function parseDDGResults(html: string): { title: string; snippet: string; url: string }[] {
  const results: { title: string; snippet: string; url: string }[] = [];

  // 簡單 regex 解析（避免引入 HTML parser 依賴）
  const resultBlocks =
    html.match(
      /<a[^>]*class="result__a"[^>]*>[\s\S]*?<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>[\s\S]*?<\/a>/g,
    ) ?? [];

  for (const block of resultBlocks.slice(0, 8)) {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const urlMatch = block.match(/href="([^"]+)"/);

    if (titleMatch) {
      results.push({
        title: stripHtml(titleMatch[1]).trim(),
        snippet: snippetMatch ? stripHtml(snippetMatch[1]).trim() : '',
        url: urlMatch?.[1] ?? '',
      });
    }
  }

  return results;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

// ═══════════════════════════════════════════════════
// 3. calculate — 計算工具
// ═══════════════════════════════════════════════════

const calculateTool: AgentTool = {
  name: 'calculate',
  description: '數學計算和資料分析（加減乘除、平均、GPA計算、統計等）',
  parameters: [
    { name: 'expression', type: 'string', description: '計算表達式或描述', required: true },
    {
      name: 'type',
      type: 'string',
      description: '計算類型: math|gpa|average|stats',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    const { expression, type = 'math' } = params;

    try {
      if (type === 'gpa') {
        return await calculateGPA();
      }

      // 安全的數學計算（不用 eval）
      const result = safeMathEval(expression);
      if (result !== null) {
        return {
          success: true,
          data: { expression, result, type: 'number' },
        };
      }

      // 嘗試解析為統計問題
      const numbers = expression.match(/[\d.]+/g)?.map(Number) ?? [];
      if (numbers.length > 1) {
        const sum = numbers.reduce((a, b) => a + b, 0);
        const avg = sum / numbers.length;
        const max = Math.max(...numbers);
        const min = Math.min(...numbers);
        return {
          success: true,
          data: {
            numbers,
            sum: Math.round(sum * 100) / 100,
            average: Math.round(avg * 100) / 100,
            max,
            min,
            count: numbers.length,
          },
        };
      }

      return { success: false, data: null, error: '無法解析計算表達式' };
    } catch (e: any) {
      return { success: false, data: null, error: e.message };
    }
  },
};

/**
 * 安全的數學計算（不使用 eval）
 */
function safeMathEval(expr: string): number | null {
  // 移除空格
  const cleaned = expr.replace(/\s+/g, '').replace(/[×x]/g, '*').replace(/÷/g, '/');

  // 只允許數字和基本運算符
  if (!/^[\d+\-*/().%^]+$/.test(cleaned)) return null;

  try {
    // 用 Function 建構器（比 eval 稍安全）
    const fn = new Function(`"use strict"; return (${cleaned})`);
    const result = fn();
    if (typeof result === 'number' && isFinite(result)) return result;
    return null;
  } catch {
    return null;
  }
}

/**
 * 計算 GPA
 */
async function calculateGPA(): Promise<ToolResult> {
  const cached = await getAnyCachedGrades();
  if (!cached?.grades?.length) {
    return { success: false, data: null, error: '沒有成績資料，無法計算 GPA' };
  }

  let totalCredits = 0;
  let weightedSum = 0;

  for (const grade of cached.grades) {
    const score = grade.score ?? 0;
    const credit = grade.credits ?? 3;
    const gp = scoreToGradePoint(Number(score));
    weightedSum += gp * credit;
    totalCredits += credit;
  }

  const gpa = totalCredits > 0 ? weightedSum / totalCredits : 0;

  return {
    success: true,
    data: {
      gpa: Math.round(gpa * 100) / 100,
      totalCredits,
      totalCourses: cached.grades.length,
      scale: '4.0',
    },
  };
}

function scoreToGradePoint(score: number): number {
  if (score >= 90) return 4.0;
  if (score >= 85) return 3.7;
  if (score >= 80) return 3.3;
  if (score >= 77) return 3.0;
  if (score >= 73) return 2.7;
  if (score >= 70) return 2.3;
  if (score >= 67) return 2.0;
  if (score >= 63) return 1.7;
  if (score >= 60) return 1.0;
  return 0.0;
}

// ═══════════════════════════════════════════════════
// 4. schedule_manage — 行事曆管理
// ═══════════════════════════════════════════════════

const scheduleManageTool: AgentTool = {
  name: 'schedule_manage',
  description: '查看行事曆事件、新增提醒、查詢截止日期',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: '操作: query|today|upcoming|add',
      required: true,
    },
    { name: 'query', type: 'string', description: '查詢關鍵字或事件描述', required: false },
    { name: 'date', type: 'string', description: '日期 (YYYY-MM-DD)', required: false },
  ],
  execute: async (params): Promise<ToolResult> => {
    const { action, query, date } = params;

    try {
      switch (action) {
        case 'today':
        case 'query':
        case 'upcoming': {
          // 從本地快取讀取行事曆事件
          const eventsRaw = await AsyncStorage.getItem('@smart_cal:events');
          const deadlinesRaw = await AsyncStorage.getItem('@smart_cal:deadlines');
          const events = eventsRaw ? JSON.parse(eventsRaw) : [];
          const deadlines = deadlinesRaw ? JSON.parse(deadlinesRaw) : [];

          const now = Date.now();
          const dayMs = 24 * 60 * 60 * 1000;

          let filtered = [
            ...events,
            ...deadlines.map((d: any) => ({
              title: d.title,
              date: d.dueDate ?? d.date,
              type: 'deadline',
              course: d.courseName,
            })),
          ];

          if (action === 'today') {
            const todayStart = new Date().setHours(0, 0, 0, 0);
            const todayEnd = todayStart + dayMs;
            filtered = filtered.filter((e: any) => {
              const t = new Date(e.date ?? e.startDate).getTime();
              return t >= todayStart && t < todayEnd;
            });
          } else if (action === 'upcoming') {
            filtered = filtered.filter((e: any) => {
              const t = new Date(e.date ?? e.startDate).getTime();
              return t >= now && t <= now + 7 * dayMs;
            });
          }

          if (query) {
            const q = query.toLowerCase();
            filtered = filtered.filter(
              (e: any) =>
                (e.title ?? '').toLowerCase().includes(q) ||
                (e.course ?? '').toLowerCase().includes(q),
            );
          }

          return {
            success: true,
            data: {
              count: filtered.length,
              events: filtered.slice(0, 10).map((e: any) => ({
                title: e.title,
                date: e.date ?? e.startDate,
                type: e.type ?? 'event',
                course: e.course ?? e.courseName,
              })),
            },
          };
        }

        case 'add': {
          // 新增事件到本地快取
          if (!query) {
            return { success: false, data: null, error: '請提供事件描述' };
          }
          const eventsRaw2 = await AsyncStorage.getItem('@smart_cal:events');
          const events2 = eventsRaw2 ? JSON.parse(eventsRaw2) : [];
          const newEvent = {
            id: `manual_${Date.now()}`,
            title: query,
            date: date ?? new Date().toISOString(),
            type: 'manual',
            createdAt: Date.now(),
          };
          events2.push(newEvent);
          await AsyncStorage.setItem('@smart_cal:events', JSON.stringify(events2));
          return { success: true, data: { added: newEvent } };
        }

        default:
          return { success: false, data: null, error: `不支援的操作: ${action}` };
      }
    } catch (e: any) {
      return { success: false, data: null, error: e.message };
    }
  },
};

// ═══════════════════════════════════════════════════
// 5. knowledge_base — 校園知識庫
// ═══════════════════════════════════════════════════

/** 靜宜大學校園知識庫 */
const CAMPUS_KNOWLEDGE: Record<string, string> = {
  // 地點
  圖書館:
    '蓋夏圖書館位於校園中心，開放時間：週一至週五 8:00-21:30，週六 9:00-17:00，週日休館。自習區24小時開放（需刷學生證）。',
  保健室:
    '保健室位於至善樓 1F，開放時間：週一至週五 8:00-17:00。提供免費基本醫療、健康諮詢。急診請撥校安中心 04-26328001。',
  餐廳: '校內有：文興樓學生餐廳、思源樓美食街、伯鐸樓自助餐。營業時間約 7:00-19:00。',
  宿舍: '學生宿舍包含：靜園（女生）、宜園（女生）、大學城（男女生）。門禁時間 23:00-06:00。',
  停車場: '教職員停車場在校門口左側，學生機車停車場在操場旁。汽車需申請停車證。',
  體育館: '體育館位於操場旁，開放時間：週一至週五 8:00-21:00。設有籃球場、排球場、羽球場、健身房。',
  電腦教室: '資訊大樓 3F-5F 設有多間電腦教室，課餘時間開放自由使用。需刷學生證入場。',

  // 行政
  請假: '請假方式：登入 E校園 → 學務處 → 請假系統。病假需附醫療證明。事假需事前申請。缺曠達1/3將被扣考。',
  選課: '選課方式：登入 TronClass → 選課系統。初選在開學前2週，加退選在開學第1-2週。',
  退選: '退選截止日為學期第9週。退選後該科成績顯示W，不計入GPA。',
  獎學金:
    '校內獎學金包含：學業優秀獎學金（前5%）、清寒獎助學金、各系所獎學金。請上學務處網站查詢。',
  畢業門檻:
    '畢業需：(1)修滿128學分 (2)英語能力認證 (3)服務學習時數 (4)資訊能力認證。詳見各系畢業門檻。',
  輔導諮商: '學生輔導中心位於至善樓 2F，提供免費心理諮商。預約方式：04-26328001 分機 11100。',
  工讀: '校內工讀機會可上學務處網站「工讀媒合系統」查詢。時薪依勞基法規定。',

  // 交通
  公車: '校門口有台中市公車站牌。主要路線：300路(高鐵台中站-靜宜大學)、301路、305路。學生持悠遊卡免費搭乘。',
  校車: '校車路線：台中火車站-靜宜大學，發車時間請見學務處公告。',

  // 其他
  列印: '全校列印站設於圖書館 1F、資訊大樓 1F。使用學生證儲值後即可使用。A4黑白1元/張。',
  失物: '失物招領處在學務處生活輔導組（至善樓 1F）。也可上E校園失物招領公告查詢。',
  校安中心: '24小時校安專線：04-26328001。緊急事件（火災、地震、意外）請立即撥打。',
};

const knowledgeBaseTool: AgentTool = {
  name: 'knowledge_base',
  description: '查詢靜宜大學校園知識庫（位置、開放時間、規定、電話、常見問題）',
  parameters: [{ name: 'query', type: 'string', description: '查詢內容', required: true }],
  execute: async (params): Promise<ToolResult> => {
    const { query } = params;
    const q = query.toLowerCase();

    // 搜尋匹配的知識條目
    const matches: { key: string; content: string; score: number }[] = [];

    for (const [key, content] of Object.entries(CAMPUS_KNOWLEDGE)) {
      let score = 0;
      if (q.includes(key)) score += 10;
      // 關鍵字匹配
      const words = q.split(/[\s，。？！]+/).filter((w) => w.length > 1);
      for (const word of words) {
        if (key.includes(word)) score += 5;
        if (content.includes(word)) score += 2;
      }
      if (score > 0) matches.push({ key, content, score });
    }

    matches.sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      return {
        success: false,
        data: null,
        error: '校園知識庫中找不到相關資訊',
      };
    }

    return {
      success: true,
      data: {
        query,
        results: matches.slice(0, 3).map((m) => ({
          topic: m.key,
          content: m.content,
          relevance: m.score,
        })),
      },
    };
  },
};

// ═══════════════════════════════════════════════════
// 6. task_execute — 任務執行
// ═══════════════════════════════════════════════════

const taskExecuteTool: AgentTool = {
  name: 'task_execute',
  description:
    '執行特定任務：設提醒(reminder)、查公車(bus)、查圖書館(library)、查天氣(weather)、設定番茄鐘(pomodoro)',
  parameters: [
    {
      name: 'task',
      type: 'string',
      description: '任務類型: reminder|bus|library|pomodoro',
      required: true,
    },
    { name: 'params', type: 'object', description: '任務參數', required: false },
  ],
  execute: async (params): Promise<ToolResult> => {
    const { task, params: taskParams = {} } = params;

    try {
      switch (task) {
        case 'reminder': {
          const title = taskParams.title ?? taskParams.text ?? '提醒';
          const time = taskParams.time ?? new Date(Date.now() + 3600000).toISOString();

          // 儲存到本地提醒列表
          const raw = await AsyncStorage.getItem('@agent:reminders');
          const reminders = raw ? JSON.parse(raw) : [];
          const newReminder = { id: `rem_${Date.now()}`, title, time, created: Date.now() };
          reminders.push(newReminder);
          await AsyncStorage.setItem('@agent:reminders', JSON.stringify(reminders));

          return {
            success: true,
            data: { reminder: newReminder, message: `已設定提醒：${title}` },
          };
        }

        case 'bus': {
          // 靜宜大學公車時刻（靜態知識）
          return {
            success: true,
            data: {
              station: '靜宜大學',
              routes: [
                { number: '300', destination: '高鐵台中站', frequency: '每15-20分鐘' },
                { number: '301', destination: '新民高中', frequency: '每20-30分鐘' },
                { number: '305', destination: '大甲', frequency: '每30分鐘' },
                { number: '306', destination: '清水', frequency: '每30分鐘' },
              ],
              note: '台中市區公車學生持悠遊卡免費搭乘（10公里內）',
            },
          };
        }

        case 'library': {
          return {
            success: true,
            data: {
              name: '蓋夏圖書館',
              hours: {
                weekday: '08:00-21:30',
                saturday: '09:00-17:00',
                sunday: '休館',
                selfStudy: '24小時（需刷學生證）',
              },
              services: ['借書', '還書', '預約討論室', '影印列印', '自習座位', '電子資源'],
              contact: '04-26328001 分機 11300',
            },
          };
        }

        case 'pomodoro': {
          const minutes = taskParams.minutes ?? 25;
          const pomodoroData = {
            id: `pomo_${Date.now()}`,
            duration: minutes,
            startedAt: Date.now(),
            endsAt: Date.now() + minutes * 60 * 1000,
            subject: taskParams.subject ?? '學習',
          };

          // 儲存番茄鐘記錄
          const raw2 = await AsyncStorage.getItem('@smart_cal:pomodoro');
          const sessions = raw2 ? JSON.parse(raw2) : [];
          sessions.push(pomodoroData);
          await AsyncStorage.setItem('@smart_cal:pomodoro', JSON.stringify(sessions));

          return {
            success: true,
            data: {
              pomodoro: pomodoroData,
              message: `已開始 ${minutes} 分鐘番茄鐘：${pomodoroData.subject}`,
            },
          };
        }

        default:
          return { success: false, data: null, error: `不支援的任務: ${task}` };
      }
    } catch (e: any) {
      return { success: false, data: null, error: e.message };
    }
  },
};

// ═══════════════════════════════════════════════════
// 7. datetime — 日期時間工具
// ═══════════════════════════════════════════════════

const datetimeTool: AgentTool = {
  name: 'datetime',
  description: '取得當前日期時間、計算日期差異、判斷星期幾',
  parameters: [
    { name: 'action', type: 'string', description: '操作: now|diff|weekday', required: true },
    { name: 'date', type: 'string', description: '目標日期', required: false },
  ],
  execute: async (params): Promise<ToolResult> => {
    const { action, date } = params;
    const now = new Date();

    switch (action) {
      case 'now':
        return {
          success: true,
          data: {
            date: now.toLocaleDateString('zh-TW'),
            time: now.toLocaleTimeString('zh-TW'),
            weekday: ['日', '一', '二', '三', '四', '五', '六'][now.getDay()],
            timestamp: now.getTime(),
            iso: now.toISOString(),
          },
        };

      case 'diff': {
        if (!date) return { success: false, data: null, error: '需要提供日期' };
        const target = new Date(date);
        const diffMs = target.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return {
          success: true,
          data: {
            from: now.toLocaleDateString('zh-TW'),
            to: target.toLocaleDateString('zh-TW'),
            diffDays,
            description: diffDays > 0 ? `還有 ${diffDays} 天` : `已經過了 ${Math.abs(diffDays)} 天`,
          },
        };
      }

      case 'weekday': {
        const target2 = date ? new Date(date) : now;
        return {
          success: true,
          data: {
            date: target2.toLocaleDateString('zh-TW'),
            weekday: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][
              target2.getDay()
            ],
          },
        };
      }

      default:
        return { success: false, data: null, error: `不支援的操作: ${action}` };
    }
  },
};

// ═══════════════════════════════════════════════════
// Registration — 註冊所有工具
// ═══════════════════════════════════════════════════

export function registerAllTools(): void {
  registerTool(campusQueryTool);
  registerTool(webSearchTool);
  registerTool(calculateTool);
  registerTool(scheduleManageTool);
  registerTool(knowledgeBaseTool);
  registerTool(taskExecuteTool);
  registerTool(datetimeTool);
}

// 自動註冊
registerAllTools();

export {
  campusQueryTool,
  webSearchTool,
  calculateTool,
  scheduleManageTool,
  knowledgeBaseTool,
  taskExecuteTool,
  datetimeTool,
};
