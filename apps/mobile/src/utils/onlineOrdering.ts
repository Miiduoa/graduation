export const ONLINE_ORDERING_OFF_TEXT = '目前還不能線上點餐';

export function isMobileOnlineOrderingEnabled(
  raw: string | undefined = process.env.EXPO_PUBLIC_ONLINE_ORDERING,
): boolean {
  return typeof raw === 'string' && /^(1|true|on|yes)$/i.test(raw.trim());
}
