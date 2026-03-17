/**
 * useDeepLink Hook
 * 處理 Deep Link 和 Universal Link 導航
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Linking, Platform } from "react-native";

export interface DeepLinkRoute {
  path: string;
  params: Record<string, string>;
}

export interface DeepLinkOptions {
  onLink?: (route: DeepLinkRoute) => void;
  scheme?: string;
  prefixes?: string[];
}

export interface DeepLinkResult {
  initialUrl: string | null;
  currentUrl: string | null;
  route: DeepLinkRoute | null;
  isLoading: boolean;
  openUrl: (url: string) => Promise<boolean>;
  canOpenUrl: (url: string) => Promise<boolean>;
}

const DEFAULT_SCHEME = "campus";
const DEFAULT_PREFIXES = [
  "campus://",
  "https://campus-app.example.com",
  "https://*.campus-app.example.com",
];

function parseUrl(
  url: string,
  scheme: string = DEFAULT_SCHEME,
  prefixes: string[] = DEFAULT_PREFIXES
): DeepLinkRoute | null {
  if (!url) return null;

  let path = "";
  let queryString = "";

  const schemePrefix = `${scheme}://`;
  if (url.startsWith(schemePrefix)) {
    const withoutScheme = url.slice(schemePrefix.length);
    const [pathPart, query] = withoutScheme.split("?");
    path = pathPart;
    queryString = query || "";
  } else {
    for (const prefix of prefixes) {
      if (prefix.includes("*")) {
        const regex = new RegExp(prefix.replace(/\*/g, "[^/]+"));
        if (regex.test(url)) {
          try {
            const parsed = new URL(url);
            path = parsed.pathname.slice(1);
            queryString = parsed.search.slice(1);
          } catch {
            continue;
          }
          break;
        }
      } else if (url.startsWith(prefix)) {
        try {
          const parsed = new URL(url);
          path = parsed.pathname.slice(1);
          queryString = parsed.search.slice(1);
        } catch {
          path = url.slice(prefix.length).replace(/^\//, "");
          const queryIndex = path.indexOf("?");
          if (queryIndex !== -1) {
            queryString = path.slice(queryIndex + 1);
            path = path.slice(0, queryIndex);
          }
        }
        break;
      }
    }
  }

  if (!path) {
    try {
      const parsed = new URL(url);
      path = parsed.pathname.slice(1);
      queryString = parsed.search.slice(1);
    } catch {
      return null;
    }
  }

  const params: Record<string, string> = {};
  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    searchParams.forEach((value, key) => {
      params[key] = value;
    });
  }

  const pathParts = path.split("/").filter(Boolean);
  for (let i = 0; i < pathParts.length; i += 2) {
    if (pathParts[i + 1] && !params[pathParts[i]]) {
      params[pathParts[i]] = pathParts[i + 1];
    }
  }

  return { path, params };
}

export function useDeepLink(options: DeepLinkOptions = {}): DeepLinkResult {
  const { scheme = DEFAULT_SCHEME, prefixes = DEFAULT_PREFIXES, onLink } = options;

  const [initialUrl, setInitialUrl] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [route, setRoute] = useState<DeepLinkRoute | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const onLinkRef = useRef(onLink);

  useEffect(() => {
    onLinkRef.current = onLink;
  }, [onLink]);

  const handleUrl = useCallback(
    (url: string | null) => {
      if (!url) return;

      setCurrentUrl(url);
      const parsedRoute = parseUrl(url, scheme, prefixes);
      setRoute(parsedRoute);

      if (parsedRoute && onLinkRef.current) {
        onLinkRef.current(parsedRoute);
      }
    },
    [scheme, prefixes]
  );

  useEffect(() => {
    const getInitialUrl = async () => {
      try {
        const url = await Linking.getInitialURL();
        setInitialUrl(url);
        handleUrl(url);
      } catch (error) {
        console.error("[DeepLink] Failed to get initial URL:", error);
      } finally {
        setIsLoading(false);
      }
    };

    getInitialUrl();

    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleUrl]);

  const openUrl = useCallback(async (url: string): Promise<boolean> => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return true;
      }
      return false;
    } catch (error) {
      console.error("[DeepLink] Failed to open URL:", error);
      return false;
    }
  }, []);

  const canOpenUrl = useCallback(async (url: string): Promise<boolean> => {
    try {
      return await Linking.canOpenURL(url);
    } catch {
      return false;
    }
  }, []);

  return {
    initialUrl,
    currentUrl,
    route,
    isLoading,
    openUrl,
    canOpenUrl,
  };
}

export function useDeepLinkNavigation<T extends Record<string, string>>(
  routes: Record<string, (params: T) => void>,
  options: DeepLinkOptions = {}
): DeepLinkResult {
  const handleLink = useCallback(
    (route: DeepLinkRoute) => {
      const pathParts = route.path.split("/");
      const routeName = pathParts[0];

      if (routeName && routes[routeName]) {
        routes[routeName](route.params as T);
      }
    },
    [routes]
  );

  return useDeepLink({
    ...options,
    onLink: handleLink,
  });
}

export function buildDeepLink(
  path: string,
  params?: Record<string, string>,
  scheme: string = DEFAULT_SCHEME
): string {
  let url = `${scheme}://${path}`;

  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  return url;
}

export function useUniversalLink(domain: string): {
  openInApp: (path: string) => Promise<boolean>;
  shareLink: (path: string, title?: string) => Promise<void>;
} {
  const openInApp = useCallback(
    async (path: string): Promise<boolean> => {
      const url = `https://${domain}/${path}`;
      try {
        await Linking.openURL(url);
        return true;
      } catch {
        return false;
      }
    },
    [domain]
  );

  const shareLink = useCallback(
    async (path: string, title?: string): Promise<void> => {
      const url = `https://${domain}/${path}`;
      try {
        const Share = require("react-native-share").default;
        await Share.open({
          title: title || "分享連結",
          url,
          message: title || "",
        });
      } catch {
        const { Share: RNShare } = require("react-native");
        await RNShare.share({
          message: title ? `${title}\n${url}` : url,
        });
      }
    },
    [domain]
  );

  return { openInApp, shareLink };
}

export function useExternalApps(): {
  openMaps: (lat: number, lng: number, label?: string) => Promise<boolean>;
  openPhone: (phoneNumber: string) => Promise<boolean>;
  openEmail: (email: string, subject?: string, body?: string) => Promise<boolean>;
  openAppStore: (appId: string) => Promise<boolean>;
  openSettings: () => Promise<boolean>;
} {
  const openMaps = useCallback(
    async (lat: number, lng: number, label?: string): Promise<boolean> => {
      const encodedLabel = label ? encodeURIComponent(label) : "";
      const url = Platform.select({
        ios: `maps:0,0?q=${lat},${lng}${encodedLabel ? `(${encodedLabel})` : ""}`,
        android: `geo:${lat},${lng}?q=${lat},${lng}${encodedLabel ? `(${encodedLabel})` : ""}`,
        default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
      });

      try {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
          return true;
        }
        await Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
        );
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const openPhone = useCallback(async (phoneNumber: string): Promise<boolean> => {
    const url = `tel:${phoneNumber.replace(/\s/g, "")}`;
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }, []);

  const openEmail = useCallback(
    async (email: string, subject?: string, body?: string): Promise<boolean> => {
      let url = `mailto:${email}`;
      const params: string[] = [];

      if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
      if (body) params.push(`body=${encodeURIComponent(body)}`);

      if (params.length > 0) {
        url += `?${params.join("&")}`;
      }

      try {
        await Linking.openURL(url);
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const openAppStore = useCallback(async (appId: string): Promise<boolean> => {
    const url = Platform.select({
      ios: `https://apps.apple.com/app/id${appId}`,
      android: `market://details?id=${appId}`,
      default: `https://play.google.com/store/apps/details?id=${appId}`,
    });

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return true;
      }
      if (Platform.OS === "android") {
        await Linking.openURL(`https://play.google.com/store/apps/details?id=${appId}`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const openSettings = useCallback(async (): Promise<boolean> => {
    try {
      if (Platform.OS === "ios") {
        await Linking.openURL("app-settings:");
      } else {
        await Linking.openSettings();
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  return { openMaps, openPhone, openEmail, openAppStore, openSettings };
}
