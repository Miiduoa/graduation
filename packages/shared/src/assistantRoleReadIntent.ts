/** Pure intent classification shared by the composer, role guidance and readers.
 * Recognizing a request never grants access to its source. */
/** Whole, unfiltered reads only. Never discard a named course, date, write or negation. */
export function parseTeachingRead(question: string): { tool: 'get_teaching_overview'; args: { limit?: number } } | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 160 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let value = question.normalize('NFKC').trim().replace(/[。！？!?]+$/, '').replace(/\s+/g, '');
  value = value.replace(/^(?:(?:麻煩你|麻煩|請問|請|幫我|替我|我想|想|查詢|查看|查一下|看一下|看看|列出|顯示|查|看|核對|目前的|目前))*/, '');
  value = value.replace(/(?:有哪些|有什麼|如何|怎麼樣|資訊|資料)?(?:嗎|呢)?$/, '');
  if (!/^(?:(?:我的|本人|我)(?:授課|教學|負責授課)(?:的)?(?:課程|課務|作業|測驗)?(?:概況|摘要|總覽|狀況|進度)?|(?:教師|老師|授課|教學)(?:工作|課務)?(?:概況|摘要|總覽)|(?:我教|我開)的課(?:程)?(?:概況|摘要|總覽|作業|測驗)?)$/.test(value)) return null;
  return { tool: 'get_teaching_overview', args: {} };
}

/** Whole explicit clauses only. In particular, a personal customer's orders,
 * a date-filtered queue or a named shop cannot widen into a merchant read. */
export function parseMerchantRead(question: string): { tool: 'get_merchant_overview'; args: { tenantId?: string; locationId?: string } } | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 120 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let value = question.normalize('NFKC').trim().replace(/[。！？!?]+$/, '').replace(/\s+/g, '');
  value = value.replace(/^(?:(?:麻煩你|麻煩|請問|請|幫我|替我|我想|想|查詢|查看|查一下|看一下|看看|查|看|列出|顯示|核對|檢查|目前的|目前|現在的|現在))*/, '');
  value = value.replace(/(?:有哪些|有什麼|資訊|資料|概況|摘要)?(?:嗎|呢)?$/, '');
  return /^(?:我的?)?(?:店家(?:營運|訂單|待處理訂單|班次|交班)|門市(?:營運|訂單|待處理訂單|班次|交班)|授權門市|管理的門市|店家工作區|門市工作區)(?:狀態)?$/.test(value)
    ? { tool: 'get_merchant_overview', args: {} } : null;
}

export function connectedServiceClauses(question: string): string[] {
  if (!question.trim() || question.length > 1000 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question) ||
      /不要|不用|不必|無須|不需要|先別|別幫|不是要|翻譯|假設|如果|例如|範例/.test(question)) return [];
  const text = question.normalize('NFKC').trim();
  const quotes: Record<string, string> = { '「': '」', '『': '』', '“': '”', '"': '"', "'": "'", '`': '`' };
  const clauses: string[] = [];
  let quote = '', part = '';
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (quote) {
      part += character;
      if (character === quote) quote = '';
      index++;
      continue;
    }
    if (quotes[character]) {
      quote = quotes[character];
      part += character;
      index++;
      continue;
    }
    const separator = /^(?:然後|接著|順便|並且|另外|同時|以及|也幫我|再幫我|並幫我|[，,；;。！!？?、和與])/.exec(text.slice(index));
    if (separator) {
      if (part.trim()) clauses.push(part.trim());
      part = '';
      index += separator[0].length;
    } else { part += character; index++; }
  }
  if (quote) return [];
  if (part.trim()) clauses.push(part.trim());
  if (!clauses.length || clauses.length > 12) return [];
  return clauses;
}
