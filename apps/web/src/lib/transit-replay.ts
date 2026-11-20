/**
 * 正式站有兩台 Web 機器，公車快取與「最近一份資料」都放在各自記憶體。
 * 為了讓所有人共用同一份快取，/api/transit 先集中到固定一台（第一台）處理：
 * 其他機器回 fly-replay 交給 Fly Proxy 轉送；主機不在或逾時，Proxy 依
 * fallback=prefer_self 退回原機器自己處理，不會形成單點故障。
 * 不認得的機器（例如換機後）一律本機處理，不猜測拓撲。
 */
export const TRANSIT_LEADER_MACHINES = ['683e513be2d358', '80e447b6140178'] as const;
const REPLAY_TIMEOUT = '3s';
const MACHINE_ID = /^[a-z0-9]{8,32}$/;

export function transitReplayHeader(
  machineId: string | undefined,
  headers: { get(name: string): string | null },
): string | null {
  if (!machineId || !MACHINE_ID.test(machineId)) return null;
  if (!(TRANSIT_LEADER_MACHINES as readonly string[]).includes(machineId)) return null;
  const leader = TRANSIT_LEADER_MACHINES[0];
  if (machineId === leader) return null;
  // 已經被轉送過、轉送失敗退回、或主機無法使用而改派的請求，都在本機處理，避免來回轉送。
  if (headers.get('fly-replay-src') || headers.get('fly-replay-failed') || headers.get('fly-preferred-instance-unavailable'))
    return null;
  return `instance=${leader};timeout=${REPLAY_TIMEOUT};fallback=prefer_self`;
}
