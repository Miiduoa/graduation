import {
  isPuEcampusDataFetchEnabled, PU_ECAMPUS_DATA_PAUSED_MESSAGE,
} from '@campus/shared/src/puEcampusDataPolicy';
import { getAuthInstance } from '../firebase';
import { getSchoolCreditOverviewUrl } from './cloudFunctions';
import {
  normalizePuCreditOverview, type PuCreditOverviewSnapshot,
} from '@campus/shared/src/puCreditOverview';

export class SchoolCreditOverviewError extends Error {
  constructor(public readonly reason: 'reconnect' | 'permission' | 'unavailable' | 'paused') {
    super(reason === 'paused' ? PU_ECAMPUS_DATA_PAUSED_MESSAGE : reason === 'reconnect' ? '請重新連線學校帳號。'
      : reason === 'permission' ? '目前無法確認你的在校身分。' : '暫時無法讀取校方學分累計。');
    this.name = 'SchoolCreditOverviewError';
  }
}

/** 讀取本人試算總覽，不傳送學校帳密或由客戶端選擇校務 session。 */
export async function loadOwnedSchoolCreditOverview(uid: string): Promise<PuCreditOverviewSnapshot> {
  const requester = getAuthInstance().currentUser;
  if (!requester || requester.uid !== uid || typeof requester.getIdToken !== 'function')
    throw new SchoolCreditOverviewError('reconnect');
  // Older hosted endpoints may not have the pause yet. Stop locally before fetching a token.
  if (!isPuEcampusDataFetchEnabled()) throw new SchoolCreditOverviewError('paused');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SchoolCreditOverviewError('unavailable'));
    }, 45_000);
  });
  const assertCurrent = () => {
    if (getAuthInstance().currentUser !== requester) throw new SchoolCreditOverviewError('reconnect');
    if (controller.signal.aborted) throw new SchoolCreditOverviewError('unavailable');
  };
  const read = async (): Promise<PuCreditOverviewSnapshot> => {
    const token = await requester.getIdToken();
    assertCurrent();
    const url = getSchoolCreditOverviewUrl();
    const options: RequestInit = {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: { dataType: 'creditOverview' } }),
    };
    const response = await fetch(url, options);
    assertCurrent();
    const envelope = await response.json();
    assertCurrent();
    if (!response.ok || envelope?.error) {
      const status = envelope?.error?.status;
      if (response.status === 401 || status === 'UNAUTHENTICATED' || status === 'FAILED_PRECONDITION')
        throw new SchoolCreditOverviewError('reconnect');
      if (response.status === 403 || status === 'PERMISSION_DENIED')
        throw new SchoolCreditOverviewError('permission');
      throw new SchoolCreditOverviewError('unavailable');
    }
    const snapshot = envelope?.result;
    const overview = normalizePuCreditOverview(snapshot?.result?.creditOverview);
    if (snapshot?.success !== true || snapshot.ownerUid !== uid || snapshot.schoolId !== 'pu' ||
        snapshot.source !== 'pu-campus' || snapshot.dataType !== 'creditOverview' ||
        typeof snapshot.fetchedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.fetchedAt)) ||
        snapshot.result?.success !== true || !overview) throw new SchoolCreditOverviewError('unavailable');
    return { ownerUid: uid, schoolId: 'pu', fetchedAt: snapshot.fetchedAt, overview };
  };
  try {
    return await Promise.race([read(), expired]);
  } catch (error) {
    if (error instanceof SchoolCreditOverviewError) throw error;
    throw new SchoolCreditOverviewError('unavailable');
  } finally {
    clearTimeout(timer!);
  }
}
