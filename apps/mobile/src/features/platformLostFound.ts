import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { NuniError } from '@campus/shared/src/nuni';
import { NUNI_LOST_FOUND_CATEGORIES } from '@campus/shared/src/nuniLostFound';
import { PlatformLostFoundScopeChanged } from '../data/platformLostFoundDrafts';

const categoryNames: Record<(typeof NUNI_LOST_FOUND_CATEGORIES)[number], string> = {
  electronics: '電子產品',
  cards: '證件／卡片',
  documents: '文件',
  wallet: '錢包',
  clothing: '衣物',
  accessories: '配件',
  books: '書籍',
  keys: '鑰匙',
  other: '其他',
};
export const platformLostFoundCategories = NUNI_LOST_FOUND_CATEGORIES.map((id) => ({
  id,
  label: categoryNames[id],
}));
export const platformLostFoundCategoryLabel = (id: string) =>
  categoryNames[id as keyof typeof categoryNames] ?? '其他';

export function usePlatformLostFoundFocus(verifySession: () => boolean) {
  const sequence = useRef(0);
  const [focus, setFocus] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      const generation = ++sequence.current;
      setFocus(generation);
      return () => {
        sequence.current += 1;
        setFocus(null);
      };
    }, []),
  );
  const isCurrent = useCallback(
    () => focus !== null && sequence.current === focus && verifySession(),
    [focus, verifySession],
  );
  return { focus, isCurrent };
}

export function platformLostFoundErrorMessage(error: unknown) {
  if (!(error instanceof NuniError)) return '目前無法連線，請確認網路後再試。';
  switch (error.code) {
    case 'LOST_FOUND_VERSION_CONFLICT':
      return '這則刊登已被其他操作更新。請重新讀取最新內容，再確認要修改的資訊。';
    case 'LOST_FOUND_REPLAY_CHANGED':
      return '先前操作之後，這則刊登又有變更。請重新讀取，確認目前的狀態。';
    case 'LOST_FOUND_MUTATION_CONFLICT':
      return '這次操作編號已有不同內容，請重新讀取刊登後再操作。';
    case 'LOST_FOUND_CLOSED':
      return '這則刊登已結案，無法再編輯；本人仍可下架。';
    case 'LOST_FOUND_REMOVED':
    case 'LOST_FOUND_NOT_FOUND':
      return '找不到這則刊登，可能已下架，或不屬於目前校園。';
    case 'LOST_FOUND_INVALID_INPUT':
      return '請確認物品名稱、描述、地點與有效日期，並檢查各欄位的長度。';
    case 'LOST_FOUND_RATE_LIMIT':
      return '操作次數較多，請稍候再試。';
    case 'LOST_FOUND_ITEM_LIMIT':
      return '目前刊登數量已達上限，請先處理不再需要的刊登。';
    case 'INVALID_RESPONSE':
      return '服務回傳的資料無法確認，請重新讀取。';
  }
  if (error.status === 401) return 'Google 登入狀態已過期，請重新確認登入。';
  if ([404, 501, 503].includes(error.status)) return '平台失物招領服務目前無法使用，請稍後再試。';
  if (error.status === 403) return '目前帳號無法執行這個操作。';
  return '目前無法連線，請確認網路後再試。';
}

export function isPlatformLostFoundScopeError(error: unknown) {
  return (
    error instanceof PlatformLostFoundScopeChanged ||
    (error instanceof NuniError && ['SESSION_CHANGED', 'REQUEST_CANCELLED'].includes(error.code))
  );
}

/** These are explicit rejection receipts; network errors and malformed 200 responses stay pending. */
export function isPlatformLostFoundRejected(error: unknown) {
  return (
    error instanceof NuniError &&
    !isPlatformLostFoundScopeError(error) &&
    [400, 403, 404, 409, 410, 422].includes(error.status)
  );
}
