/**
 * The client-side attendance engine is a preflight check, not proof of attendance.
 * A callable must explicitly confirm the persisted check-in before the UI or
 * cross-role inbox can describe the student as present.
 */
export type ConfirmedAttendance = { status: 'present' | 'late' };

export function parseAttendanceConfirmation(payload: unknown): ConfirmedAttendance | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const data = payload as Record<string, unknown>;
  if (data.valid !== true) return null;
  if (data.status !== 'present' && data.status !== 'late') return null;

  return { status: data.status };
}

/**
 * This screen only provides QR, numeric code and location inputs. In particular,
 * taking a photo is not evidence of face identity or liveness.
 */
export function isAttendanceMethodSupported(
  method: string,
  multiFactorMethods?: readonly string[],
): boolean {
  if (method === 'selfie_liveness') return false;
  if (method === 'multi_factor') {
    return (
      Array.isArray(multiFactorMethods) &&
      multiFactorMethods.length === 2 &&
      multiFactorMethods.includes('rotating_qr') &&
      multiFactorMethods.includes('geofence')
    );
  }
  return method === 'rotating_qr' || method === 'number_code' || method === 'geofence';
}
