import { NuniError } from '@campus/shared/src/nuni';
import {
  createNuniLostFound,
  type NuniLostFoundItem,
  type NuniLostFoundListInput,
  type NuniLostFoundRemoval,
} from '@campus/shared/src/nuniLostFound';
import type { ServiceListSearchParams } from '@/lib/serviceListNavigation';
import {
  PlatformLostFoundStorageError,
  type PlatformLostFoundPending,
} from './platformLostFoundPending';

export type Mode = 'list' | 'create' | 'detail';
export type Filters = Pick<NuniLostFoundListInput, 'q' | 'type' | 'status' | 'mine'>;
export type Client = ReturnType<typeof createNuniLostFound>;
export type Receipt = NuniLostFoundItem | NuniLostFoundRemoval;
export type Write = (
  operation: PlatformLostFoundPending,
  success?: (receipt: Receipt) => void,
) => Promise<void>;
export type Scope = { schoolId: string; schoolName: string; filters: Filters };

function queryValue(search: ServiceListSearchParams | undefined, key: string) {
  return typeof search?.[key] === 'string' ? (search[key] as string) : '';
}
export function filtersFrom(search?: ServiceListSearchParams): Filters {
  const type = queryValue(search, 'type');
  const status = queryValue(search, 'status');
  const mine = queryValue(search, 'mine') === '1';
  return {
    q: queryValue(search, 'q')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 100),
    ...(type === 'lost' || type === 'found' ? { type } : {}),
    status:
      status === 'open' || status === 'resolved' || status === 'all'
        ? status
        : mine
          ? 'all'
          : 'open',
    mine,
  };
}

export function platformLostFoundHref(
  schoolId: string,
  mode: Mode = 'list',
  id?: string,
  filters: Filters = {},
) {
  const query = new URLSearchParams({ schoolId });
  if (filters.q) query.set('q', filters.q);
  if (filters.type) query.set('type', filters.type);
  if (filters.status) query.set('status', filters.status);
  if (filters.mine) query.set('mine', '1');
  const suffix =
    mode === 'create' ? '/post' : mode === 'detail' && id ? '/' + encodeURIComponent(id) : '';
  return '/lost-found/platform' + suffix + '?' + query;
}

export function errorMessage(error: unknown, phase: 'read' | 'write' = 'write'): string {
  if (error instanceof PlatformLostFoundStorageError)
    return '瀏覽器無法保留待確認紀錄，尚未送出新的操作。請先確認瀏覽器儲存設定。';
  if (error instanceof NuniError) {
    if (['LOST_FOUND_VERSION_CONFLICT', 'LOST_FOUND_REPLAY_CHANGED'].includes(error.code))
      return '刊登內容已經變更。請先查看最新內容，再決定是否放棄這筆待確認操作。';
    if (error.code === 'LOST_FOUND_MUTATION_CONFLICT')
      return '這筆操作的紀錄不一致，請先核對自己的刊登，不要重複建立。';
    if (error.code === 'LOST_FOUND_CLOSED')
      return '這筆刊登已經結案，無法再編輯；仍可核對內容或下架。';
    if (error.code === 'LOST_FOUND_NOT_FOUND' || error.code === 'LOST_FOUND_REMOVED')
      return '這筆刊登已下架、不存在，或目前帳號無法操作。';
    if (error.status === 404 || error.status === 503)
      return '平台失物招領目前尚未開通或暫時無法使用，請稍後重試。';
    if (error.status === 429) return '操作次數或刊登數量已達上限，請稍後再試，或先整理自己的刊登。';
    if (error.status === 422) return '請確認欄位、日期與字數後再試一次。';
  }
  return phase === 'read'
    ? '暫時無法讀取失物招領，請稍後重試。'
    : '目前無法確認操作結果。待確認的操作會保留，重試時不會建立重複刊登。';
}
export function isExpired(error: unknown) {
  return error instanceof NuniError && (error.status === 401 || error.code === 'SESSION_CHANGED');
}
