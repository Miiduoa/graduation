import "dotenv/config";

export default ({ config }: any) => {
  const isProduction = process.env.APP_ENV === "production";
  
  return {
    ...config,
    name: config.name ?? "校園助手",
    slug: config.slug ?? "campus-app",
    version: config.version ?? "1.0.0",
    orientation: "portrait",
    scheme: "campus",
    userInterfaceStyle: "automatic",
    icon: config.icon ?? "./assets/icon.png",
    splash: {
      image: config.splash?.image ?? "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#1a1a2e",
    },
    assetBundlePatterns: ["**/*"],
    ios: {
      ...(config.ios ?? {}),
      supportsTablet: true,
      bundleIdentifier: isProduction 
        ? "com.campus.app" 
        : "com.campus.app.dev",
      buildNumber: "1",
      infoPlist: {
        NSCameraUsageDescription: "需要相機權限以掃描 QR 碼和拍照",
        NSPhotoLibraryUsageDescription: "需要相簿權限以選擇照片",
        NSLocationWhenInUseUsageDescription: "需要位置權限以提供校園導航",
        NSLocationAlwaysAndWhenInUseUsageDescription: "需要位置權限以提供校園導航",
        NSFaceIDUsageDescription: "使用 Face ID 進行安全驗證",
        UIBackgroundModes: ["fetch", "remote-notification"],
      },
      associatedDomains: ["applinks:campus-app.web.app"],
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
      entitlements: {
        "com.apple.developer.applesignin": ["Default"],
        "aps-environment": isProduction ? "production" : "development",
      },
    },
    android: {
      ...(config.android ?? {}),
      adaptiveIcon: {
        foregroundImage: config.android?.adaptiveIcon?.foregroundImage ?? "./assets/adaptive-icon.png",
        backgroundColor: "#1a1a2e",
      },
      package: isProduction 
        ? "com.campus.app" 
        : "com.campus.app.dev",
      versionCode: 1,
      permissions: [
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE",
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "RECEIVE_BOOT_COMPLETED",
        "VIBRATE",
        "USE_FINGERPRINT",
        "USE_BIOMETRIC",
      ],
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        },
      },
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            { scheme: "https", host: "campus-app.web.app", pathPrefix: "/" },
            { scheme: "campus" },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
    plugins: [
      "expo-router",
      "expo-localization",
      [
        "expo-camera",
        {
          cameraPermission: "需要相機權限以掃描 QR 碼",
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: "需要位置權限以提供校園導航",
        },
      ],
      [
        "expo-image-picker",
        {
          photosPermission: "需要相簿權限以選擇照片",
        },
      ],
      [
        "expo-notifications",
        {
          color: "#6366F1",
          sounds: ["./assets/sounds/notification.wav"],
        },
      ],
      [
        "expo-document-picker",
        {
          iCloudContainerEnvironment: isProduction ? "Production" : "Development",
        },
      ],
      [
        "expo-local-authentication",
        {
          faceIDPermission: "使用 Face ID 進行安全驗證",
        },
      ],
      "./src/widgets/expo-widget-plugin.js",
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      ...(config.extra ?? {}),
      firebase: {
        apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      },
      cloudFunctionRegion: process.env.EXPO_PUBLIC_CLOUD_FUNCTION_REGION ?? "asia-east1",
      aiProvider: process.env.EXPO_PUBLIC_AI_PROVIDER ?? "mock",
      enableMockSSO: process.env.EXPO_PUBLIC_ENABLE_MOCK_SSO === "true",
      ...(isProduction
        ? {}
        : {
            testSchoolLogin: {
              enabled: process.env.TEST_SCHOOL_LOGIN_ENABLED === "true",
              schoolId: process.env.TEST_SCHOOL_ID ?? "",
              username: process.env.TEST_SCHOOL_USERNAME ?? "",
              password: process.env.TEST_SCHOOL_PASSWORD ?? "",
            },
          }),
      eas: {
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
      },
      widgetConfig: {
        appGroupId: "group.com.campus.app",
        refreshInterval: 15,
      },
    },
    updates: {
      fallbackToCacheTimeout: 0,
      url: `https://u.expo.dev/${process.env.EXPO_PUBLIC_EAS_PROJECT_ID}`,
    },
    runtimeVersion: {
      policy: "sdkVersion",
    },
  };
};
