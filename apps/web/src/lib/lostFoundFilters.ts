import {
  isOpenLostFoundStatus,
  type LostFoundItem,
} from './lostFound';

export type LostFoundListFilters = {
  query: string;
  type: 'all' | 'lost' | 'found';
  status: 'all' | 'open' | 'resolved';
  mine: boolean;
};

export const DEFAULT_LOST_FOUND_FILTERS: LostFoundListFilters = {
  query: '',
  type: 'all',
  status: 'all',
  mine: false,
};

export function filterLostFoundItems(
  items: LostFoundItem[],
  filters: LostFoundListFilters,
  uid: string | null | undefined,
): LostFoundItem[] {
  const needle = filters.query.trim().toLocaleLowerCase('zh-TW');
  return items.filter((item) => {
    if (filters.type !== 'all' && item.type !== filters.type) return false;
    if (filters.status === 'open' && !isOpenLostFoundStatus(item.status)) return false;
    if (
      filters.status === 'resolved' &&
      item.status !== 'resolved' &&
      item.status !== 'returned' &&
      item.status !== 'expired'
    ) {
      return false;
    }
    if (filters.mine) {
      if (!uid) return false;
      if (item.userId !== uid && item.reporterId !== uid) return false;
    }
    if (!needle) return true;
    const haystack = [item.title, item.description, item.location, item.category]
      .join(' ')
      .toLocaleLowerCase('zh-TW');
    return haystack.includes(needle);
  });
}

export function describeLostFoundFilterScope(
  filters: LostFoundListFilters,
  schoolName: string,
): string {
  const parts = [`範圍：${schoolName}`];
  if (filters.type === 'lost') parts.push('類型：遺失');
  if (filters.type === 'found') parts.push('類型：拾獲');
  if (filters.status === 'open') parts.push('狀態：尋找中');
  if (filters.status === 'resolved') parts.push('狀態：已結案／過期');
  if (filters.mine) parts.push('僅顯示我刊登的');
  if (filters.query.trim()) parts.push(`關鍵字：「${filters.query.trim()}」`);
  return parts.join(' · ');
}
