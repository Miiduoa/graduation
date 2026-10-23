export const FOOD_PAGE_SUBTITLE_WHEN_ORDERING_ON = '先看菜單與金額，確認後才送出訂單。';
export const FOOD_PAGE_SUBTITLE_WHEN_ORDERING_OFF = '目前還不能線上點餐';
export const FOOD_PAGE_INTRO_WHEN_ORDERING_ON =
  '選擇門市、確認金額後送出，到店付款。取餐前可隨時查看進度。';
export const FOOD_PAGE_INTRO_WHEN_ORDERING_OFF = '目前還不能線上點餐';

export function foodPageSubtitle(orderingEnabled: boolean): string {
  return orderingEnabled
    ? FOOD_PAGE_SUBTITLE_WHEN_ORDERING_ON
    : FOOD_PAGE_SUBTITLE_WHEN_ORDERING_OFF;
}

export function foodPageIntro(orderingEnabled: boolean): string {
  return orderingEnabled ? FOOD_PAGE_INTRO_WHEN_ORDERING_ON : FOOD_PAGE_INTRO_WHEN_ORDERING_OFF;
}
