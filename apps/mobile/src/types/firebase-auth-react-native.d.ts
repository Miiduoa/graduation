/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps, no-case-declarations, no-useless-escape, no-empty */
declare module "firebase/auth/react-native" {
  // Minimal typing shim for React Native persistence helper.
  // Firebase JS SDK provides this entrypoint at runtime.
  export function getReactNativePersistence(storage: any): any;
}
