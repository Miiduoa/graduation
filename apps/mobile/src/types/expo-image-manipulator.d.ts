declare module 'expo-image-manipulator' {
  export const SaveFormat: { JPEG: string; PNG: string };
  export function manipulateAsync(
    uri: string,
    actions: { rotate?: number; resize?: { width?: number; height?: number } }[],
    options?: { compress?: number; format?: string },
  ): Promise<{ uri: string; width: number; height: number }>;
}
