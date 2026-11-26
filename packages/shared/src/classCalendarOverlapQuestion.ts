export const TODAY_CONFLICT_QUESTION = '今天的課表和行程有衝突嗎？';

const classSubject = '(?:我的)?(?:課表|課程|上課時間|上課|課)';
const eventSubject = '(?:我的)?(?:個人)?(?:行程|行事曆)';
const questionWord = '(?:有沒有|會不會|是不是|有|會|是否)?';
const connector = questionWord + '(?:跟|與|和)';
const subjects = `(?:${classSubject}${connector}${eventSubject}|${eventSubject}${connector}${classSubject})`;
const collision = '(?:衝突|衝堂|撞期|重疊|撞到)';
const explicitSubjects = subjects + '(?:的?時間)?' + questionWord + collision;
const eventHitsClass = eventSubject + questionWord + '(?:撞課|撞到課|撞到上課時間)';
const classHitsEvent = classSubject + questionWord + '(?:撞到|撞上)' + eventSubject;
const conflictingEvent = '(?:跟|與|和)' + classSubject + collision + '的' + eventSubject;
const overlapQuestion = new RegExp(
  '^(?:請問|麻煩|請)?(?:你)?(?:可以|能不能|可不可以)?(?:幫我|替我|我想知道)?(?:查詢|查一下|查看|看看|確認一下|確認)?' +
  '(?:我的?)?(?:(?:今天|今日)(?:剩下|接下來)?的?)?(?:有沒有|有哪些|哪些|有)?' +
  `(?:${explicitSubjects}|${eventHitsClass}|${classHitsEvent}|${conflictingEvent})(?:了)?(?:嗎|呢)?$`,
  'u',
);

/** Recognizes a single read of today's own classes and events. Mixed intents keep their action handlers. */
export function isTodayClassCalendarOverlapQuestion(question: string): boolean {
  if (typeof question !== 'string' || question.length > 160 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return false;
  const text = question.normalize('NFKC').trim().replace(/[。.!?]+$/u, '').replace(/\s+/gu, '');
  return overlapQuestion.test(text);
}
