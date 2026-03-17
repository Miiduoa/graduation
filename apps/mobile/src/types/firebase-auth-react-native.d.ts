declare module "firebase/auth/react-native" {
  // Minimal typing shim for React Native persistence helper.
  // Firebase JS SDK provides this entrypoint at runtime.
  export function getReactNativePersistence(storage: any): any;
}
