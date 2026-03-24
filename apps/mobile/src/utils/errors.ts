/* eslint-disable */
import type { Language } from "../i18n";

export type ErrorCode =
  | "NETWORK_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "OFFLINE"
  | "UNKNOWN"
  | "AUTH_EMAIL_IN_USE"
  | "AUTH_INVALID_EMAIL"
  | "AUTH_WEAK_PASSWORD"
  | "AUTH_USER_NOT_FOUND"
  | "AUTH_WRONG_PASSWORD"
  | "AUTH_TOO_MANY_REQUESTS"
  | "AUTH_REQUIRES_RECENT_LOGIN"
  | "PERMISSION_DENIED"
  | "QUOTA_EXCEEDED"
  | "DATA_INVALID"
  | "FEATURE_UNAVAILABLE"
  | "MAINTENANCE";

export type ErrorMessages = Record<ErrorCode, string>;

const errorMessages: Record<Language, ErrorMessages> = {
  "zh-TW": {
    NETWORK_ERROR: "網路連線失敗，請檢查網路狀態後重試",
    NOT_FOUND: "找不到請求的資源",
    UNAUTHORIZED: "請先登入後再繼續",
    FORBIDDEN: "您沒有權限執行此操作",
    VALIDATION_ERROR: "輸入的資料格式不正確",
    SERVER_ERROR: "伺服器發生錯誤，請稍後重試",
    TIMEOUT: "請求超時，請檢查網路連線後重試",
    OFFLINE: "目前處於離線狀態，部分功能可能無法使用",
    UNKNOWN: "發生未知錯誤，請稍後重試",
    AUTH_EMAIL_IN_USE: "此電子郵件已被註冊",
    AUTH_INVALID_EMAIL: "電子郵件格式不正確",
    AUTH_WEAK_PASSWORD: "密碼強度不足，請使用至少 6 個字元",
    AUTH_USER_NOT_FOUND: "找不到此帳號，請確認電子郵件是否正確",
    AUTH_WRONG_PASSWORD: "密碼錯誤，請重新輸入",
    AUTH_TOO_MANY_REQUESTS: "嘗試次數過多，請稍後再試",
    AUTH_REQUIRES_RECENT_LOGIN: "此操作需要重新登入以驗證身份",
    PERMISSION_DENIED: "操作被拒絕，您沒有足夠的權限",
    QUOTA_EXCEEDED: "已達到使用上限，請稍後再試",
    DATA_INVALID: "資料格式錯誤，請確認輸入內容",
    FEATURE_UNAVAILABLE: "此功能目前無法使用",
    MAINTENANCE: "系統維護中，請稍後再試",
  },
  "zh-CN": {
    NETWORK_ERROR: "网络连接失败，请检查网络状态后重试",
    NOT_FOUND: "找不到请求的资源",
    UNAUTHORIZED: "请先登录后再继续",
    FORBIDDEN: "您没有权限执行此操作",
    VALIDATION_ERROR: "输入的数据格式不正确",
    SERVER_ERROR: "服务器发生错误，请稍后重试",
    TIMEOUT: "请求超时，请检查网络连接后重试",
    OFFLINE: "目前处于离线状态，部分功能可能无法使用",
    UNKNOWN: "发生未知错误，请稍后重试",
    AUTH_EMAIL_IN_USE: "此电子邮件已被注册",
    AUTH_INVALID_EMAIL: "电子邮件格式不正确",
    AUTH_WEAK_PASSWORD: "密码强度不足，请使用至少 6 个字符",
    AUTH_USER_NOT_FOUND: "找不到此账号，请确认电子邮件是否正确",
    AUTH_WRONG_PASSWORD: "密码错误，请重新输入",
    AUTH_TOO_MANY_REQUESTS: "尝试次数过多，请稍后再试",
    AUTH_REQUIRES_RECENT_LOGIN: "此操作需要重新登录以验证身份",
    PERMISSION_DENIED: "操作被拒绝，您没有足够的权限",
    QUOTA_EXCEEDED: "已达到使用上限，请稍后再试",
    DATA_INVALID: "数据格式错误，请确认输入内容",
    FEATURE_UNAVAILABLE: "此功能目前无法使用",
    MAINTENANCE: "系统维护中，请稍后再试",
  },
  en: {
    NETWORK_ERROR: "Network connection failed. Please check your connection and try again.",
    NOT_FOUND: "The requested resource was not found.",
    UNAUTHORIZED: "Please log in to continue.",
    FORBIDDEN: "You don't have permission to perform this action.",
    VALIDATION_ERROR: "The input data format is incorrect.",
    SERVER_ERROR: "A server error occurred. Please try again later.",
    TIMEOUT: "Request timed out. Please check your connection and try again.",
    OFFLINE: "You are currently offline. Some features may be unavailable.",
    UNKNOWN: "An unknown error occurred. Please try again later.",
    AUTH_EMAIL_IN_USE: "This email address is already registered.",
    AUTH_INVALID_EMAIL: "Invalid email format.",
    AUTH_WEAK_PASSWORD: "Password is too weak. Please use at least 6 characters.",
    AUTH_USER_NOT_FOUND: "Account not found. Please check your email address.",
    AUTH_WRONG_PASSWORD: "Incorrect password. Please try again.",
    AUTH_TOO_MANY_REQUESTS: "Too many attempts. Please try again later.",
    AUTH_REQUIRES_RECENT_LOGIN: "This action requires you to log in again.",
    PERMISSION_DENIED: "Operation denied. You don't have sufficient permissions.",
    QUOTA_EXCEEDED: "Usage limit reached. Please try again later.",
    DATA_INVALID: "Invalid data format. Please check your input.",
    FEATURE_UNAVAILABLE: "This feature is currently unavailable.",
    MAINTENANCE: "System is under maintenance. Please try again later.",
  },
  ja: {
    NETWORK_ERROR: "ネットワーク接続に失敗しました。接続を確認して再試行してください。",
    NOT_FOUND: "リクエストされたリソースが見つかりません。",
    UNAUTHORIZED: "続行するにはログインしてください。",
    FORBIDDEN: "この操作を実行する権限がありません。",
    VALIDATION_ERROR: "入力データの形式が正しくありません。",
    SERVER_ERROR: "サーバーエラーが発生しました。後でもう一度お試しください。",
    TIMEOUT: "リクエストがタイムアウトしました。接続を確認して再試行してください。",
    OFFLINE: "現在オフラインです。一部の機能が利用できない場合があります。",
    UNKNOWN: "不明なエラーが発生しました。後でもう一度お試しください。",
    AUTH_EMAIL_IN_USE: "このメールアドレスは既に登録されています。",
    AUTH_INVALID_EMAIL: "メールアドレスの形式が正しくありません。",
    AUTH_WEAK_PASSWORD: "パスワードが弱すぎます。6文字以上を使用してください。",
    AUTH_USER_NOT_FOUND: "アカウントが見つかりません。メールアドレスを確認してください。",
    AUTH_WRONG_PASSWORD: "パスワードが正しくありません。もう一度入力してください。",
    AUTH_TOO_MANY_REQUESTS: "試行回数が多すぎます。後でもう一度お試しください。",
    AUTH_REQUIRES_RECENT_LOGIN: "この操作には再ログインが必要です。",
    PERMISSION_DENIED: "操作が拒否されました。十分な権限がありません。",
    QUOTA_EXCEEDED: "使用制限に達しました。後でもう一度お試しください。",
    DATA_INVALID: "データ形式が無効です。入力内容を確認してください。",
    FEATURE_UNAVAILABLE: "この機能は現在利用できません。",
    MAINTENANCE: "システムメンテナンス中です。後でもう一度お試しください。",
  },
  ko: {
    NETWORK_ERROR: "네트워크 연결에 실패했습니다. 연결을 확인하고 다시 시도해 주세요.",
    NOT_FOUND: "요청한 리소스를 찾을 수 없습니다.",
    UNAUTHORIZED: "계속하려면 로그인해 주세요.",
    FORBIDDEN: "이 작업을 수행할 권한이 없습니다.",
    VALIDATION_ERROR: "입력 데이터 형식이 올바르지 않습니다.",
    SERVER_ERROR: "서버 오류가 발생했습니다. 나중에 다시 시도해 주세요.",
    TIMEOUT: "요청 시간이 초과되었습니다. 연결을 확인하고 다시 시도해 주세요.",
    OFFLINE: "현재 오프라인 상태입니다. 일부 기능을 사용할 수 없습니다.",
    UNKNOWN: "알 수 없는 오류가 발생했습니다. 나중에 다시 시도해 주세요.",
    AUTH_EMAIL_IN_USE: "이 이메일 주소는 이미 등록되어 있습니다.",
    AUTH_INVALID_EMAIL: "이메일 형식이 올바르지 않습니다.",
    AUTH_WEAK_PASSWORD: "비밀번호가 너무 약합니다. 6자 이상 사용해 주세요.",
    AUTH_USER_NOT_FOUND: "계정을 찾을 수 없습니다. 이메일 주소를 확인해 주세요.",
    AUTH_WRONG_PASSWORD: "비밀번호가 올바르지 않습니다. 다시 입력해 주세요.",
    AUTH_TOO_MANY_REQUESTS: "시도 횟수가 너무 많습니다. 나중에 다시 시도해 주세요.",
    AUTH_REQUIRES_RECENT_LOGIN: "이 작업을 수행하려면 다시 로그인해야 합니다.",
    PERMISSION_DENIED: "작업이 거부되었습니다. 권한이 충분하지 않습니다.",
    QUOTA_EXCEEDED: "사용 한도에 도달했습니다. 나중에 다시 시도해 주세요.",
    DATA_INVALID: "데이터 형식이 잘못되었습니다. 입력 내용을 확인해 주세요.",
    FEATURE_UNAVAILABLE: "이 기능은 현재 사용할 수 없습니다.",
    MAINTENANCE: "시스템 점검 중입니다. 나중에 다시 시도해 주세요.",
  },
};

export class AppError extends Error {
  code: ErrorCode;
  originalError?: Error;

  constructor(code: ErrorCode, message?: string, originalError?: Error) {
    super(message);
    this.code = code;
    this.originalError = originalError;
    this.name = "AppError";
  }
}

export function getErrorMessage(code: ErrorCode, language: Language = "zh-TW"): string {
  return errorMessages[language]?.[code] || errorMessages["zh-TW"][code] || errorMessages["zh-TW"].UNKNOWN;
}

export function getLocalizedError(error: unknown, language: Language = "zh-TW"): string {
  if (error instanceof AppError) {
    return getErrorMessage(error.code, language);
  }

  if (error instanceof Error) {
    const code = parseFirebaseError(error) || parseNetworkError(error);
    if (code) {
      return getErrorMessage(code, language);
    }
    return error.message || getErrorMessage("UNKNOWN", language);
  }

  if (typeof error === "string") {
    return error;
  }

  return getErrorMessage("UNKNOWN", language);
}

function parseFirebaseError(error: Error): ErrorCode | null {
  const message = error.message.toLowerCase();
  const code = (error as any).code?.toLowerCase() || "";

  const firebaseErrorMap: Record<string, ErrorCode> = {
    "auth/email-already-in-use": "AUTH_EMAIL_IN_USE",
    "auth/invalid-email": "AUTH_INVALID_EMAIL",
    "auth/weak-password": "AUTH_WEAK_PASSWORD",
    "auth/user-not-found": "AUTH_USER_NOT_FOUND",
    "auth/wrong-password": "AUTH_WRONG_PASSWORD",
    "auth/too-many-requests": "AUTH_TOO_MANY_REQUESTS",
    "auth/requires-recent-login": "AUTH_REQUIRES_RECENT_LOGIN",
    "permission-denied": "PERMISSION_DENIED",
    "resource-exhausted": "QUOTA_EXCEEDED",
    "unavailable": "MAINTENANCE",
    "not-found": "NOT_FOUND",
    "unauthenticated": "UNAUTHORIZED",
  };

  for (const [key, errorCode] of Object.entries(firebaseErrorMap)) {
    if (code.includes(key) || message.includes(key)) {
      return errorCode;
    }
  }

  return null;
}

function parseNetworkError(error: Error): ErrorCode | null {
  const message = error.message.toLowerCase();

  if (message.includes("network") || message.includes("failed to fetch") || message.includes("net::")) {
    return "NETWORK_ERROR";
  }

  if (message.includes("timeout") || message.includes("timed out")) {
    return "TIMEOUT";
  }

  if (message.includes("offline")) {
    return "OFFLINE";
  }

  if (message.includes("404") || message.includes("not found")) {
    return "NOT_FOUND";
  }

  if (message.includes("401") || message.includes("unauthorized")) {
    return "UNAUTHORIZED";
  }

  if (message.includes("403") || message.includes("forbidden")) {
    return "FORBIDDEN";
  }

  if (message.includes("500") || message.includes("internal server")) {
    return "SERVER_ERROR";
  }

  return null;
}

export function createAppError(code: ErrorCode, originalError?: Error): AppError {
  return new AppError(code, getErrorMessage(code), originalError);
}

export type ErrorHandler = {
  handleError: (error: unknown, context?: string) => void;
  getErrorDisplay: (error: unknown) => { title: string; message: string; code: ErrorCode };
};

export function createErrorHandler(language: Language = "zh-TW"): ErrorHandler {
  return {
    handleError: (error: unknown, context?: string) => {
      const message = getLocalizedError(error, language);
      console.error(`[${context || "Error"}]:`, message, error);
    },
    getErrorDisplay: (error: unknown) => {
      let code: ErrorCode = "UNKNOWN";
      
      if (error instanceof AppError) {
        code = error.code;
      } else if (error instanceof Error) {
        code = parseFirebaseError(error) || parseNetworkError(error) || "UNKNOWN";
      }
      
      const message = getErrorMessage(code, language);
      
      const titles: Record<ErrorCode, string> = {
        NETWORK_ERROR: language === "zh-TW" ? "網路錯誤" : "Network Error",
        NOT_FOUND: language === "zh-TW" ? "找不到資源" : "Not Found",
        UNAUTHORIZED: language === "zh-TW" ? "需要登入" : "Login Required",
        FORBIDDEN: language === "zh-TW" ? "權限不足" : "Access Denied",
        VALIDATION_ERROR: language === "zh-TW" ? "驗證錯誤" : "Validation Error",
        SERVER_ERROR: language === "zh-TW" ? "伺服器錯誤" : "Server Error",
        TIMEOUT: language === "zh-TW" ? "請求超時" : "Request Timeout",
        OFFLINE: language === "zh-TW" ? "離線模式" : "Offline",
        UNKNOWN: language === "zh-TW" ? "發生錯誤" : "Error",
        AUTH_EMAIL_IN_USE: language === "zh-TW" ? "註冊失敗" : "Registration Failed",
        AUTH_INVALID_EMAIL: language === "zh-TW" ? "無效郵件" : "Invalid Email",
        AUTH_WEAK_PASSWORD: language === "zh-TW" ? "密碼太弱" : "Weak Password",
        AUTH_USER_NOT_FOUND: language === "zh-TW" ? "找不到帳號" : "Account Not Found",
        AUTH_WRONG_PASSWORD: language === "zh-TW" ? "密碼錯誤" : "Wrong Password",
        AUTH_TOO_MANY_REQUESTS: language === "zh-TW" ? "請稍後再試" : "Too Many Attempts",
        AUTH_REQUIRES_RECENT_LOGIN: language === "zh-TW" ? "需重新登入" : "Re-login Required",
        PERMISSION_DENIED: language === "zh-TW" ? "權限被拒" : "Permission Denied",
        QUOTA_EXCEEDED: language === "zh-TW" ? "超出限額" : "Quota Exceeded",
        DATA_INVALID: language === "zh-TW" ? "資料無效" : "Invalid Data",
        FEATURE_UNAVAILABLE: language === "zh-TW" ? "功能不可用" : "Feature Unavailable",
        MAINTENANCE: language === "zh-TW" ? "維護中" : "Maintenance",
      };
      
      return {
        title: titles[code] || titles.UNKNOWN,
        message,
        code,
      };
    },
  };
}

export function isRetryableError(error: unknown): boolean {
  const retryableCodes: ErrorCode[] = [
    "NETWORK_ERROR",
    "TIMEOUT",
    "SERVER_ERROR",
    "OFFLINE",
    "AUTH_TOO_MANY_REQUESTS",
    "QUOTA_EXCEEDED",
    "MAINTENANCE",
  ];
  
  // 明確不可重試的錯誤類型
  const nonRetryableCodes: ErrorCode[] = [
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "VALIDATION_ERROR",
    "DATA_INVALID",
    "AUTH_EMAIL_IN_USE",
    "AUTH_INVALID_EMAIL",
    "AUTH_WEAK_PASSWORD",
    "AUTH_USER_NOT_FOUND",
    "AUTH_WRONG_PASSWORD",
    "AUTH_REQUIRES_RECENT_LOGIN",
    "PERMISSION_DENIED",
    "FEATURE_UNAVAILABLE",
  ];
  
  if (error instanceof AppError) {
    if (nonRetryableCodes.includes(error.code)) {
      return false;
    }
    return retryableCodes.includes(error.code);
  }
  
  if (error instanceof Error) {
    const code = parseFirebaseError(error) || parseNetworkError(error);
    if (code) {
      if (nonRetryableCodes.includes(code)) {
        return false;
      }
      return retryableCodes.includes(code);
    }
  }
  
  // 對於未知錯誤，預設為不可重試
  // 這避免了對無法解決的問題進行無限重試
  return false;
}

export function shouldShowOfflineBanner(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.code === "OFFLINE" || error.code === "NETWORK_ERROR";
  }
  
  if (error instanceof Error) {
    const code = parseNetworkError(error);
    return code === "OFFLINE" || code === "NETWORK_ERROR";
  }
  
  return false;
}

/**
 * 判斷錯誤是否需要使用者採取行動
 * 用於決定是否顯示 alert 或只顯示 toast
 */
export function requiresUserAction(error: unknown): boolean {
  const actionRequiredCodes: ErrorCode[] = [
    "UNAUTHORIZED",
    "AUTH_REQUIRES_RECENT_LOGIN",
    "AUTH_EMAIL_IN_USE",
    "AUTH_USER_NOT_FOUND",
    "AUTH_WRONG_PASSWORD",
    "PERMISSION_DENIED",
  ];
  
  if (error instanceof AppError) {
    return actionRequiredCodes.includes(error.code);
  }
  
  if (error instanceof Error) {
    const code = parseFirebaseError(error) || parseNetworkError(error);
    if (code) {
      return actionRequiredCodes.includes(code);
    }
  }
  
  return false;
}

/**
 * 根據錯誤類型獲取建議的操作
 */
export function getSuggestedAction(code: ErrorCode): {
  action: "retry" | "login" | "contact_support" | "check_input" | "none";
  buttonText?: Record<"zh-TW" | "en", string>;
} {
  switch (code) {
    case "NETWORK_ERROR":
    case "TIMEOUT":
    case "SERVER_ERROR":
    case "OFFLINE":
    case "MAINTENANCE":
      return {
        action: "retry",
        buttonText: { "zh-TW": "重試", en: "Retry" },
      };
    case "UNAUTHORIZED":
    case "AUTH_REQUIRES_RECENT_LOGIN":
    case "AUTH_USER_NOT_FOUND":
    case "AUTH_WRONG_PASSWORD":
      return {
        action: "login",
        buttonText: { "zh-TW": "登入", en: "Login" },
      };
    case "VALIDATION_ERROR":
    case "DATA_INVALID":
    case "AUTH_INVALID_EMAIL":
    case "AUTH_WEAK_PASSWORD":
      return {
        action: "check_input",
        buttonText: { "zh-TW": "修正", en: "Fix" },
      };
    case "PERMISSION_DENIED":
    case "FORBIDDEN":
    case "QUOTA_EXCEEDED":
    case "FEATURE_UNAVAILABLE":
      return {
        action: "contact_support",
        buttonText: { "zh-TW": "聯絡客服", en: "Contact Support" },
      };
    default:
      return { action: "none" };
  }
}

/**
 * 獲取錯誤的嚴重程度
 */
export function getErrorSeverity(error: unknown): "info" | "warning" | "error" | "critical" {
  const criticalCodes: ErrorCode[] = ["SERVER_ERROR", "MAINTENANCE"];
  const errorCodes: ErrorCode[] = ["UNAUTHORIZED", "FORBIDDEN", "PERMISSION_DENIED"];
  const warningCodes: ErrorCode[] = ["NETWORK_ERROR", "TIMEOUT", "OFFLINE", "AUTH_TOO_MANY_REQUESTS"];
  
  let code: ErrorCode = "UNKNOWN";
  
  if (error instanceof AppError) {
    code = error.code;
  } else if (error instanceof Error) {
    code = parseFirebaseError(error) || parseNetworkError(error) || "UNKNOWN";
  }
  
  if (criticalCodes.includes(code)) return "critical";
  if (errorCodes.includes(code)) return "error";
  if (warningCodes.includes(code)) return "warning";
  return "info";
}
