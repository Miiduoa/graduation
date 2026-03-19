export type SchoolContext = {
  code: string;
  id: string;
};

function toUrl(path: string): URL {
  return new URL(path, "https://campus.local");
}

export function sanitizeInternalPath(value?: string | null, fallback: string = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function extractSchoolContextFromPath(path?: string | null): {
  school?: string;
  schoolId?: string;
} {
  const safePath = sanitizeInternalPath(path);
  const url = toUrl(safePath);

  return {
    school: url.searchParams.get("school") || undefined,
    schoolId: url.searchParams.get("schoolId") || undefined,
  };
}

export function buildSchoolSearch(context: SchoolContext): string {
  const search = new URLSearchParams({
    school: context.code,
    schoolId: context.id,
  });

  return `?${search.toString()}`;
}

export function appendSchoolContext(path: string, context: SchoolContext): string {
  const safePath = sanitizeInternalPath(path);
  const url = toUrl(safePath);

  url.searchParams.set("school", context.code);
  url.searchParams.set("schoolId", context.id);

  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildSsoCallbackPath(
  context: SchoolContext,
  provider: "oidc" | "cas" | "saml",
  returnUrl?: string | null
): string {
  const url = toUrl("/sso-callback");
  url.searchParams.set("school", context.code);
  url.searchParams.set("schoolId", context.id);
  url.searchParams.set("provider", provider);

  const safeReturnUrl = sanitizeInternalPath(returnUrl);
  if (safeReturnUrl !== "/") {
    url.searchParams.set("returnUrl", safeReturnUrl);
  }

  return `${url.pathname}${url.search}`;
}
