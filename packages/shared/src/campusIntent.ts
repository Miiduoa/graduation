/**
 * Natural-language shortcuts shared by the Web and native app.
 * A match identifies an existing read/navigation screen, never an executable command.
 */
export const CAMPUS_QUICK_DESTINATIONS = [
  "/map",
  "/bus",
  "/classroom",
  "/timetable",
  "/library",
  "/grades",
  "/credit-planner",
  "/cafeteria",
  "/dormitory",
  "/calendar",
  "/events",
  "/announcements",
  "/messages",
  "/lost-found",
  "/friends"
] as const;

export type CampusQuickDestination = (typeof CAMPUS_QUICK_DESTINATIONS)[number];

export function suggestCampusDestinations(input: string): CampusQuickDestination[] {
  const phrase = input.slice(0, 160).normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/g, '');
  if (!phrase) return [];

  const result: CampusQuickDestination[] = [];
  function match(pattern: RegExp, destination: CampusQuickDestination) {
    if (pattern.test(phrase) && !result.includes(destination)) result.push(destination);
  }

  const locationQuestion = /在哪|位置|怎麼走|如何走|帶我去|走去|導航|找教室|地圖/.test(phrase);
  const busQuestion = /公車|巴士|站牌|到站|搭車|幾號車/.test(phrase);

  if (locationQuestion && !busQuestion) result.push('/map');
  match(/公車|巴士|站牌|到站|搭車|幾號車/, '/bus');
  match(/交作業|繳作業|繳交作業|交報告|繳報告|作業|測驗|教材|上傳作業/, '/classroom');
  match(/課表|上什麼課|哪堂課|下堂課|空堂|排課|下一節課/, '/timetable');
  if (!locationQuestion) match(/借書|續借|館藏|找書|圖書館/, '/library');
  match(/分數|成績|評分|學期成績/, '/grades');
  match(/學分|畢業門檻|畢業條件/, '/credit-planner');
  match(/午餐|晚餐|吃什麼|找吃的|餐廳|菜單|食堂/, '/cafeteria');
  match(/宿舍|寢室|住宿|洗衣|報修/, '/dormitory');
  match(/我的行程|行事曆|日曆|考試日期|新增活動|安排行程/, '/calendar');
  match(/講座|校園活動|活動報名|演講/, '/events');
  match(/公告|最新消息/, '/announcements');
  match(/通知|未讀訊息|私訊/, '/messages');
  match(/失物|遺失|拾獲|找不到.*東西/, '/lost-found');
  match(/加好友|找朋友|好友課表/, '/friends');

  return result.slice(0, 3);
}
