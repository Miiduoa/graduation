const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  /^https:\/\/.*\.web\.app$/,
  /^https:\/\/.*\.firebaseapp\.com$/,
];

const rateLimitBuckets = new Map();

function normalizeRuntimeEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "production" || normalized === "preview") {
    return normalized;
  }

  return "development";
}

function getAppRuntimeEnv() {
  const explicitAppEnv = String(process.env.APP_ENV || "").trim();
  if (explicitAppEnv) {
    return normalizeRuntimeEnv(explicitAppEnv);
  }

  const explicitUniversalFlag = String(process.env.UNIVERSAL_DEV_ACCOUNTS_ENABLED || "").trim().toLowerCase();
  if (explicitUniversalFlag === "true") {
    return "preview";
  }

  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  if (nodeEnv === "production") {
    return "production";
  }

  return "development";
}

function isProductionRuntime() {
  return getAppRuntimeEnv() === "production";
}

function isUniversalDevAccountsEnabled() {
  const override = String(process.env.UNIVERSAL_DEV_ACCOUNTS_ENABLED || "").trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;

  return getAppRuntimeEnv() !== "production";
}

function getAllowedOrigins() {
  const raw = String(process.env.ALLOWED_WEB_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return raw.length > 0 ? raw : DEFAULT_ALLOWED_ORIGINS;
}

function originMatches(origin, matcher) {
  if (!origin) return false;
  if (matcher instanceof RegExp) return matcher.test(origin);
  return origin === matcher;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return getAllowedOrigins().some((matcher) => originMatches(origin, matcher));
}

function assertTrustedOrigin(req) {
  const origin = req.get?.("origin") || req.headers?.origin || "";
  if (!origin) return;

  if (!isAllowedOrigin(origin)) {
    const error = new Error("Origin not allowed");
    error.statusCode = 403;
    throw error;
  }
}

function getCorsOrigins() {
  return getAllowedOrigins();
}

function getClientIp(req) {
  const forwarded = req.get?.("x-forwarded-for") || req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    req.rawRequest?.ip ||
    "unknown"
  );
}

function consumeRateLimit({
  scope,
  key,
  limit,
  windowMs,
}) {
  const bucketKey = `${scope}:${key}`;
  const now = Date.now();
  const current = rateLimitBuckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(bucketKey, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: now + windowMs,
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
    };
  }

  current.count += 1;
  rateLimitBuckets.set(bucketKey, current);
  return {
    allowed: true,
    remaining: limit - current.count,
    resetAt: current.resetAt,
  };
}

function enforceRateLimit(options) {
  const result = consumeRateLimit(options);
  if (result.allowed) return result;

  const error = new Error("Too many requests");
  error.statusCode = 429;
  error.retryAfterMs = Math.max(0, result.resetAt - Date.now());
  throw error;
}

function requirePostJson(req) {
  if (req.method !== "POST") {
    const error = new Error("Method not allowed");
    error.statusCode = 405;
    throw error;
  }

  const contentType = String(req.get?.("content-type") || req.headers?.["content-type"] || "");
  if (!contentType.toLowerCase().includes("application/json")) {
    const error = new Error("Content-Type must be application/json");
    error.statusCode = 415;
    throw error;
  }
}

function writeHttpError(res, error, fallbackMessage = "Request failed") {
  const statusCode = Number(error?.statusCode) || 500;
  const body = {
    error: error?.message || fallbackMessage,
  };

  if (typeof error?.retryAfterMs === "number") {
    res.set("Retry-After", String(Math.ceil(error.retryAfterMs / 1000)));
  }

  res.status(statusCode).json(body);
}

module.exports = {
  assertTrustedOrigin,
  enforceRateLimit,
  getAppRuntimeEnv,
  getClientIp,
  getCorsOrigins,
  isAllowedOrigin,
  isProductionRuntime,
  isUniversalDevAccountsEnabled,
  requirePostJson,
  writeHttpError,
};
