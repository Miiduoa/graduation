import "dotenv/config";

type AppEnvironment = "development" | "preview" | "production";

type FeatureAvailability = {
  enabled: boolean;
  sso: boolean;
  courses: boolean;
  grades: boolean;
  payments: boolean;
  widgets: boolean;
  deeplinks: boolean;
};

const DEFAULT_WIDGET_APP_GROUP_ID = "group.com.campus.app";

function normalizeAppEnv(value?: string): AppEnvironment {
  if (value === "production" || value === "preview") {
    return value;
  }

  return "development";
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  return value === "true";
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function requireReleaseValue(
  name: string,
  value: string | undefined,
  isReleaseLike: boolean
): string | undefined {
  const normalized = value?.trim();
  if (isReleaseLike && !normalized) {
    throw new Error(`[app.config] Missing required release env: ${name}`);
  }
  return normalized;
}

function requirePositiveInteger(
  name: string,
  value: string | number | undefined,
  isReleaseLike: boolean,
  fallback: number
): number {
  const parsed = typeof value === "number" ? value : Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    if (isReleaseLike) {
      throw new Error(`[app.config] ${name} must be a positive integer`);
    }

    return fallback;
  }

  return parsed;
}

export default ({ config }: any) => {
  const appEnv = normalizeAppEnv(process.env.APP_ENV);
  const isProduction = appEnv === "production";
  const isReleaseLike = appEnv === "preview" || appEnv === "production";
  const releasedSchoolIds = parseCsv(process.env.EXPO_PUBLIC_RELEASED_SCHOOL_IDS);

  const featureAvailability: FeatureAvailability = {
    enabled: true,
    sso: parseBoolean(process.env.EXPO_PUBLIC_FEATURE_SSO, !isReleaseLike),
    courses: parseBoolean(process.env.EXPO_PUBLIC_FEATURE_COURSES, !isReleaseLike),
    grades: parseBoolean(process.env.EXPO_PUBLIC_FEATURE_GRADES, !isReleaseLike),
    payments: parseBoolean(process.env.EXPO_PUBLIC_FEATURE_PAYMENTS, !isReleaseLike),
    widgets: parseBoolean(process.env.EXPO_PUBLIC_FEATURE_WIDGETS, !isReleaseLike),
    deeplinks: parseBoolean(process.env.EXPO_PUBLIC_FEATURE_DEEPLINKS, !isReleaseLike),
  };

  const firebase = {
    apiKey: requireReleaseValue(
      "EXPO_PUBLIC_FIREBASE_API_KEY",
      process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      isReleaseLike
    ),
    authDomain: requireReleaseValue(
      "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
      process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      isReleaseLike
    ),
    projectId: requireReleaseValue(
      "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
      process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      isReleaseLike
    ),
    storageBucket: requireReleaseValue(
      "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
      process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      isReleaseLike
    ),
    messagingSenderId: requireReleaseValue(
      "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      isReleaseLike
    ),
    appId: requireReleaseValue(
      "EXPO_PUBLIC_FIREBASE_APP_ID",
      process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      isReleaseLike
    ),
  };

  const easProjectId = requireReleaseValue(
    "EXPO_PUBLIC_EAS_PROJECT_ID",
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    isReleaseLike
  );
  const legalBaseUrl = requireReleaseValue(
    "EXPO_PUBLIC_LEGAL_BASE_URL",
    process.env.EXPO_PUBLIC_LEGAL_BASE_URL,
    isReleaseLike
  );
  const errorReportingEndpoint = requireReleaseValue(
    "EXPO_PUBLIC_ERROR_REPORTING_ENDPOINT",
    process.env.EXPO_PUBLIC_ERROR_REPORTING_ENDPOINT,
    isReleaseLike
  );
  const mapsApiKey = requireReleaseValue(
    "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    isReleaseLike
  );

  if (isReleaseLike && releasedSchoolIds.length === 0) {
    throw new Error(
      "[app.config] EXPO_PUBLIC_RELEASED_SCHOOL_IDS must contain at least one school for preview/production builds"
    );
  }

  const bundleIdentifier =
    process.env.IOS_BUNDLE_IDENTIFIER?.trim() ||
    config.ios?.bundleIdentifier ||
    (isProduction ? "com.campus.app" : "com.campus.app.dev");
  const androidPackage =
    process.env.ANDROID_PACKAGE_NAME?.trim() ||
    config.android?.package ||
    (isProduction ? "com.campus.app" : "com.campus.app.dev");
  const buildNumber =
    requireReleaseValue(
      "IOS_BUILD_NUMBER",
      process.env.IOS_BUILD_NUMBER ?? String(config.ios?.buildNumber ?? "1"),
      isReleaseLike
    ) ?? "1";
  const versionCode = requirePositiveInteger(
    "ANDROID_VERSION_CODE",
    process.env.ANDROID_VERSION_CODE ?? config.android?.versionCode,
    isReleaseLike,
    1
  );
  const deepLinkHost =
    featureAvailability.deeplinks
      ? requireReleaseValue(
          "EXPO_PUBLIC_DEEP_LINK_HOST",
          process.env.EXPO_PUBLIC_DEEP_LINK_HOST,
          isReleaseLike
        ) ?? null
      : null;

  const plugins = [
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
    ...(featureAvailability.widgets ? ["./src/widgets/expo-widget-plugin.js"] : []),
  ];

  const androidIntentFilters = [
    {
      action: "VIEW",
      data: [{ scheme: "campus" }],
      category: ["BROWSABLE", "DEFAULT"],
    },
    ...(deepLinkHost
      ? [
          {
            action: "VIEW",
            autoVerify: isProduction,
            data: [{ scheme: "https", host: deepLinkHost, pathPrefix: "/" }],
            category: ["BROWSABLE", "DEFAULT"],
          },
        ]
      : []),
  ];

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
      bundleIdentifier,
      buildNumber,
      infoPlist: {
        NSCameraUsageDescription: "需要相機權限以掃描 QR 碼和拍照",
        NSPhotoLibraryUsageDescription: "需要相簿權限以選擇照片",
        NSLocationWhenInUseUsageDescription: "需要位置權限以提供校園導航",
        NSLocationAlwaysAndWhenInUseUsageDescription: "需要位置權限以提供校園導航",
        NSFaceIDUsageDescription: "使用 Face ID 進行安全驗證",
        UIBackgroundModes: ["fetch", "remote-notification"],
      },
      associatedDomains: deepLinkHost ? [`applinks:${deepLinkHost}`] : undefined,
      config: {
        googleMapsApiKey: mapsApiKey,
      },
      entitlements: {
        "com.apple.developer.applesignin": ["Default"],
        "aps-environment": isProduction ? "production" : "development",
        "com.apple.security.application-groups": featureAvailability.widgets
          ? [DEFAULT_WIDGET_APP_GROUP_ID]
          : undefined,
      },
    },
    android: {
      ...(config.android ?? {}),
      adaptiveIcon: {
        foregroundImage:
          config.android?.adaptiveIcon?.foregroundImage ?? "./assets/adaptive-icon.png",
        backgroundColor: "#1a1a2e",
      },
      package: androidPackage,
      versionCode,
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
          apiKey: mapsApiKey,
        },
      },
      intentFilters: androidIntentFilters,
    },
    plugins,
    experiments: {
      typedRoutes: true,
    },
    extra: {
      ...(config.extra ?? {}),
      appEnv,
      isReleaseLike,
      legalBaseUrl,
      errorReportingEndpoint,
      firebase,
      cloudFunctionRegion: process.env.EXPO_PUBLIC_CLOUD_FUNCTION_REGION ?? "asia-east1",
      aiProvider: process.env.EXPO_PUBLIC_AI_PROVIDER ?? "cloud",
      enableMockSSO: !isReleaseLike && process.env.EXPO_PUBLIC_ENABLE_MOCK_SSO === "true",
      ...(!isReleaseLike
        ? {
            testSchoolLogin: {
              enabled: process.env.TEST_SCHOOL_LOGIN_ENABLED === "true",
              schoolId: process.env.TEST_SCHOOL_ID ?? "",
              username: process.env.TEST_SCHOOL_USERNAME ?? "",
              password: process.env.TEST_SCHOOL_PASSWORD ?? "",
            },
          }
        : {}),
      eas: {
        projectId: easProjectId,
      },
      release: {
        releasedSchoolIds,
        deepLinkHost,
        features: featureAvailability,
      },
      widgetConfig: {
        appGroupId: DEFAULT_WIDGET_APP_GROUP_ID,
        refreshInterval: 15,
      },
    },
    updates: easProjectId
      ? {
          fallbackToCacheTimeout: 0,
          url: `https://u.expo.dev/${easProjectId}`,
        }
      : undefined,
    runtimeVersion: {
      policy: "sdkVersion",
    },
  };
};
