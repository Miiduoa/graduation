const DEFAULT_CALLBACK_PATH = "/sso-callback";
const PENDING_SAML_RESPONSE_KEY = "campus.web.sso.pendingSamlResponse";

function escapeForInlineScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function resolveCallbackUrl(requestUrl: string, relayState: FormDataEntryValue | null): string {
  const baseUrl = new URL(requestUrl);
  const fallbackUrl = new URL(DEFAULT_CALLBACK_PATH, baseUrl);

  if (typeof relayState !== "string" || !relayState) {
    return fallbackUrl.toString();
  }

  try {
    const candidate = new URL(relayState, baseUrl);
    if (candidate.origin !== baseUrl.origin) {
      return fallbackUrl.toString();
    }
    return candidate.toString();
  } catch {
    return fallbackUrl.toString();
  }
}

function buildHtml(callbackUrl: string, samlResponse: string) {
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SSO Redirect</title>
  </head>
  <body>
    <p>正在返回登入頁面…</p>
    <script>
      window.name = JSON.stringify({
        marker: ${escapeForInlineScript(PENDING_SAML_RESPONSE_KEY)},
        callbackUrl: ${escapeForInlineScript(callbackUrl)},
        samlResponse: ${escapeForInlineScript(samlResponse)}
      });
      window.location.replace(${escapeForInlineScript(callbackUrl)});
    </script>
  </body>
</html>`;
}

export async function GET(request: Request) {
  const response = Response.redirect(new URL(DEFAULT_CALLBACK_PATH, request.url), 302);
  response.headers.set("cache-control", "no-store");
  response.headers.set("pragma", "no-cache");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const samlResponse = formData.get("SAMLResponse");
  const callbackUrl = resolveCallbackUrl(request.url, formData.get("RelayState"));

  if (typeof samlResponse !== "string" || !samlResponse) {
    const errorUrl = new URL(callbackUrl);
    errorUrl.searchParams.set("error", "Missing SAML response");
    return Response.redirect(errorUrl, 302);
  }

  return new Response(buildHtml(callbackUrl, samlResponse), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
    },
  });
}
