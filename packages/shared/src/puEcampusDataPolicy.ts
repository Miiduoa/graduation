/**
 * E校園資料擷取暫停中（2026-10-30）。恢復前須取得專案擁有者明確指示。
 * 保留已匯入資料；TronClass 與其他學校的獨立資料來源不受此政策控制。
 */
export const PU_ECAMPUS_DATA_PAUSED_MESSAGE =
  'E校園資料擷取已暫停，已匯入的資料仍可使用。';
export const PU_ECAMPUS_DATA_PAUSED_CODE = 'PU_ECAMPUS_DATA_PAUSED';

export function isPuEcampusDataFetchEnabled(): boolean {
  return false;
}

export function assertPuEcampusDataFetchEnabled(): void {
  if (!isPuEcampusDataFetchEnabled()) {
    const error = new Error(PU_ECAMPUS_DATA_PAUSED_MESSAGE);
    Object.assign(error, { code: PU_ECAMPUS_DATA_PAUSED_CODE });
    throw error;
  }
}
