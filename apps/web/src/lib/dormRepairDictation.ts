import type { DormRepairCategory } from '@campus/shared/src/dormitory';

export type DormRepairDictation = {
  category: DormRepairCategory;
  title: string;
  location: string;
  description: string;
};

// Keep everything the person said in the editable description. Only the
// category and explicitly mentioned location are inferred; nothing is saved.
export function parseDormRepairDictation(speech: string): DormRepairDictation | null {
  const original = speech.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (original.length < 2) return null;

  const title = original
    .replace(/^(?:請)?(?:幫我|我要|我想)?(?:記錄一下|紀錄一下|報修一下|申報一下|報修|記一下)[：:,，\s]*/u, '')
    .slice(0, 90)
    .trim() || original.slice(0, 90);

  let category: DormRepairCategory = 'other';
  if (/wifi|wi-fi|網路|路由器|網線|無線網路|基地台/i.test(original)) category = 'network';
  else if (/冷氣|空調|通風|暖氣|風扇/.test(original)) category = 'air';
  else if (/漏水|水龍頭|水管|熱水|馬桶|蓮蓬頭|排水|洗手台/.test(original)) category = 'water';
  else if (/插座|電燈|燈管|燈泡|跳電|停電|電力|照明/.test(original)) category = 'electric';
  else if (/窗戶|門鎖|桌子|椅子|床架|衣櫃|書桌|家具/.test(original)) category = 'furniture';

  const explicitLocation = original.match(/(?:位置|地點)(?:是|在|位於)?[：:\s]*([^，。；,;\n]{2,100})/);
  return {
    title,
    category,
    location: explicitLocation?.[1]?.trim().slice(0, 100) ?? '',
    description: original,
  };
}
