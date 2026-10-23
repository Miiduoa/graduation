export function isMobileOnlineOrderingEnabled(
  raw: string | undefined = process.env.EXPO_PUBLIC_ONLINE_ORDERING,
): boolean {
  return typeof raw === 'string' && /^(1|true|on|yes)$/i.test(raw.trim());
}
