export { parseAttendanceQr, type AttendanceQrScope, type AttendanceQrResult } from '@campus/shared/src/attendanceQr';

export function attendanceCameraError(problem: unknown): string {
  const name = problem && typeof problem === 'object' && 'name' in problem ? problem.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '尚未允許相機權限。請在瀏覽器設定中允許相機，或改用下方簽到碼。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '這台裝置沒有可用的相機，請改用下方簽到碼。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '相機可能被其他程式使用，請關閉其他相機程式後重試，或輸入簽到碼。';
  }
  return '暫時無法使用相機掃碼。請重新開啟，或改用下方簽到碼。';
}
