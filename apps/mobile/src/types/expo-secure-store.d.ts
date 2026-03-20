declare module "expo-secure-store" {
  export const AFTER_FIRST_UNLOCK: string;
  export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: string;

  export function isAvailableAsync(): Promise<boolean>;
  export function getItemAsync(key: string): Promise<string | null>;
  export function setItemAsync(
    key: string,
    value: string,
    options?: {
      keychainAccessible?: string;
    }
  ): Promise<void>;
  export function deleteItemAsync(key: string): Promise<void>;
}
