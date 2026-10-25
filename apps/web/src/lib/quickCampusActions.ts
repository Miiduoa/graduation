import { CAMPUS_SERVICES } from './campusServices';

export type QuickCampusAction = Pick<
  (typeof CAMPUS_SERVICES)[number],
  'name' | 'text' | 'href' | 'access'
>;

// Only routes to existing services. Spoken requests never execute writes.
export function getQuickCampusActions(input: string): QuickCampusAction[] {
  const phrase = input.slice(0, 160).normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, '');
  if (!phrase) return [];

  const destinations: string[] = [];
  const add = (condition: boolean, href: string) => {
    if (condition && !destinations.includes(href)) destinations.push(href);
  };
  const locationQuestion = /在哪|位置|怎麼走|如何走|帶我去|走去|導航|找教室|地圖/.test(phrase);
  const busQuestion = /公車|巴士|站牌|到站|搭車|幾號車/.test(phrase);

  add(locationQuestion && !busQuestion, '/map');
  add(busQuestion, '/bus');
  add(/交作業|繳作業|繳交作業|交報告|繳報告|作業|測驗|教材|上傳作業/.test(phrase), '/classroom');
  add(/課表|上什麼課|哪堂課|下堂課|空堂|排課|下一節課/.test(phrase), '/timetable');
  add(/借書|續借|館藏|找書|圖書館/.test(phrase) && !locationQuestion, '/library');
  add(/分數|成績|評分|學期成績/.test(phrase), '/grades');
  add(/學分|畢業門檻|畢業條件/.test(phrase), '/credit-planner');
  add(/午餐|晚餐|吃什麼|找吃的|餐廳|菜單|食堂/.test(phrase), '/cafeteria');
  add(/宿舍|寢室|住宿|洗衣|報修/.test(phrase), '/dormitory');
  add(/我的行程|行事曆|日曆|考試日期|新增活動|安排行程/.test(phrase), '/calendar');
  add(/講座|校園活動|活動報名|演講/.test(phrase), '/events');
  add(/公告|最新消息/.test(phrase), '/announcements');
  add(/通知|未讀訊息|私訊/.test(phrase), '/messages');
  add(/失物|遺失|拾獲|找不到.*東西/.test(phrase), '/lost-found');
  add(/加好友|找朋友|好友課表/.test(phrase), '/friends');

  return destinations
    .slice(0, 3)
    .flatMap((href) => {
      const service = CAMPUS_SERVICES.find((item) => item.href === href);
      return service
        ? [{ name: service.name, text: service.text, href: service.href, access: service.access }]
        : [];
    });
}

export const QUICK_CAMPUS_EXAMPLES = [
  '今天要上什麼課？',
  '我要交作業',
  '公車什麼時候來？',
  '圖書館怎麼走？',
] as const;
