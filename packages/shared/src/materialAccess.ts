import { isNetworkLayerError } from './loadFailureCopy';
import { NuniError, type NuniWorkspace } from './nuni';

export function materialFailureMessage(failure: unknown, offline = false): string {
  const status = failure instanceof NuniError ? failure.status :
    typeof failure === 'object' && failure !== null && 'status' in failure ? Number(failure.status) : 0;
  if (failure instanceof NuniError && failure.code === 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID') return '教材頁面已失效，請更新教材後再試。';
  if (status === 401 || status === 403) return '你目前沒有查看權限。請回課程首頁確認身分，或請老師協助。';
  if (status === 404 || status === 410) return '這份教材已不存在。請回課程首頁找老師更新後的版本。';
  if (offline || isNetworkLayerError(failure) || failure instanceof TypeError) return '目前無法連線，連線中斷。確認網路連線後，再試一次。';
  return '教材服務暫時沒有回應。請稍後重試，或先回課程首頁。';
}

export function materialCapabilities(workspace: NuniWorkspace): string {
  if (workspace.state === 'archived') return '來源：nuni 課程 · 已封存，可閱讀教材，不能發布新教材。';
  return workspace.memberRole === 'student'
    ? '來源：nuni 課程 · 你可以閱讀與分享教材入口；只有老師能發布教材。'
    : '來源：nuni 課程 · 你可以閱讀、分享教材入口，也可以發布教材。';
}

export async function readMaterialWithDeadline<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('教材讀取逾時')), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
