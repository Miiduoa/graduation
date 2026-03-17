import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";

export type Language = "zh-TW" | "zh-CN" | "en" | "ja" | "ko";

export type TranslationKeys = {
  common: {
    ok: string;
    cancel: string;
    save: string;
    delete: string;
    edit: string;
    loading: string;
    error: string;
    retry: string;
    search: string;
    back: string;
    next: string;
    done: string;
    close: string;
    share: string;
    copy: string;
    more: string;
  };
  tabs: {
    home: string;
    map: string;
    announcements: string;
    cafeteria: string;
    me: string;
  };
  home: {
    greeting: string;
    todaySchedule: string;
    upcomingEvents: string;
    quickActions: string;
    announcements: string;
    viewAll: string;
  };
  auth: {
    login: string;
    register: string;
    logout: string;
    email: string;
    password: string;
    forgotPassword: string;
    ssoLogin: string;
    loginWithSchool: string;
  };
  settings: {
    title: string;
    appearance: string;
    language: string;
    notifications: string;
    privacy: string;
    about: string;
    darkMode: string;
    lightMode: string;
  };
  accessibility: {
    title: string;
    textSize: string;
    highContrast: string;
    reduceMotion: string;
    screenReader: string;
  };
};

type Translations = Record<Language, TranslationKeys>;

const translations: Translations = {
  "zh-TW": {
    common: {
      ok: "確定",
      cancel: "取消",
      save: "儲存",
      delete: "刪除",
      edit: "編輯",
      loading: "載入中...",
      error: "發生錯誤",
      retry: "重試",
      search: "搜尋",
      back: "返回",
      next: "下一步",
      done: "完成",
      close: "關閉",
      share: "分享",
      copy: "複製",
      more: "更多",
    },
    tabs: {
      home: "首頁",
      map: "校園地圖",
      announcements: "公告",
      cafeteria: "餐廳",
      me: "我的",
    },
    home: {
      greeting: "你好",
      todaySchedule: "今日課表",
      upcomingEvents: "近期活動",
      quickActions: "快速功能",
      announcements: "最新公告",
      viewAll: "查看全部",
    },
    auth: {
      login: "登入",
      register: "註冊",
      logout: "登出",
      email: "電子郵件",
      password: "密碼",
      forgotPassword: "忘記密碼？",
      ssoLogin: "單一登入",
      loginWithSchool: "使用學校帳號登入",
    },
    settings: {
      title: "設定",
      appearance: "外觀",
      language: "語言",
      notifications: "通知",
      privacy: "隱私",
      about: "關於",
      darkMode: "深色模式",
      lightMode: "淺色模式",
    },
    accessibility: {
      title: "無障礙設定",
      textSize: "文字大小",
      highContrast: "高對比度",
      reduceMotion: "減少動態效果",
      screenReader: "螢幕閱讀器",
    },
  },
  "zh-CN": {
    common: {
      ok: "确定",
      cancel: "取消",
      save: "保存",
      delete: "删除",
      edit: "编辑",
      loading: "加载中...",
      error: "发生错误",
      retry: "重试",
      search: "搜索",
      back: "返回",
      next: "下一步",
      done: "完成",
      close: "关闭",
      share: "分享",
      copy: "复制",
      more: "更多",
    },
    tabs: {
      home: "首页",
      map: "校园地图",
      announcements: "公告",
      cafeteria: "餐厅",
      me: "我的",
    },
    home: {
      greeting: "你好",
      todaySchedule: "今日课表",
      upcomingEvents: "近期活动",
      quickActions: "快速功能",
      announcements: "最新公告",
      viewAll: "查看全部",
    },
    auth: {
      login: "登录",
      register: "注册",
      logout: "登出",
      email: "电子邮件",
      password: "密码",
      forgotPassword: "忘记密码？",
      ssoLogin: "单点登录",
      loginWithSchool: "使用学校账号登录",
    },
    settings: {
      title: "设置",
      appearance: "外观",
      language: "语言",
      notifications: "通知",
      privacy: "隐私",
      about: "关于",
      darkMode: "深色模式",
      lightMode: "浅色模式",
    },
    accessibility: {
      title: "无障碍设置",
      textSize: "文字大小",
      highContrast: "高对比度",
      reduceMotion: "减少动态效果",
      screenReader: "屏幕阅读器",
    },
  },
  en: {
    common: {
      ok: "OK",
      cancel: "Cancel",
      save: "Save",
      delete: "Delete",
      edit: "Edit",
      loading: "Loading...",
      error: "An error occurred",
      retry: "Retry",
      search: "Search",
      back: "Back",
      next: "Next",
      done: "Done",
      close: "Close",
      share: "Share",
      copy: "Copy",
      more: "More",
    },
    tabs: {
      home: "Home",
      map: "Campus Map",
      announcements: "Announcements",
      cafeteria: "Cafeteria",
      me: "Me",
    },
    home: {
      greeting: "Hello",
      todaySchedule: "Today's Schedule",
      upcomingEvents: "Upcoming Events",
      quickActions: "Quick Actions",
      announcements: "Latest Announcements",
      viewAll: "View All",
    },
    auth: {
      login: "Login",
      register: "Register",
      logout: "Logout",
      email: "Email",
      password: "Password",
      forgotPassword: "Forgot password?",
      ssoLogin: "SSO Login",
      loginWithSchool: "Login with School Account",
    },
    settings: {
      title: "Settings",
      appearance: "Appearance",
      language: "Language",
      notifications: "Notifications",
      privacy: "Privacy",
      about: "About",
      darkMode: "Dark Mode",
      lightMode: "Light Mode",
    },
    accessibility: {
      title: "Accessibility",
      textSize: "Text Size",
      highContrast: "High Contrast",
      reduceMotion: "Reduce Motion",
      screenReader: "Screen Reader",
    },
  },
  ja: {
    common: {
      ok: "OK",
      cancel: "キャンセル",
      save: "保存",
      delete: "削除",
      edit: "編集",
      loading: "読み込み中...",
      error: "エラーが発生しました",
      retry: "再試行",
      search: "検索",
      back: "戻る",
      next: "次へ",
      done: "完了",
      close: "閉じる",
      share: "共有",
      copy: "コピー",
      more: "もっと見る",
    },
    tabs: {
      home: "ホーム",
      map: "キャンパスマップ",
      announcements: "お知らせ",
      cafeteria: "食堂",
      me: "マイページ",
    },
    home: {
      greeting: "こんにちは",
      todaySchedule: "今日の時間割",
      upcomingEvents: "近日のイベント",
      quickActions: "クイックアクション",
      announcements: "最新のお知らせ",
      viewAll: "すべて見る",
    },
    auth: {
      login: "ログイン",
      register: "新規登録",
      logout: "ログアウト",
      email: "メールアドレス",
      password: "パスワード",
      forgotPassword: "パスワードをお忘れですか？",
      ssoLogin: "シングルサインオン",
      loginWithSchool: "学校アカウントでログイン",
    },
    settings: {
      title: "設定",
      appearance: "外観",
      language: "言語",
      notifications: "通知",
      privacy: "プライバシー",
      about: "このアプリについて",
      darkMode: "ダークモード",
      lightMode: "ライトモード",
    },
    accessibility: {
      title: "アクセシビリティ",
      textSize: "文字サイズ",
      highContrast: "高コントラスト",
      reduceMotion: "視差効果を減らす",
      screenReader: "スクリーンリーダー",
    },
  },
  ko: {
    common: {
      ok: "확인",
      cancel: "취소",
      save: "저장",
      delete: "삭제",
      edit: "편집",
      loading: "로딩 중...",
      error: "오류가 발생했습니다",
      retry: "재시도",
      search: "검색",
      back: "뒤로",
      next: "다음",
      done: "완료",
      close: "닫기",
      share: "공유",
      copy: "복사",
      more: "더 보기",
    },
    tabs: {
      home: "홈",
      map: "캠퍼스 지도",
      announcements: "공지사항",
      cafeteria: "식당",
      me: "마이페이지",
    },
    home: {
      greeting: "안녕하세요",
      todaySchedule: "오늘의 시간표",
      upcomingEvents: "다가오는 이벤트",
      quickActions: "빠른 기능",
      announcements: "최신 공지",
      viewAll: "전체 보기",
    },
    auth: {
      login: "로그인",
      register: "회원가입",
      logout: "로그아웃",
      email: "이메일",
      password: "비밀번호",
      forgotPassword: "비밀번호를 잊으셨나요?",
      ssoLogin: "SSO 로그인",
      loginWithSchool: "학교 계정으로 로그인",
    },
    settings: {
      title: "설정",
      appearance: "외관",
      language: "언어",
      notifications: "알림",
      privacy: "개인정보",
      about: "정보",
      darkMode: "다크 모드",
      lightMode: "라이트 모드",
    },
    accessibility: {
      title: "접근성",
      textSize: "텍스트 크기",
      highContrast: "고대비",
      reduceMotion: "동작 줄이기",
      screenReader: "스크린 리더",
    },
  },
};

const LANGUAGE_STORAGE_KEY = "@app_language";

export const LANGUAGE_OPTIONS: Array<{ code: Language; name: string; nativeName: string }> = [
  { code: "zh-TW", name: "Traditional Chinese", nativeName: "繁體中文" },
  { code: "zh-CN", name: "Simplified Chinese", nativeName: "简体中文" },
  { code: "en", name: "English", nativeName: "English" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
];

function getDeviceLanguage(): Language {
  const deviceLocale =
    Platform.OS === "ios"
      ? NativeModules.SettingsManager?.settings?.AppleLocale ||
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
      : NativeModules.I18nManager?.localeIdentifier;

  if (!deviceLocale) return "zh-TW";

  const normalized = deviceLocale.toLowerCase().replace("_", "-");

  if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hant")) return "zh-TW";
  if (normalized.startsWith("zh-cn") || normalized.startsWith("zh-hans")) return "zh-CN";
  if (normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("en")) return "en";

  return "zh-TW";
}

type I18nContextValue = {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: TranslationKeys;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("zh-TW");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    loadLanguage();
  }, []);

  const loadLanguage = async () => {
    try {
      const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored && translations[stored as Language]) {
        setLanguageState(stored as Language);
      } else {
        const deviceLang = getDeviceLanguage();
        setLanguageState(deviceLang);
      }
    } catch (e) {
      console.error("Failed to load language:", e);
      setLanguageState(getDeviceLanguage());
    } finally {
      setInitialized(true);
    }
  };

  const setLanguage = async (lang: Language) => {
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      setLanguageState(lang);
    } catch (e) {
      console.error("Failed to save language:", e);
    }
  };

  const t = translations[language];

  const value: I18nContextValue = {
    language,
    setLanguage,
    t,
  };

  const reactElement = React.createElement(I18nContext.Provider, { value }, children);
  return reactElement;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    return {
      language: "zh-TW",
      setLanguage: async () => {},
      t: translations["zh-TW"],
    };
  }
  return context;
}

export function t(key: string, language: Language = "zh-TW"): string {
  const keys = key.split(".");
  let value: any = translations[language];
  
  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = value[k];
    } else {
      return key;
    }
  }
  
  return typeof value === "string" ? value : key;
}
