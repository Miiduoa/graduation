/** Projection only presents a server-issued QR. It never grants attendance. */
export function canPresentAttendanceQr(image: string, expiresAt: string | null, now: number): boolean {
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(now) && Number.isFinite(deadline) && deadline > now &&
    image.length <= 2_000_000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image);
}

export function attendanceCountdown(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const remaining = Math.ceil(seconds);
  return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
}

export function attendanceProjectionCount(count: number): string {
  return Number.isSafeInteger(count) && count >= 0 ? String(count) : '—';
}
