import { NuniError } from '@campus/shared/src/nuni';

export function isTronClassNativeConnectEnabled(): boolean {
  return process.env.EXPO_PUBLIC_TRONCLASS_NATIVE_CONNECT_ENABLED === 'true';
}

export function assertTronClassNativeConnectAllowed(action: string): void {
  if (action === 'connect' && !isTronClassNativeConnectEnabled())
    throw new NuniError(403, 'TRONCLASS_NATIVE_CONNECT_DISABLED');
}
