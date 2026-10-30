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
  "/friends",
  "/import",
  "/appeals",
  "/teacher",
  "/groups",
  "/grades?tab=feedback",
  "/clubs",
  "/dms",
  "/community",
  "/food",
  "/merchant",
  "/school-info",
  "/ai-assistant",
  "/support",
  "/account-deletion",
  "/profile",
  "/settings",
  "/classroom/account",
  "/admin"
] as const;

export type CampusQuickDestination = (typeof CAMPUS_QUICK_DESTINATIONS)[number];

export function suggestCampusDestinations(input: string): CampusQuickDestination[] {
  const normalized = input.slice(0, 160).normalize('NFKC').toLocaleLowerCase('zh-TW');
  const phrase = normalized.replace(/\s+/g, '');
  if (!phrase) return [];

  const result: CampusQuickDestination[] = [];
  function match(pattern: RegExp, destination: CampusQuickDestination) {
    if (pattern.test(phrase) && !result.includes(destination)) result.push(destination);
  }

  const locationQuestion = /在哪|位置|怎麼走|如何走|帶我去|走去|導航|找教室|地圖/.test(phrase);
  const busQuestion = /公車|巴士|站牌|到站|搭車|幾號車/.test(phrase);

  if (/\bwow\s*class\b|\btron\s*class\b|玩課雲/.test(normalized)) result.push('/classroom');
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
  match(/匯入|掃描課表|上傳課表|上傳成績|讀取截圖|ocr/, '/import');
  match(/課程申訴|缺席申訴|出席異議|成績申訴|申訴單/, '/appeals');
  match(/老師工作台|授課管理|教師工作台|批改作業/, '/teacher');
  match(/群組|課程群組|加入課程/, '/groups');
  match(/評語|老師回饋|作業回饋|成績回饋/, '/grades?tab=feedback');
  match(/社團|社團清單|入社/, '/clubs');
  match(/私訊|聊天|傳訊息|對話紀錄/, '/dms');
  match(/校園社群|校園交流|貼文|討論區|看板|發文/, '/community');
  match(/點餐|訂餐|取餐|訂單狀態|餐點訂單/, '/food');
  match(/店家合作|商家進駐|門市管理|商家後台|店家後台/, '/merchant');
  match(/學校資訊|校方電話|總機|學校官網|學校地址/, '/school-info');
  match(/詢問校園助理|問助理|問ai|人工智慧助理/, '/ai-assistant');
  match(/客服|問題回報|聯絡支援|幫助中心/, '/support');
  match(/刪除帳號|註銷帳號|刪掉帳戶/, '/account-deletion');
  match(/我的個人資料|編輯個人資料|姓名|學號|個人資料/, '/profile');
  match(/設定|暗色模式|深色模式|外觀主題|通知設定/, '/settings');
  match(/學校資格|學籍驗證|身分驗證|多校資格/, '/classroom/account');
  match(/管理員後台|平台管理員|系統後台/, '/admin');

  return result.slice(0, 3);
}
