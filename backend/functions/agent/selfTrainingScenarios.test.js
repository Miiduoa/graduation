'use strict';

const { classifyIntent } = require('./classifyIntent');
const { buildBreakthroughPlan } = require('./learning/breakthroughPlanner');

describe('agent self-training scenario matrix', () => {
  test.each([
    ['課表', '今天幾點上課？', 'study_summary'],
    ['作業', '我有哪些作業快截止？', 'assignment_status'],
    ['讀書計畫', '幫我把這週作業拆成讀書計畫', 'assignment_planning'],
    ['學分', '我這樣會不會延畢？', 'credit_audit'],
    ['公告', '今天有什麼公告？', 'announcements'],
    ['活動', '這週有什麼活動可以參加？', 'events'],
    ['餐點推薦', '推薦午餐', 'menus'],
    ['訂餐', '幫我點一份雞排飯', 'food_order'],
    ['取消訂單', '幫我取消剛剛的訂單', 'food_order'],
    ['地點', '圖書館在哪裡？', 'pois'],
    ['座位', '幫我預約明天下午圖書館座位', 'reserve_seat'],
    ['借書', '幫我借這本書', 'borrow_book'],
    ['續借', '幫我續借快到期的書', 'renew_book'],
    ['還書', '幫我還書', 'return_book'],
    ['請假', '幫我請明天病假', 'leave_request'],
    ['假單狀態', '我的假單審核到哪了？', 'leave_status'],
    ['宿舍報修', '宿舍冷氣壞了幫我報修', 'submit_repair_request'],
    ['報修狀態', '我的宿舍報修好了嗎？', 'check_repair_status'],
    ['洗衣機', '幫我預約今晚洗衣機', 'wash_reserve'],
    ['未知校務', '轉系申請要去哪裡交？', 'general'],
    ['模糊指令', '幫我處理一下那個', 'general'],
    ['能力說明', '你會什麼？', 'help'],
  ])('%s routes to %s', (_label, message, expectedIntent) => {
    expect(classifyIntent(message).name).toBe(expectedIntent);
  });

  test('gap plans propose a next learning path instead of stopping at unknown', () => {
    const plans = [
      buildBreakthroughPlan({
        query: '轉系申請要去哪裡交？',
        gap: '沒有轉系申請流程資料',
        attemptedTools: ['searchCampusDocs'],
        desiredCapability: '自動找校務流程並保存可追溯來源',
      }),
      buildBreakthroughPlan({
        query: '幫我續借快到期的書',
        gap: '沒有 loanId 或借閱紀錄時需要追問',
        attemptedTools: ['getLibraryLoans'],
        desiredCapability: '能辨識續借並產生確認草稿',
      }),
      buildBreakthroughPlan({
        query: '我的作業抓不到',
        gap: 'TronClass 作業資料空白',
        attemptedTools: ['getAssignments'],
        failedBecause: 'session expired or empty activity cache',
        desiredCapability: '改查課程與公告線索並提示重新連線',
      }),
    ];

    for (const plan of plans) {
      expect(plan.fingerprint).toHaveLength(16);
      expect(plan.learningSteps.length).toBeGreaterThanOrEqual(3);
      expect(plan.learningSteps.join('\n')).toContain('learned skill');
    }
    expect(plans[1].suggestedTools.map((tool) => tool.name)).not.toContain('listMyDormRepairs');
    expect(plans[2].suggestedTools.map((tool) => tool.name)).toContain('searchCampusDocs');
  });
});
